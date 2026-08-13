/**
 * 민감 정보(concealed) 클립보드 지원
 *
 * 비밀번호 매니저들은 클립보드에 복사할 때 민감 정보 마커를 같이 싣는다
 * (macOS `org.nspasteboard.ConcealedType`, Windows
 * `ExcludeClipboardContentFromMonitorProcessing`, KDE `x-kde-passwordManagerHint`,
 * Android `EXTRA_IS_SENSITIVE`). 이 마커를:
 * - 읽기: 감지해서 동기화 페이로드에 concealed 플래그로 전달하고
 * - 쓰기: 받는 쪽 클립보드에도 다시 붙여서, 그쪽의 클립보드 매니저/히스토리도
 *   민감 정보로 취급하게 한다.
 *
 * 감지: macOS/Windows(데스크탑 Rust 커맨드) + Android(Kotlin 읽기에 동봉).
 * Linux는 감지 불가(타깃 조회 미지원) — 쓰기 방향 마커 전파만 지원.
 */
import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { isAndroid, isDesktop } from './detect'

/** 현재 클립보드에 concealed 마커가 있는가. 실패/미지원 시 false. (데스크탑 전용) */
export async function isClipboardConcealed(): Promise<boolean> {
  if (!isDesktop()) return false
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
  try {
    if (isAndroid()) {
      await invoke('plugin:clipboard-action|write_clipboard_text', { text, sensitive: true })
    } else {
      await invoke('write_clipboard_text_concealed', { text })
    }
    return
  } catch (err) {
    console.warn('[concealed] marker write failed — falling back to plain write:', err)
  }
  await writeText(text)
}
