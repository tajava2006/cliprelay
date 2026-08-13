/**
 * 민감 정보(concealed) 클립보드 지원 — macOS 구현
 *
 * 비밀번호 매니저들은 클립보드에 복사할 때 `org.nspasteboard.ConcealedType`
 * (사실상 표준, nspasteboard.org) 마커를 같이 싣는다. 이 마커를:
 * - 읽기: 감지해서 동기화 페이로드에 concealed 플래그로 전달하고
 * - 쓰기: 받는 쪽 클립보드에도 다시 붙여서, 그쪽의 클립보드 매니저/히스토리도
 *   민감 정보로 취급하게 한다.
 *
 * macOS 외 데스크탑은 아직 감지 불가(항상 false) — Windows의
 * ExcludeClipboardContentFromMonitorProcessing 등은 TODO.
 */
import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { isDesktop } from './detect'

let _isMac: boolean | null = null

function isMacDesktop(): boolean {
  if (_isMac === null) {
    _isMac = isDesktop() && /macintosh|mac os x/i.test(navigator.userAgent)
  }
  return _isMac
}

/** 현재 클립보드에 concealed 마커가 있는가. 실패/미지원 시 false. */
export async function isClipboardConcealed(): Promise<boolean> {
  if (!isMacDesktop()) return false
  try {
    return await invoke<boolean>('clipboard_is_concealed')
  } catch {
    return false
  }
}

/**
 * 텍스트를 concealed 마커와 함께 클립보드에 쓴다.
 * 마커 쓰기가 미지원/실패면 일반 쓰기로 폴백 — 전달이 마커보다 우선이다.
 */
export async function writeClipboardTextConcealed(text: string): Promise<void> {
  if (isMacDesktop()) {
    try {
      await invoke('write_clipboard_text_concealed', { text })
      return
    } catch (err) {
      console.warn('[concealed] marker write failed — falling back to plain write:', err)
    }
  }
  await writeText(text)
}
