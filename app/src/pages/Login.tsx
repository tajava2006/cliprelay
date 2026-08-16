/**
 * NIP-46 로그인 화면
 *
 * 세 가지 방식 지원:
 *   1. Amber — 같은 기기의 Amber와 Intent 직결 (Android + Amber 설치 시)
 *   2. QR 코드 — nostrconnect:// URI를 표시, 벙커 앱(Amber 등)으로 스캔.
 *      Android에서도 노출 — 다른 폰의 Amber로 스캔하면 그 폰 계정으로 로그인
 *      (nsec는 그 폰 밖으로 안 나옴). 같은 기기에 Amber가 있으면 QR 탭으로
 *      Intent 로그인도 가능.
 *   3. bunker URL — 직접 붙여넣기, 또는 (Android) 카메라로 벙커 앱의
 *      bunker URL QR을 스캔 — 비밀 토큰이 든 문자열을 메신저로 옮길 필요 없음.
 *
 * 로그인 성공 시 AuthState를 Tauri Store에 저장하고 onLogin() 콜백 호출.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  generateClientKey,
  createConnectURI,
  connectFromURI,
  connectFromBunkerURL,
  bytesToHex,
} from '@cliprelay/shared'
import { getPublicKey } from 'nostr-tools/pure'
import type { BunkerSigner } from 'nostr-tools/nip46'
import { saveAuth } from '../store/auth-store'
import { setSigner } from '../platform/signer'
import { makeResilientSigner } from '../platform/resilient-signer'
import { isAndroid } from '../platform/detect'
import { t } from '../i18n'

type LoginMode = 'qr' | 'bunker' | 'amber'

type LoginPhase =
  | { status: 'idle' }
  | { status: 'waiting_qr'; uri: string }
  | { status: 'scanning' }
  | { status: 'connecting' }
  | { status: 'error'; message: string }

const CONNECTION_TIMEOUT_MS = 5 * 60 * 1000

interface LoginProps {
  onLogin: () => void
}

export function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<LoginMode>(isAndroid() ? 'amber' : 'qr')
  const [phase, setPhase] = useState<LoginPhase>({ status: 'idle' })
  const [bunkerInput, setBunkerInput] = useState('')
  const [amberAvailable, setAmberAvailable] = useState<boolean | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const clientKeyRef = useRef<Uint8Array | null>(null)
  const scanCancelledRef = useRef(false)

  // Android: Amber 설치 여부 확인 (미설치 시 QR 모드 — 다른 기기 벙커로 스캔 로그인)
  useEffect(() => {
    if (!isAndroid()) return
    void (async () => {
      try {
        const { isAmberInstalled } = await import('../platform/android/amber')
        const installed = await isAmberInstalled()
        setAmberAvailable(installed)
        if (!installed) setMode('qr')
      } catch {
        setAmberAvailable(false)
        setMode('qr')
      }
    })()
  }, [])

  // Amber 로그인
  const loginWithAmber = useCallback(async () => {
    setPhase({ status: 'connecting' })
    try {
      const { getAmberPublicKey, AmberSigner } = await import('../platform/android/amber')
      const { pubkey, packageName } = await getAmberPublicKey()
      const signer = new AmberSigner(pubkey)
      setSigner(signer)
      await saveAuth({
        signerType: 'amber',
        userPubkey: pubkey,
        amberPackage: packageName,
      })
      onLogin()
    } catch (err) {
      setPhase({ status: 'error', message: err instanceof Error ? err.message : t('login.error.default') })
    }
  }, [onLogin])

  const finalizeLogin = useCallback(
    async (signer: BunkerSigner, clientKey: Uint8Array) => {
      setPhase({ status: 'connecting' })
      const userPubkey = await signer.getPublicKey()
      // 타임아웃+자가재생성 래퍼로 감싼다 — 로그인 직후의 내부 pool은 재연결이 없는
      // 기본값이지만, 첫 타임아웃 때 rebuild가 튼튼한 pool로 갈아끼운다
      setSigner(makeResilientSigner(signer))
      await saveAuth({
        signerType: 'bunker',
        clientPrivkey: bytesToHex(clientKey),
        clientPubkey: getPublicKey(clientKey),
        signerPubkey: signer.bp.pubkey,
        userPubkey,
        signerRelays: signer.bp.relays,
      })
      onLogin()
    },
    [onLogin],
  )

  // ─── QR 코드 방식 ──────────────────────────────────────────

  const startQR = useCallback(async () => {
    abortRef.current?.abort()
    const clientKey = generateClientKey()
    clientKeyRef.current = clientKey
    const uri = createConnectURI(clientKey)

    const abort = new AbortController()
    abortRef.current = abort
    // 타임아웃 abort와 탭 전환/언마운트 abort 구분 — 후자는 조용히 끝낸다
    let timedOut = false
    setTimeout(() => { timedOut = true; abort.abort() }, CONNECTION_TIMEOUT_MS)

    setPhase({ status: 'waiting_qr', uri })

    try {
      const signer = await connectFromURI(clientKey, uri, abort.signal)
      await finalizeLogin(signer, clientKey)
    } catch (err) {
      if (abort.signal.aborted) {
        if (timedOut) setPhase({ status: 'error', message: t('login.error.timeout') })
      } else {
        setPhase({ status: 'error', message: err instanceof Error ? err.message : t('login.error.default') })
      }
    }
  }, [finalizeLogin])

  useEffect(() => {
    if (mode === 'qr') startQR()
    return () => { abortRef.current?.abort() }
  }, [mode, startQR])

  // ─── bunker:// URL 방식 ─────────────────────────────────────

  const connectBunker = useCallback(
    async (url: string) => {
      abortRef.current?.abort()

      const clientKey = clientKeyRef.current ?? generateClientKey()
      clientKeyRef.current = clientKey

      setPhase({ status: 'connecting' })
      try {
        const signer = await connectFromBunkerURL(clientKey, url)
        await finalizeLogin(signer, clientKey)
      } catch (err) {
        setPhase({ status: 'error', message: err instanceof Error ? err.message : t('login.error.default') })
      }
    },
    [finalizeLogin],
  )

  const submitBunkerURL = useCallback(() => {
    if (!bunkerInput.trim()) return
    void connectBunker(bunkerInput.trim())
  }, [bunkerInput, connectBunker])

  // Android: 벙커 앱이 보여주는 bunker URL QR을 카메라로 스캔 → 바로 연결.
  // 비밀 토큰이 든 문자열을 메신저/메일로 옮기지 않기 위한 오프라인 전달 경로.
  const startScan = useCallback(async () => {
    scanCancelledRef.current = false
    setPhase({ status: 'scanning' })
    try {
      const scanMod = await import('../platform/android/scan')
      try {
        const content = (await scanMod.scanQR()).trim()
        if (!content.toLowerCase().startsWith('bunker://')) {
          setPhase({ status: 'error', message: t('login.scan.error.invalid') })
          return
        }
        setBunkerInput(content)
        await connectBunker(content)
      } catch (err) {
        if (scanCancelledRef.current) {
          setPhase({ status: 'idle' })
        } else if (err instanceof scanMod.CameraPermissionError) {
          setPhase({ status: 'error', message: t('login.scan.error.permission') })
        } else {
          setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      }
    } catch {
      // 플러그인 모듈 로드 실패 (비-Android 등)
      setPhase({ status: 'error', message: t('login.error.default') })
    }
  }, [connectBunker])

  const cancelScanning = useCallback(async () => {
    scanCancelledRef.current = true
    const { cancelScan } = await import('../platform/android/scan')
    await cancelScan()
  }, [])

  // ─── 렌더 ──────────────────────────────────────────────────

  // 카메라 스캔 중: 카메라 프리뷰가 WebView 뒤에 깔리므로 페이지 전체를
  // 투명하게 두고 뷰파인더 프레임 + 취소 버튼만 그린다 (배경 투명화는 scan.ts).
  if (phase.status === 'scanning') {
    return (
      <div style={s.scanRoot}>
        <div style={s.scanFrame} />
        <div style={s.scanBottom}>
          <p style={s.scanHint}>{t('login.bunker.scan_hint')}</p>
          <button style={s.button} onClick={() => void cancelScanning()}>
            {t('login.scan.cancel')}
          </button>
        </div>
      </div>
    )
  }

  const canTapAmber = isAndroid() && amberAvailable === true

  return (
    <div style={s.root}>
      <div style={s.card}>
        <h1 style={s.title}>{t('app.title')}</h1>
        <p style={s.subtitle}>{t('login.subtitle')}</p>

        {/* 탭 */}
        <div style={s.tabs}>
          {amberAvailable && (
            <button style={{ ...s.tab, ...(mode === 'amber' ? s.tabActive : {}) }} onClick={() => setMode('amber')}>
              {t('login.tab.amber')}
            </button>
          )}
          <button style={{ ...s.tab, ...(mode === 'qr' ? s.tabActive : {}) }} onClick={() => setMode('qr')}>
            {t('login.tab.qr')}
          </button>
          <button style={{ ...s.tab, ...(mode === 'bunker' ? s.tabActive : {}) }} onClick={() => setMode('bunker')}>
            {t('login.tab.bunker')}
          </button>
        </div>

        {/* Amber 모드 */}
        {mode === 'amber' && (
          <>
            <p style={s.hint}>{t('login.amber.hint')}</p>
            <button
              style={s.button}
              onClick={loginWithAmber}
              disabled={phase.status === 'connecting'}
            >
              {phase.status === 'connecting' ? t('login.connecting') : t('login.amber.connect')}
            </button>
          </>
        )}

        {/* QR 모드 */}
        {mode === 'qr' && (
          <>
            {phase.status === 'waiting_qr' && (
              <>
                <div
                  style={{ ...s.qrBox, ...(canTapAmber ? { cursor: 'pointer' } : {}) }}
                  onClick={canTapAmber ? loginWithAmber : undefined}
                  role={canTapAmber ? 'button' : undefined}
                >
                  <QRCodeSVG value={phase.uri} size={220} level="M" />
                </div>
                <p style={s.hint}>{t('login.qr.hint')}</p>
                {canTapAmber && <p style={s.tapHint}>{t('login.qr.tap_amber')}</p>}
                <details style={s.details}>
                  <summary style={s.summary}>{t('login.qr.copy_uri')}</summary>
                  <textarea
                    readOnly
                    value={phase.uri}
                    style={s.uriText}
                    onClick={e => (e.target as HTMLTextAreaElement).select()}
                  />
                </details>
                <p style={s.waiting}>{t('login.qr.waiting')}</p>
              </>
            )}
            {phase.status === 'connecting' && <p style={s.status}>{t('login.connecting')}</p>}
          </>
        )}

        {/* bunker URL 모드 */}
        {mode === 'bunker' && (
          <>
            {isAndroid() && (
              <button
                style={s.scanButton}
                onClick={() => void startScan()}
                disabled={phase.status === 'connecting'}
              >
                {t('login.bunker.scan')}
              </button>
            )}
            <textarea
              style={s.input}
              placeholder={t('login.bunker.placeholder')}
              value={bunkerInput}
              onChange={e => setBunkerInput(e.target.value)}
              rows={4}
            />
            <button
              style={s.button}
              onClick={submitBunkerURL}
              disabled={phase.status === 'connecting' || !bunkerInput.trim()}
            >
              {phase.status === 'connecting' ? t('login.connecting') : t('login.bunker.connect')}
            </button>
          </>
        )}

        {/* 에러 */}
        {phase.status === 'error' && (
          <div style={s.errorBox}>
            <p style={s.errorMsg}>{phase.message}</p>
            <button
              style={s.button}
              onClick={mode === 'qr' ? startQR : mode === 'amber' ? loginWithAmber : submitBunkerURL}
            >
              {t('login.retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  root: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    background: '#f5f5f5',
    padding: 16,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '36px 28px',
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
    textAlign: 'center' as const,
  },
  title: { fontSize: 22, fontWeight: 700, margin: '0 0 4px', color: '#111' },
  subtitle: { fontSize: 13, color: '#888', margin: '0 0 24px' },
  tabs: { display: 'flex', gap: 8, marginBottom: 24, justifyContent: 'center' },
  tab: {
    padding: '8px 20px',
    borderRadius: 8,
    border: '1px solid #ddd',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 13,
    color: '#555',
  },
  tabActive: { background: '#111', color: '#fff', borderColor: '#111' },
  qrBox: {
    display: 'inline-block',
    padding: 14,
    border: '1px solid #eee',
    borderRadius: 12,
    marginBottom: 16,
  },
  hint: { fontSize: 14, color: '#444', margin: '0 0 12px', fontWeight: 500 },
  tapHint: { fontSize: 12, color: '#888', margin: '-6px 0 12px' },
  details: { textAlign: 'left' as const, marginBottom: 16 },
  summary: { fontSize: 12, color: '#999', cursor: 'pointer' },
  uriText: {
    width: '100%',
    height: 72,
    marginTop: 8,
    padding: 8,
    fontSize: 11,
    fontFamily: 'monospace',
    border: '1px solid #eee',
    borderRadius: 6,
    resize: 'none' as const,
    color: '#555',
    wordBreak: 'break-all' as const,
    boxSizing: 'border-box' as const,
  },
  waiting: { fontSize: 12, color: '#aaa', margin: 0 },
  status: { fontSize: 14, color: '#999', padding: '32px 0' },
  input: {
    width: '100%',
    padding: 10,
    fontSize: 12,
    fontFamily: 'monospace',
    border: '1px solid #ddd',
    borderRadius: 8,
    resize: 'none' as const,
    marginBottom: 12,
    boxSizing: 'border-box' as const,
    color: '#333',
  },
  button: {
    padding: '10px 28px',
    fontSize: 14,
    fontWeight: 600,
    background: '#111',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  errorBox: { paddingTop: 16 },
  errorMsg: { fontSize: 13, color: '#b91c1c', margin: '0 0 16px', lineHeight: 1.6 },
  scanButton: {
    width: '100%',
    padding: '10px 28px',
    fontSize: 14,
    fontWeight: 600,
    background: '#fff',
    color: '#111',
    border: '1px solid #111',
    borderRadius: 8,
    cursor: 'pointer',
    marginBottom: 12,
    boxSizing: 'border-box' as const,
  },
  scanRoot: {
    position: 'fixed' as const,
    inset: 0,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'transparent',
  },
  scanFrame: {
    width: '64vmin',
    aspectRatio: '1',
    border: '2px solid rgba(255,255,255,0.9)',
    borderRadius: 16,
    // 프레임 밖 전체를 어둡게 — 카메라 프리뷰는 뒤에서 그대로 비침
    boxShadow: '0 0 0 200vmax rgba(0,0,0,0.4)',
  },
  scanBottom: {
    position: 'fixed' as const,
    bottom: 40,
    left: 0,
    right: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
  },
  scanHint: {
    fontSize: 14,
    color: '#fff',
    margin: 0,
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
    padding: '0 24px',
    textAlign: 'center' as const,
  },
} as const
