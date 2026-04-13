/**
 * 플랫폼별 클립보드 모니터링 추상화
 *
 * - 데스크탑: 500ms 폴링으로 자동 감지 (기존 monitor.ts)
 * - Android: 폴링 없음. 알림 버튼 탭 → 투명 Activity → 클립보드 읽기 → 콜백
 *   (plugin-clipboard-action이 구현되면 여기에 연결)
 */
import type { ClipboardMonitor } from '../clipboard/monitor'
import { isAndroid } from './detect'

/**
 * 플랫폼에 맞는 클립보드 모니터를 시작한다.
 *
 * 데스크탑: 폴링 모니터 시작
 * Android: 수동 트리거 대기 (noop 모니터 반환, 추후 Step 7에서 구현)
 */
export async function startPlatformClipboardMonitor(
  onTextChange: (text: string) => void,
  onImageChange: (rgba: Uint8Array, width: number, height: number) => void,
): Promise<ClipboardMonitor> {
  if (isAndroid()) {
    // Android: 폴링 없음 — 알림 버튼 트리거 방식 (Step 7에서 구현)
    // 지금은 noop 모니터 반환
    console.log('[platform] Android — clipboard polling disabled')
    return {
      stop: () => {},
      setLastKnown: () => {},
      setLastKnownImageFingerprint: () => {},
    }
  }

  // 데스크탑: 기존 폴링 모니터
  const { startClipboardMonitor } = await import('../clipboard/monitor')
  return startClipboardMonitor(onTextChange, onImageChange)
}
