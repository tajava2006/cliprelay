/**
 * 앱 루트 컴포넌트
 *
 * 마운트 시 Tauri Store에서 auth 로드:
 *   - 없으면 → Login 화면
 *   - 있으면 → Signer 복원 → 캐시·네트워크 디스커버리 → SyncEngine 시작 → 메인 화면
 *   - 복원 실패 시 → auth 삭제 후 Login 화면
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { loadAuth, clearAuth } from './store/auth-store'
import { loadWriteRelays, saveWriteRelays, clearWriteRelays } from './store/relay-store'
import { loadBlossomServers, saveBlossomServers, clearBlossomServers } from './store/blossom-store'
import { loadProfile, saveProfile, clearProfile } from './store/profile-store'
import { setSigner, clearSigner } from './platform/signer'
import { destroySharedPool, getSharedPool } from './nostr/pool'
import { startForegroundService, stopForegroundService, onNetworkChanged, startNativeSubscription, stopNativeSubscription, setAppForeground } from './platform/android/foreground-service'
import { androidOnForeground } from './platform/android/lifecycle'
import { publishDefaultRelayList, publishDefaultBlossomList } from './nostr/setup'
import { clearHistory } from './store/history-store'
import { SyncEngine } from './clipboard/sync'
import {
  restoreSigner,
  fetchWriteRelays,
  fetchBlossomServers,
  fetchProfile,
  DEFAULT_WRITE_RELAYS, DEFAULT_BLOSSOM_SERVERS,
} from '@cliprelay/shared'
import type { UserProfile } from '@cliprelay/shared'
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
  const syncRef = useRef<SyncEngine | null>(null)
  const visibilityCleanupRef = useRef<(() => void) | null>(null)

  const getRelayStatus = useCallback(
    () => syncRef.current?.getRelayStatus() ?? Promise.resolve({}),
    [],
  )

  const enterMain = async (userPubkey: string) => {
    // 캐시된 릴레이/서버 즉시 로드
    const [cachedRelays, cachedBlossom, cachedProfile] = await Promise.all([
      loadWriteRelays(),
      loadBlossomServers(),
      loadProfile(),
    ])
    let writeRelays = cachedRelays
    let blossomServers = cachedBlossom
    setState({ status: 'main', userPubkey, writeRelays, blossomServers, profile: cachedProfile })

    // 캐시 없으면 네트워크에서 즉시 fetch
    const pool = getSharedPool()
    if (writeRelays.length === 0) {
      const fetched = await fetchWriteRelays(userPubkey, pool)
      if (fetched) {
        await saveWriteRelays(fetched)
        writeRelays = fetched
      } else {
        // kind:10002 없는 완전 초보자 — 디폴트 릴레이 자동 발행
        const ok = await publishDefaultRelayList(DEFAULT_WRITE_RELAYS)
        if (ok) {
          await saveWriteRelays(DEFAULT_WRITE_RELAYS)
          writeRelays = DEFAULT_WRITE_RELAYS
        }
      }
      if (writeRelays.length > 0) setState(prev => prev.status === 'main' ? { ...prev, writeRelays } : prev)
    }
    if (blossomServers.length === 0) {
      const fetched = await fetchBlossomServers(userPubkey, writeRelays, pool)
      if (fetched) {
        await saveBlossomServers(fetched)
        blossomServers = fetched
      } else if (writeRelays.length > 0) {
        // kind:10063 없는 완전 초보자 — 디폴트 Blossom 서버 자동 발행
        const ok = await publishDefaultBlossomList(DEFAULT_BLOSSOM_SERVERS, writeRelays)
        if (ok) {
          await saveBlossomServers(DEFAULT_BLOSSOM_SERVERS)
          blossomServers = DEFAULT_BLOSSOM_SERVERS
        }
      }
      if (blossomServers.length > 0) setState(prev => prev.status === 'main' ? { ...prev, blossomServers } : prev)
    }
    if (!cachedProfile) {
      const fetched = await fetchProfile(userPubkey, writeRelays, pool)
      if (fetched) {
        await saveProfile(fetched)
        setState(prev => prev.status === 'main' ? { ...prev, profile: fetched } : prev)
      }
    }

    // SyncEngine 시작 (디스커버리·구독·모니터·헬스체크 모두)
    const sync = new SyncEngine({
      userPubkey,
      writeRelays,
      blossomServers,
      onWriteRelaysChange: relays => setState(prev => prev.status === 'main' ? { ...prev, writeRelays: relays } : prev),
      onBlossomServersChange: servers => setState(prev => prev.status === 'main' ? { ...prev, blossomServers: servers } : prev),
      onProfileChange: profile => setState(prev => prev.status === 'main' ? { ...prev, profile } : prev),
    })
    syncRef.current = sync
    void sync.start()

    // Android: Foreground Service 시작 + 네이티브 릴레이 구독 (캐시된 릴레이가 있으면)
    void startForegroundService().catch(err => console.warn('[foreground-service] start failed:', err))
    if (writeRelays.length > 0) {
      void startNativeSubscription(writeRelays, userPubkey)
        .catch(err => console.warn('[native-sub] start failed:', err))
    }

    // Android: 네트워크 전환 시 WebSocket 즉시 재연결
    let cleanupNetworkListener: (() => void) | undefined
    void onNetworkChanged(type => {
      if (type === 'available') {
        console.log('[app] network available — restarting subscriptions')
        sync.restartAll()
      }
    }).then(cleanup => { cleanupNetworkListener = cleanup })

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        // 백그라운드 진입: 네이티브에 알려서 수신 알림 활성화
        void setAppForeground(false)
        return
      }

      // 포그라운드 복귀: 네이티브 알림 억제
      void setAppForeground(true)

      // Android 라이프사이클 (서비스/구독 재시작 + 백그라운드 이벤트 히스토리 동기화 + 클립보드 발행)
      void androidOnForeground(userPubkey, sync)

      // 구독 상태 확인 → 죽었으면 전부 재시작 (쿨다운 적용)
      sync.maybeRestartIfDead()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    visibilityCleanupRef.current = () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      cleanupNetworkListener?.()
    }
  }

  const logout = async () => {
    syncRef.current?.stop(); syncRef.current = null
    visibilityCleanupRef.current?.(); visibilityCleanupRef.current = null
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
          const { AmberSigner } = await import('./platform/android/amber')
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
      syncRef.current?.stop()
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
        setLastKnown={text => syncRef.current?.setMonitorLastKnownText(text)}
        setLastKnownImageFingerprint={fp => syncRef.current?.setMonitorLastKnownImageFingerprint(fp)}
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
