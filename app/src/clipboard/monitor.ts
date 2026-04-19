/**
 * 클립보드 폴링 모니터 (500ms)
 *
 * 텍스트와 이미지를 독립적으로 폴링한다.
 * - 텍스트: 값이 달라지면 onTextChange 호출
 * - 이미지: 크기+앞부분 바이트 핑거프린트가 달라지면 onImageChange 호출
 *   (이미지 폴링은 3틱마다 한 번, ~1.5초)
 *
 * 외부 쓰기 시 setLastKnown/setLastKnownImageFingerprint로 알려야
 * 자기 쓰기를 새 복사로 오인하지 않는다.
 */
import { readText, readImage } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from '../toast'
import { t } from '../i18n'
import { fingerprintRgba } from './fingerprint'

const POLL_INTERVAL_MS = 500
const IMAGE_POLL_EVERY_N = 3  // 텍스트 3번 폴링마다 이미지 1번

export interface ClipboardMonitor {
  stop: () => void
  setLastKnown: (text: string) => void
  setLastKnownImageFingerprint: (fp: string) => void
}

/**
 * 클립보드 모니터를 시작한다.
 * @param onTextChange  텍스트가 변경됐을 때 호출
 * @param onImageChange 이미지가 변경됐을 때 RGBA 바이트, 너비, 높이와 함께 호출
 */
export function startClipboardMonitor(
  onTextChange: (text: string) => void,
  onImageChange: (rgba: Uint8Array, width: number, height: number) => void,
): ClipboardMonitor {
  let lastKnownText: string | null = null
  let lastKnownImageFp: string | null = null
  let stopped = false
  let tick = 0
  let initialized = false

  const poll = async () => {
    if (stopped) return
    tick++

    // 텍스트 폴링
    try {
      const text = await readText()
      if (text !== null && text !== lastKnownText) {
        lastKnownText = text
        if (initialized) {
          console.log('[monitor] text changed:', text.slice(0, 40), text.length > 40 ? '...' : '')
          toast(t('toast.clipboard.text'))
          onTextChange(text)
        }
      }
    } catch {
      // 클립보드 비어있거나 읽기 실패 시 무시
    }

    // 이미지 폴링 (N틱마다 1회)
    if (tick % IMAGE_POLL_EVERY_N === 0) {
      try {
        const img = await readImage()
        const [rgba, size] = await Promise.all([img.rgba(), img.size()])
        const fp = fingerprintRgba(rgba, size.width, size.height)
        if (fp !== lastKnownImageFp) {
          lastKnownImageFp = fp
          if (initialized) {
            console.log('[monitor] image changed:', fp.slice(0, 30))
            toast(t('toast.clipboard.image'))
            onImageChange(rgba, size.width, size.height)
          }
        }
      } catch {
        // 이미지 없거나 읽기 실패 시 무시
      }
    }

    initialized = true
    if (!stopped) setTimeout(poll, POLL_INTERVAL_MS)
  }

  void poll()

  return {
    stop: () => { stopped = true },
    setLastKnown: (text: string) => { lastKnownText = text },
    setLastKnownImageFingerprint: (fp: string) => { lastKnownImageFp = fp },
  }
}
