/**
 * NIP-46 로그인 화면
 *
 * 두 가지 방식 지원:
 *   1. QR 코드 — nostrconnect:// URI를 표시, 벙커 앱(Amber 등)으로 스캔
 *   2. bunker URL — 벙커 앱에서 복사한 bunker:// URL 직접 입력
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
import { isAndroid } from '../platform/detect'
import { t } from '../i18n'

type LoginMode = 'qr' | 'bunker' | 'amber'

type LoginPhase =
  | { status: 'idle' }
  | { status: 'waiting_qr'; uri: string }
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

  // Android: Amber 설치 여부 확인
  useEffect(() => {
    if (!isAndroid()) return
    void (async () => {
      try {
        const { isAmberInstalled } = await import('../platform/amber')
        const installed = await isAmberInstalled()
        setAmberAvailable(installed)
        if (!installed) setMode('bunker')
      } catch {
        setAmberAvailable(false)
        setMode('bunker')
      }
    })()
  }, [])

  // Amber 로그인
  const loginWithAmber = useCallback(async () => {
    setPhase({ status: 'connecting' })
    try {
      const { getAmberPublicKey, AmberSigner } = await import('../platform/amber')
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
      setSigner(signer)
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
    setTimeout(() => abort.abort(), CONNECTION_TIMEOUT_MS)

    setPhase({ status: 'waiting_qr', uri })

    try {
      const signer = await connectFromURI(clientKey, uri, abort.signal)
      await finalizeLogin(signer, clientKey)
    } catch (err) {
      if (abort.signal.aborted) {
        setPhase({ status: 'error', message: t('login.error.timeout') })
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

  const submitBunkerURL = useCallback(async () => {
    if (!bunkerInput.trim()) return
    abortRef.current?.abort()

    const clientKey = clientKeyRef.current ?? generateClientKey()
    clientKeyRef.current = clientKey

    setPhase({ status: 'connecting' })
    try {
      const signer = await connectFromBunkerURL(clientKey, bunkerInput.trim())
      await finalizeLogin(signer, clientKey)
    } catch (err) {
      setPhase({ status: 'error', message: err instanceof Error ? err.message : t('login.error.default') })
    }
  }, [bunkerInput, finalizeLogin])

  // ─── 렌더 ──────────────────────────────────────────────────

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
          {!isAndroid() && (
            <button style={{ ...s.tab, ...(mode === 'qr' ? s.tabActive : {}) }} onClick={() => setMode('qr')}>
              {t('login.tab.qr')}
            </button>
          )}
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
                <div style={s.qrBox}>
                  <QRCodeSVG value={phase.uri} size={220} level="M" />
                </div>
                <p style={s.hint}>{t('login.qr.hint')}</p>
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
            <button style={s.button} onClick={mode === 'qr' ? startQR : submitBunkerURL}>
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
} as const
