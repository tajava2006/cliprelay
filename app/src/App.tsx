/**
 * 앱 루트 컴포넌트
 *
 * 마운트 시 Tauri Store에서 auth 로드:
 *   - 없으면 → Login 화면
 *   - 있으면 → BunkerSigner 복원 → 릴레이/Blossom 디스커버리 → 모니터 시작 → 메인 화면
 *   - 복원 실패 시 → auth 삭제 후 Login 화면
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { loadAuth, clearAuth } from './store/auth-store'
import { loadWriteRelays, saveWriteRelays, clearWriteRelays } from './store/relay-store'
import { loadBlossomServers, saveBlossomServers, clearBlossomServers } from './store/blossom-store'
import { loadProfile, saveProfile, clearProfile } from './store/profile-store'
import { setSigner, clearSigner, getSigner } from './platform/signer'
import { getSharedPool, destroySharedPool } from './nostr/pool'
import { startForegroundService, stopForegroundService, onNetworkChanged, stopNativeSubscription, consumeNativeEvents, setAppForeground } from './platform/foreground-service'
import { readClipboardImage } from './platform/clipboard-action'
import { publishClipboard } from './nostr/publish'
import { isAndroid } from './platform/detect'
import { invoke } from '@tauri-apps/api/core'
import { startPlatformClipboardMonitor } from './platform/clipboard'
import type { ClipboardMonitor } from './clipboard/monitor'
import { startClipboardSubscription, type ClipboardSubscription } from './nostr/subscribe'
import { appendHistory, hasHistoryId, clearHistory } from './store/history-store'
import { rgbaToPng } from './blossom/upload'
import { uploadImage } from './blossom/upload'
import {
  restoreSigner,
  fetchWriteRelays, subscribeWriteRelays,
  fetchBlossomServers, subscribeBlossomServers,
  fetchProfile, subscribeProfile,
} from '@cliprelay/shared'
import type { UserProfile, ClipboardPayload } from '@cliprelay/shared'
import { Login } from './pages/Login'
import { History } from './pages/History'
import { Main } from './pages/Main'
import { ToastContainer } from './components/Toast'

type AppState =
  | { status: 'loading' }
  | { status: 'login' }
  | { status: 'main'; userPubkey: string; writeRelays: string[]; blossomServers: string[]; profile: UserProfile | null }

function App() {
  const [state, setState] = useState<AppState>({ status: 'loading' })
  const [showHistory, setShowHistory] = useState(false)
  const relaySubCleanupRef = useRef<(() => void) | null>(null)
  const blossomSubCleanupRef = useRef<(() => void) | null>(null)
  const profileSubCleanupRef = useRef<(() => void) | null>(null)
  const clipboardSubRef = useRef<ClipboardSubscription | null>(null)
  const monitorRef = useRef<ClipboardMonitor | null>(null)
  const writeRelaysRef = useRef<string[]>([])
  const blossomServersRef = useRef<string[]>([])
  const lastSyncedTextRef = useRef<string>('')
  const lastSyncedImageFpRef = useRef<string>('')
  const visibilityCleanupRef = useRef<(() => void) | null>(null)
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isPublishingRef = useRef(false)
  const lastSubRestartRef = useRef(0)

  const getRelayStatus = useCallback(
    () => clipboardSubRef.current?.getRelayStatus() ?? Promise.resolve({}),
    [],
  )

  const startBlossomDiscovery = (userPubkey: string, writeRelays: string[]) => {
    blossomSubCleanupRef.current?.()
    blossomSubCleanupRef.current = subscribeBlossomServers(userPubkey, writeRelays, servers => {
      void saveBlossomServers(servers)
      blossomServersRef.current = servers
      setState(prev => prev.status === 'main' ? { ...prev, blossomServers: servers } : prev)
    }, getSharedPool())
  }

  const startProfileDiscovery = (userPubkey: string, writeRelays: string[]) => {
    profileSubCleanupRef.current?.()
    profileSubCleanupRef.current = subscribeProfile(userPubkey, writeRelays, profile => {
      void saveProfile(profile)
      setState(prev => prev.status === 'main' ? { ...prev, profile } : prev)
    }, getSharedPool())
  }

  const startRelayDiscovery = (userPubkey: string) => {
    relaySubCleanupRef.current?.()
    relaySubCleanupRef.current = subscribeWriteRelays(userPubkey, relays => {
      void saveWriteRelays(relays)
      writeRelaysRef.current = relays
      setState(prev => {
        if (prev.status !== 'main') return prev
        if (prev.writeRelays.length === relays.length && prev.writeRelays.every((r, i) => r === relays[i])) return prev
        return { ...prev, writeRelays: relays }
      })
      // write 릴레이 변경 시 Blossom·프로필·클립보드 구독도 새 릴레이로 재생성
      startBlossomDiscovery(userPubkey, relays)
      startProfileDiscovery(userPubkey, relays)
      restartClipboardSubscription(userPubkey)
      // Android: 네이티브 OkHttp 구독도 새 릴레이로 재시작 (startService Intent 경유)
      void startForegroundService(relays, userPubkey).catch(err => console.warn('[native-sub] relay change restart failed:', err))
    }, getSharedPool())
  }

  /** 클립보드 구독만 재시작 (릴레이 변경 시 또는 구독 복구 시) */
  const restartClipboardSubscription = (userPubkey: string) => {
    clipboardSubRef.current?.close()
    clipboardSubRef.current = startClipboardSubscription(
      userPubkey,
      writeRelaysRef.current,
      text => { monitorRef.current?.setLastKnown(text); lastSyncedTextRef.current = text },
      (fp, pngBytes) => {
        monitorRef.current?.setLastKnownImageFingerprint(fp)
        lastSyncedImageFpRef.current = `${pngBytes.length}:${Array.from(pngBytes.subarray(0, 64), b => b.toString(16).padStart(2, '0')).join('')}`
      },
    )
  }

  /** 모든 구독을 재시작 (포그라운드 복귀 시 연결이 죽었을 경우 대비) */
  const restartAllSubscriptions = (userPubkey: string) => {
    console.log('[app] restarting all subscriptions')
    startRelayDiscovery(userPubkey)
    startBlossomDiscovery(userPubkey, writeRelaysRef.current)
    startProfileDiscovery(userPubkey, writeRelaysRef.current)
    restartClipboardSubscription(userPubkey)
  }

  const startMonitor = async (userPubkey: string) => {
    monitorRef.current?.stop()
    monitorRef.current = await startPlatformClipboardMonitor(
      // 텍스트 변경
      (text: string) => {
        void publishClipboard(
          { type: 'text', content: text },
          writeRelaysRef.current,
        ).catch(err => console.error('[monitor] text publish failed:', err))
      },
      // 이미지 변경
      (rgba: Uint8Array, width: number, height: number) => {
        void (async () => {
          const servers = blossomServersRef.current
          if (servers.length === 0) {
            console.warn('[monitor] no Blossom servers — skipping image publish')
            return
          }
          try {
            const pngBytes = await rgbaToPng(rgba, width, height)
            const payload = await uploadImage(pngBytes, servers)
            await publishClipboard(payload, writeRelaysRef.current)
          } catch (err) {
            console.error('[monitor] image publish failed:', err)
          }
        })()
      },
    )
    // 수신한 텍스트를 클립보드에 썼을 때 재발행 루프 방지
    restartClipboardSubscription(userPubkey)
  }

  const enterMain = async (userPubkey: string) => {
    // 캐시된 릴레이/서버 즉시 로드
    const [cachedRelays, cachedBlossom, cachedProfile] = await Promise.all([
      loadWriteRelays(),
      loadBlossomServers(),
      loadProfile(),
    ])
    writeRelaysRef.current = cachedRelays
    blossomServersRef.current = cachedBlossom
    setState({ status: 'main', userPubkey, writeRelays: cachedRelays, blossomServers: cachedBlossom, profile: cachedProfile })

    // 캐시 없으면 네트워크에서 즉시 fetch
    const pool = getSharedPool()
    if (cachedRelays.length === 0) {
      const fetched = await fetchWriteRelays(userPubkey, pool)
      if (fetched) {
        await saveWriteRelays(fetched)
        writeRelaysRef.current = fetched
        setState(prev => prev.status === 'main' ? { ...prev, writeRelays: fetched } : prev)
      }
    }
    if (cachedBlossom.length === 0) {
      const fetched = await fetchBlossomServers(userPubkey, writeRelaysRef.current, pool)
      if (fetched) {
        await saveBlossomServers(fetched)
        blossomServersRef.current = fetched
        setState(prev => prev.status === 'main' ? { ...prev, blossomServers: fetched } : prev)
      }
    }
    if (!cachedProfile) {
      const fetched = await fetchProfile(userPubkey, writeRelaysRef.current, pool)
      if (fetched) {
        await saveProfile(fetched)
        setState(prev => prev.status === 'main' ? { ...prev, profile: fetched } : prev)
      }
    }

    // Android: Foreground Service 시작 + 네이티브 릴레이 구독 (캐시된 릴레이로 즉시)
    void startForegroundService(writeRelaysRef.current.length > 0 ? writeRelaysRef.current : undefined, writeRelaysRef.current.length > 0 ? userPubkey : undefined)
      .catch(err => console.warn('[foreground-service] start failed:', err))

    // Android: 네트워크 전환 시 WebSocket 즉시 재연결
    let cleanupNetworkListener: (() => void) | undefined
    void onNetworkChanged(type => {
      if (type === 'available') {
        console.log('[app] network available — restarting subscriptions')
        restartAllSubscriptions(userPubkey)
      }
    }).then(cleanup => { cleanupNetworkListener = cleanup })

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        // 백그라운드 진입: 네이티브에 알려서 수신 알림 활성화
        void setAppForeground(false)
        return
      }

      // 포그라운드 복귀: 네이티브 알림 억제 + 밀린 이벤트 히스토리 동기화
      void setAppForeground(true)

      // 포그라운드 복귀 시 상시 알림 강제 복원 + 네이티브 구독 재시작 (스와이프로 없어졌을 수 있으므로)
      if (isAndroid()) {
        void startForegroundService(writeRelaysRef.current, userPubkey).catch(err => console.warn('[foreground-service] restart failed:', err))

        // 네이티브 구독이 백그라운드에서 수신한 이벤트를 히스토리에 동기화
        void consumeNativeEvents().then(async (events) => {
          if (events.length === 0) return
          console.log(`[app] consuming ${events.length} native event(s) for history`)
          for (const evt of events) {
            try {
              if (await hasHistoryId(evt.id)) continue
              const plaintext = await getSigner().nip44Decrypt(userPubkey, evt.content)
              const payload = JSON.parse(plaintext) as ClipboardPayload
              await appendHistory({ id: evt.id, createdAt: evt.createdAt, payload })
            } catch (err) {
              console.warn('[app] native event history sync failed:', err)
            }
          }
        }).catch(err => console.warn('[app] consumeNativeEvents failed:', err))
      }

      // 포그라운드 복귀 시 구독 상태 확인 → 죽었으면 전부 재시작
      // - 발행 중(Amber 흐름)에는 하지 않음
      // - 10초 쿨다운: 새 구독이 EOSE를 받기 전에 또 재시작하는 cascade 방지
      if (!clipboardSubRef.current?.isAlive() && !isPublishingRef.current) {
        const now = Date.now()
        if (now - lastSubRestartRef.current > 10_000) {
          lastSubRestartRef.current = now
          console.warn('[app] subscription not alive on foreground — restarting subscriptions')
          restartAllSubscriptions(userPubkey)
        }
      }

      // Android: 앱이 포그라운드로 올라오면 클립보드를 읽어 변경된 내용이 있으면 발행
      // Amber 흐름 중 visibilitychange 가 반복 발생하므로 이미 발행 중이면 건너뜀
      if (isAndroid() && !isPublishingRef.current) {
        void (async () => {
          isPublishingRef.current = true
          try {
            let published = false
            // 이미지 먼저 확인
            try {
              const img = await readClipboardImage()
              if (img.hasImage && img.base64) {
                const binary = atob(img.base64)
                const pngBytes = new Uint8Array(binary.length)
                for (let i = 0; i < binary.length; i++) pngBytes[i] = binary.charCodeAt(i)
                const fp = `${pngBytes.length}:${Array.from(pngBytes.subarray(0, 64), b => b.toString(16).padStart(2, '0')).join('')}`
                if (fp !== lastSyncedImageFpRef.current) {
                  lastSyncedImageFpRef.current = fp
                  const servers = blossomServersRef.current
                  if (servers.length > 0) {
                    console.log('[sync] clipboard image changed, publishing…')
                    const payload = await uploadImage(pngBytes, servers)
                    await publishClipboard(payload, writeRelaysRef.current)
                  }
                }
                published = true
              }
            } catch { /* image read failed, fall through to text */ }
            // 이미지 없으면 텍스트 확인
            if (!published) {
              try {
                const { text } = await invoke<{ text: string }>('plugin:clipboard-action|read_clipboard_text')
                if (text && text !== lastSyncedTextRef.current) {
                  lastSyncedTextRef.current = text
                  console.log('[sync] clipboard changed, publishing…')
                  await publishClipboard(
                    { type: 'text', content: text },
                    writeRelaysRef.current,
                  ).catch(err => console.error('[sync] publish failed:', err))
                }
              } catch { /* ignore */ }
            }
          } finally {
            isPublishingRef.current = false
          }
        })()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    visibilityCleanupRef.current = () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      cleanupNetworkListener?.()
    }

    startRelayDiscovery(userPubkey)
    startBlossomDiscovery(userPubkey, writeRelaysRef.current)
    startProfileDiscovery(userPubkey, writeRelaysRef.current)
    startMonitor(userPubkey)

    // 15초 주기 헬스체크 — EOSE를 받지 못했거나 CLOSED된 경우 전체 구독 재시작
    // 발행 중이거나 10초 쿨다운 안이면 건너뜀 (visibilitychange와 동일한 쿨다운 공유)
    if (healthCheckRef.current) clearInterval(healthCheckRef.current)
    healthCheckRef.current = setInterval(() => {
      if (!clipboardSubRef.current?.isAlive() && !isPublishingRef.current) {
        const now = Date.now()
        if (now - lastSubRestartRef.current > 10_000) {
          lastSubRestartRef.current = now
          console.warn('[health] subscription not alive — restarting all subscriptions')
          restartAllSubscriptions(userPubkey)
        }
      }
    }, 15_000)
  }

  const logout = async () => {
    if (healthCheckRef.current) { clearInterval(healthCheckRef.current); healthCheckRef.current = null }
    relaySubCleanupRef.current?.()
    blossomSubCleanupRef.current?.()
    profileSubCleanupRef.current?.()
    clipboardSubRef.current?.close()
    monitorRef.current?.stop()
    visibilityCleanupRef.current?.()
    clearSigner()
    destroySharedPool()
    void stopNativeSubscription().catch(() => {})
    await stopForegroundService().catch(() => {})
    await Promise.all([
      clearAuth(),
      clearWriteRelays(),
      clearBlossomServers(),
      clearProfile(),
      clearHistory(),
    ])
    setState({ status: 'login' })
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const auth = await loadAuth()
      if (cancelled) return
      if (!auth) {
        setState({ status: 'login' })
        return
      }
      try {
        if (auth.signerType === 'amber') {
          const { AmberSigner } = await import('./platform/amber')
          if (cancelled) return
          setSigner(new AmberSigner(auth.userPubkey, auth.amberPackage ?? ''))
        } else {
          const signer = restoreSigner(auth.clientPrivkey!, auth.signerPubkey!, auth.signerRelays!)
          setSigner(signer)
        }
        if (cancelled) return
        void enterMain(auth.userPubkey)
      } catch {
        if (cancelled) return
        void clearAuth()
        setState({ status: 'login' })
      }
    })()

    return () => {
      cancelled = true
      if (healthCheckRef.current) clearInterval(healthCheckRef.current)
      relaySubCleanupRef.current?.()
      blossomSubCleanupRef.current?.()
      profileSubCleanupRef.current?.()
      clipboardSubRef.current?.close()
      monitorRef.current?.stop()
      visibilityCleanupRef.current?.()
    }
  }, [])

  let page: React.JSX.Element

  if (state.status === 'loading') {
    page = (
      <div style={s.center}>
        <p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>{t('app.loading')}</p>
      </div>
    )
  } else if (state.status === 'login') {
    page = (
      <Login
        onLogin={() => {
          loadAuth().then(auth => {
            if (auth) void enterMain(auth.userPubkey)
          })
        }}
      />
    )
  } else if (showHistory) {
    page = (
      <History
        onBack={() => setShowHistory(false)}
        setLastKnown={text => monitorRef.current?.setLastKnown(text)}
        setLastKnownImageFingerprint={fp => monitorRef.current?.setLastKnownImageFingerprint(fp)}
      />
    )
  } else {
    const { userPubkey, writeRelays, blossomServers, profile } = state
    page = (
      <Main
        userPubkey={userPubkey}
        writeRelays={writeRelays}
        blossomServers={blossomServers}
        profile={profile}
        onShowHistory={() => setShowHistory(true)}
        onLogout={() => void logout()}
        getRelayStatus={getRelayStatus}
      />
    )
  }

  return (
    <>
      {page}
      <ToastContainer />
    </>
  )
}

export default App

const s = {
  center: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: 6,
    padding: 24,
  },
} as const
