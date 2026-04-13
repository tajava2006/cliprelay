/**
 * 메인 화면
 *
 * 프로필 카드 + write 릴레이 + Blossom 서버 목록을 표시한다.
 * - 프로필: kind:0 메타데이터 (이름, 사진, nip05). 없으면 npub 표시.
 * - 릴레이: 기존 구독 pool의 연결 상태를 5초마다 폴링
 * - Blossom: URL만 표시 (실시간 연결 유지 대상 아님)
 */
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { pubkeyToNpub } from '@cliprelay/shared'
import type { UserProfile } from '@cliprelay/shared'
import { isAndroid } from '../platform/detect'
import {
  getPermissionStatus,
  requestNotificationPermission,
  requestBatteryExemption,
  type PermissionStatus,
} from '../platform/foreground-service'

type ConnStatus = 'checking' | 'ok' | 'error'

interface MainProps {
  userPubkey: string
  writeRelays: string[]
  blossomServers: string[]
  profile: UserProfile | null
  onShowHistory: () => void
  onLogout: () => void
  getRelayStatus: () => Promise<Record<string, boolean>>
}

const POLL_INTERVAL_MS = 5000

export function Main({ userPubkey, writeRelays, blossomServers, profile, onShowHistory, onLogout, getRelayStatus }: MainProps) {
  const [relayStatus, setRelayStatus] = useState<Record<string, ConnStatus>>({})
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null)

  const npub = pubkeyToNpub(userPubkey)
  const displayName = profile?.display_name || profile?.name || null

  const refreshPermissions = async () => {
    if (!isAndroid()) return
    try {
      const status = await getPermissionStatus()
      setPermissions(status)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    // 새로 추가된 릴레이만 'checking'으로 초기화 — 기존 릴레이 상태는 유지해 점이 깜빡이지 않도록
    setRelayStatus(prev => {
      const next: Record<string, ConnStatus> = {}
      for (const r of writeRelays) next[r] = prev[r] ?? 'checking'
      return next
    })

    let stopped = false

    const poll = async () => {
      if (stopped) return
      const status = await getRelayStatus()
      if (stopped) return
      const next: Record<string, ConnStatus> = {}
      for (const relay of writeRelays) {
        next[relay] = status[relay] ? 'ok' : 'error'
      }
      setRelayStatus(next)
    }

    void poll()
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [writeRelays, getRelayStatus])

  // Android: 권한 상태 초기 로드 + 설정창 복귀 시 자동 갱신
  useEffect(() => {
    if (!isAndroid()) return
    void refreshPermissions()
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshPermissions() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return (
    <div style={s.root}>
      <h1 style={s.title}>{t('app.title')}</h1>

      {/* ─── Profile Card ─── */}
      {profile?.banner && <img src={profile.banner} alt="" style={s.banner} />}
      <div style={s.card}>
        {profile?.picture
          ? <img src={profile.picture} alt="" style={s.avatar} />
          : <div style={s.avatarFallback}>{(displayName || '?')[0].toUpperCase()}</div>
        }
        <div style={s.cardBody}>
          {displayName && <p style={s.displayName}>{displayName}</p>}
          {profile?.nip05 && <p style={s.nip05}>{profile.nip05}</p>}
          <p style={s.npub}>{npub.slice(0, 16)}...{npub.slice(-8)}</p>
        </div>
      </div>
      {(profile?.about || profile?.lud16 || profile?.lud06 || profile?.website) && (
        <div style={s.details}>
          {profile.about && <p style={s.about}>{profile.about}</p>}
          {(profile.lud16 || profile.lud06) && (
            <div style={s.detailRow}>
              <span style={s.detailLabel}>Lightning</span>
              <span style={s.detailValue}>{profile.lud16 || profile.lud06}</span>
            </div>
          )}
          {profile.website && (
            <div style={s.detailRow}>
              <span style={s.detailLabel}>Website</span>
              <span style={s.detailValue}>{profile.website}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Android 권한 상태 ─── */}
      {isAndroid() && permissions && (!permissions.notificationGranted || !permissions.batteryExempted) && (
        <div style={s.permSection}>
          <h3 style={s.sectionTitle}>{t('main.perm.section')}</h3>

          {!permissions.notificationGranted && (
            <div style={s.permRow}>
              <div style={s.permInfo}>
                <span style={s.permLabel}>{t('main.perm.notification.label')}</span>
                <span style={s.permDesc}>{t('main.perm.notification.desc')}</span>
              </div>
              <button
                style={s.permBtn}
                onClick={() => { void requestNotificationPermission() }}
              >
                {t('main.perm.notification.btn')}
              </button>
            </div>
          )}

          {!permissions.batteryExempted && (
            <div style={s.permRow}>
              <div style={s.permInfo}>
                <span style={s.permLabel}>{t('main.perm.battery.label')}</span>
                <span style={s.permDesc}>{t('main.perm.battery.desc')}</span>
              </div>
              <button
                style={s.permBtn}
                onClick={() => { void requestBatteryExemption() }}
              >
                {t('main.perm.battery.btn')}
              </button>
            </div>
          )}
        </div>
      )}

      <div style={s.section}>
        <h3 style={s.sectionTitle}>{t('main.relays')}</h3>
        {writeRelays.length === 0
          ? <p style={s.warn}>{t('main.relays.empty')}</p>
          : writeRelays.map(relay => (
              <div key={relay} style={s.serverRow}>
                <span style={s.statusDot(relayStatus[relay])} />
                <span style={s.serverUrl}>{relay.replace(/^wss?:\/\//, '')}</span>
              </div>
            ))
        }
      </div>

      <div style={s.section}>
        <h3 style={s.sectionTitle}>{t('main.blossom')}</h3>
        {blossomServers.length === 0
          ? <p style={s.muted}>{t('main.blossom.empty')}</p>
          : blossomServers.map(server => (
              <div key={server} style={s.serverRow}>
                <span style={s.serverUrl}>{server.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
              </div>
            ))
        }
      </div>

      <button style={s.historyBtn} onClick={onShowHistory}>
        {t('main.history')}
      </button>

      <button style={s.logoutBtn} onClick={onLogout}>
        {t('main.logout')}
      </button>
    </div>
  )
}

const statusColor = (status?: ConnStatus) => {
  if (status === 'ok') return '#16a34a'
  if (status === 'error') return '#dc2626'
  return '#d4d4d4'
}

const s = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: 24,
    gap: 8,
    height: '100vh',
    overflowY: 'auto' as const,
  },
  title: { fontSize: 20, fontWeight: 700, margin: 0 },

  // ─── Profile Card ───
  banner: {
    width: '100%',
    maxWidth: 360,
    height: 80,
    objectFit: 'cover' as const,
    borderRadius: '12px 12px 0 0',
    marginTop: 8,
    marginBottom: -8,
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 360,
    padding: 14,
    marginTop: 8,
    background: '#f8f8f8',
    borderRadius: 12,
    border: '1px solid #e5e5e5',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    objectFit: 'cover' as const,
    flexShrink: 0,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: '#ddd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 700,
    color: '#888',
    flexShrink: 0,
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    minWidth: 0,
  },
  displayName: {
    fontSize: 15,
    fontWeight: 600,
    color: '#111',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  nip05: {
    fontSize: 12,
    color: '#666',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  npub: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#999',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  // ─── Profile Details ───
  details: {
    width: '100%',
    maxWidth: 360,
    padding: '10px 14px',
    background: '#f8f8f8',
    borderRadius: 10,
    border: '1px solid #e5e5e5',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  about: {
    fontSize: 13,
    color: '#444',
    margin: 0,
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#999',
    textTransform: 'uppercase' as const,
    flexShrink: 0,
    width: 64,
  },
  detailValue: {
    fontSize: 12,
    color: '#555',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  // ─── Permission Section ───
  permSection: {
    width: '100%',
    maxWidth: 360,
    marginTop: 12,
    padding: '10px 14px',
    background: '#fff8ed',
    borderRadius: 10,
    border: '1px solid #f5c46e',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  permRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  permInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    minWidth: 0,
  },
  permLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#92400e',
  },
  permDesc: {
    fontSize: 11,
    color: '#b45309',
    lineHeight: 1.4,
  },
  permBtn: {
    flexShrink: 0,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    background: '#d97706',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },

  // ─── Sections ───
  section: {
    width: '100%',
    maxWidth: 360,
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#888',
    margin: '0 0 6px',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  serverRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 0',
  },
  statusDot: (status?: ConnStatus) => ({
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: statusColor(status),
    flexShrink: 0,
    transition: 'background 0.3s',
  }),
  serverUrl: {
    fontSize: 13,
    color: '#333',
    wordBreak: 'break-all' as const,
  },
  warn: { fontSize: 13, color: '#b45309', margin: 0 },
  muted: { fontSize: 13, color: '#aaa', margin: 0 },
  historyBtn: {
    marginTop: 16,
    padding: '8px 24px',
    fontSize: 13,
    fontWeight: 600,
    background: '#111',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  logoutBtn: {
    marginTop: 8,
    padding: '8px 24px',
    fontSize: 13,
    fontWeight: 500,
    background: 'transparent',
    color: '#b91c1c',
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    cursor: 'pointer',
  },
} as const
