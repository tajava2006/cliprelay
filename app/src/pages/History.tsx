/**
 * 클립보드 히스토리 뷰어
 *
 * history-store에서 이벤트 목록을 읽어 시간 역순으로 표시한다.
 * - 텍스트: 내용 일부 미리보기
 * - 파일: 파일명 + mimeType 표시
 * - 항목 클릭 시 해당 내용을 클립보드에 다시 넣기
 */
import { useEffect, useRef, useState } from 'react'
import { loadHistory, clearHistory, type HistoryItem } from '../store/history-store'
import { t } from '../i18n'
import { writeClipboardText } from '../clipboard/writer'
import { downloadAndDecrypt } from '../blossom/download'
import { writeClipboardImage } from '../clipboard/writer'

interface HistoryProps {
  onBack: () => void
  setLastKnown: (text: string) => void
  setLastKnownImageFingerprint: (fp: string) => void
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  if (isToday) return time
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

export function History({ onBack, setLastKnown, setLastKnownImageFingerprint }: HistoryProps) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const onBackRef = useRef(onBack)
  useEffect(() => { onBackRef.current = onBack })

  useEffect(() => {
    loadHistory().then(setItems)
  }, [])

  // Android 뒤로가기 제스처(스와이프)를 잡아 메인 화면으로 돌아오게 처리
  useEffect(() => {
    window.history.pushState({ page: 'history' }, '')
    const handlePopState = () => { onBackRef.current() }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const handleClick = async (item: HistoryItem) => {
    try {
      if (item.payload.type === 'text') {
        setLastKnown(item.payload.content)
        await writeClipboardText(item.payload.content)
      } else {
        if (!item.payload.key || !item.payload.iv) {
          console.warn('[history] legacy item without key/iv — cannot decrypt')
          return
        }
        if (item.fingerprint) {
          setLastKnownImageFingerprint(item.fingerprint)
        }
        const pngBytes = await downloadAndDecrypt(
          item.payload.url,
          item.payload.sha256,
          item.payload.key,
          item.payload.iv,
        )
        await writeClipboardImage(pngBytes)
      }
      setCopiedId(item.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch (err) {
      console.error('[history] clipboard copy failed:', err)
    }
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => window.history.back()}>&larr;</button>
        <h2 style={s.title}>{t('history.title')}</h2>
        {items.length > 0 && (
          <button
            style={s.clearBtn}
            onClick={async () => {
              await clearHistory()
              setItems([])
            }}
          >
            {t('history.clear')}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p style={s.empty}>{t('history.empty')}</p>
      ) : (
        <div style={s.list}>
          {items.map(item => (
            <button
              key={item.id}
              style={s.item}
              onClick={() => handleClick(item)}
            >
              <div style={s.itemLeft}>
                <span style={s.typeIcon}>
                  {item.payload.type === 'text' ? 'T' : 'F'}
                </span>
                <span style={s.preview}>
                  {item.payload.type === 'text'
                    ? item.payload.content.length > 80
                      ? item.payload.content.slice(0, 80) + '…'
                      : item.payload.content
                    : `${item.payload.filename} (${item.payload.mimeType})`
                  }
                </span>
              </div>
              <div style={s.itemRight}>
                {copiedId === item.id
                  ? <span style={s.copied}>{t('history.copied')}</span>
                  : <span style={s.time}>{formatTime(item.createdAt)}</span>
                }
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const s = {
  root: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#f5f5f5',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    borderBottom: '1px solid #eee',
    background: '#fff',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    padding: '4px 8px',
    color: '#333',
  },
  title: { fontSize: 16, fontWeight: 600, margin: 0, flex: 1 },
  clearBtn: {
    background: 'none',
    border: 'none',
    fontSize: 12,
    color: '#b91c1c',
    cursor: 'pointer',
    padding: '4px 8px',
  },
  empty: { fontSize: 13, color: '#aaa', textAlign: 'center' as const, padding: 48 },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 8,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '10px 12px',
    marginBottom: 4,
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontSize: 13,
    color: '#333',
    gap: 8,
  },
  itemLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  typeIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: 4,
    background: '#f0f0f0',
    fontSize: 11,
    fontWeight: 700,
    color: '#666',
    flexShrink: 0,
  },
  preview: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  itemRight: {
    flexShrink: 0,
  },
  time: { fontSize: 11, color: '#aaa' },
  copied: { fontSize: 11, color: '#16a34a', fontWeight: 600 },
} as const
