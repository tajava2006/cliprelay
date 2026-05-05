/**
 * 데스크탑 자동 업데이트 배너
 *
 * 새 버전이 감지되면 화면 상단에 띄운다. "지금 설치" 누르면 다운로드 후 재시작.
 */
import { useEffect, useState } from 'react'
import { startUpdateChecker, type PendingUpdate } from '../updater/check'
import { t } from '../i18n'
import { toast } from '../toast'

type Phase = 'idle' | 'downloading' | 'installing'

export function UpdateBanner() {
  const [update, setUpdate] = useState<PendingUpdate | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<{ downloaded: number; total: number | undefined } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => startUpdateChecker(setUpdate), [])

  if (!update || dismissed) return null

  const onInstall = async () => {
    try {
      setPhase('downloading')
      await update.download((downloaded, total) => setProgress({ downloaded, total }))
      setPhase('installing')
      await update.installAndRelaunch()
    } catch (err) {
      console.error('[updater] install failed', err)
      toast(t('update.failed'), 'error')
      setPhase('idle')
      setProgress(null)
    }
  }

  const pct = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : null
  const busy = phase !== 'idle'

  return (
    <div style={s.bar}>
      <span style={s.text}>
        {phase === 'downloading' && pct !== null
          ? `${t('update.downloading')} ${pct}%`
          : phase === 'downloading'
          ? t('update.downloading')
          : phase === 'installing'
          ? t('update.installing')
          : `${t('update.available')} v${update.version}`}
      </span>
      <div style={s.actions}>
        <button style={s.primary} disabled={busy} onClick={onInstall}>
          {t('update.download')}
        </button>
        <button style={s.secondary} disabled={busy} onClick={() => setDismissed(true)}>
          {t('update.later')}
        </button>
      </div>
    </div>
  )
}

const s = {
  bar: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 14px',
    background: 'rgba(59, 130, 246, 0.95)',
    color: 'white',
    fontSize: 12,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
    zIndex: 10000,
  },
  text: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  actions: {
    display: 'flex',
    gap: 6,
    flexShrink: 0,
  },
  primary: {
    background: 'white',
    color: '#1e3a5f',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondary: {
    background: 'transparent',
    color: 'white',
    border: '1px solid rgba(255, 255, 255, 0.5)',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  },
} as const
