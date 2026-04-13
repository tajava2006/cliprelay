/**
 * 인앱 토스트 표시 컴포넌트
 *
 * 화면 우하단에 토스트를 쌓아 표시하고, 일정 시간 후 자동 소멸한다.
 */
import { useEffect, useState } from 'react'
import { onToast, type ToastMessage } from '../toast'

const TOAST_TTL_MS = 10_000
const MAX_VISIBLE = 100

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    return onToast(msg => {
      setToasts(prev => [...prev.slice(-(MAX_VISIBLE - 1)), msg])
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== msg.id))
      }, TOAST_TTL_MS)
    })
  }, [])

  if (toasts.length === 0) return null

  return (
    <div style={s.container}>
      {toasts.map(t => (
        <div key={t.id} style={{ ...s.toast, ...s[t.type] }}>
          <span style={s.dot(t.type)} />
          <span style={s.text}>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

const typeColor = (type: ToastMessage['type']) => {
  if (type === 'ok') return '#16a34a'
  if (type === 'error') return '#dc2626'
  return '#3b82f6'
}

const s = {
  container: {
    position: 'fixed' as const,
    bottom: 12,
    right: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    zIndex: 9999,
    pointerEvents: 'none' as const,
    maxWidth: 320,
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 12,
    lineHeight: 1.3,
    backdropFilter: 'blur(8px)',
    animation: 'toast-in 0.15s ease-out',
  },
  info: {
    background: 'rgba(240, 245, 255, 0.92)',
    color: '#1e3a5f',
    border: '1px solid rgba(59, 130, 246, 0.2)',
  },
  ok: {
    background: 'rgba(240, 253, 244, 0.92)',
    color: '#14532d',
    border: '1px solid rgba(22, 163, 74, 0.2)',
  },
  error: {
    background: 'rgba(254, 242, 242, 0.92)',
    color: '#7f1d1d',
    border: '1px solid rgba(220, 38, 38, 0.2)',
  },
  dot: (type: ToastMessage['type']) => ({
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: typeColor(type),
    flexShrink: 0,
  }),
  text: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
} as const
