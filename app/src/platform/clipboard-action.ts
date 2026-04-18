/**
 * Android 클립보드 액션 브릿지
 */
import { invoke } from '@tauri-apps/api/core'
import { isAndroid } from './detect'

interface PendingCopyResult {
  wasPending: boolean
  notificationId: number
}

/**
 * "복사" 버튼 탭으로 앱이 올라온 건지 확인한다.
 * 읽으면 자동으로 플래그가 clear된다.
 */
export async function consumePendingCopy(): Promise<PendingCopyResult> {
  if (!isAndroid()) return { wasPending: false, notificationId: -1 }
  return invoke<PendingCopyResult>('plugin:clipboard-action|consume_pending_copy')
}

/**
 * Android에서 이미지를 클립보드에 쓴다.
 * Tauri clipboard-manager의 writeImage가 Android에서 동작하지 않으므로
 * FileProvider URI 방식으로 직접 쓴다.
 * @param pngBytes PNG 이미지 바이트 배열
 * @param mimeType MIME 타입 (기본: image/png)
 */
export async function writeImageToClipboardAndroid(pngBytes: Uint8Array, mimeType = 'image/png'): Promise<void> {
  // Uint8Array → base64
  let binary = ''
  for (let i = 0; i < pngBytes.length; i++) {
    binary += String.fromCharCode(pngBytes[i])
  }
  const base64 = btoa(binary)
  await invoke('plugin:clipboard-action|write_image_to_clipboard', { base64, mimeType })
}

interface ClipboardImageResult {
  hasImage: boolean
  base64?: string
}

/**
 * Android 클립보드에서 이미지를 읽는다.
 * content:// URI를 ContentResolver로 읽어 PNG bytes(base64)를 반환한다.
 */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  if (!isAndroid()) return { hasImage: false }
  return invoke<ClipboardImageResult>('plugin:clipboard-action|read_clipboard_image')
}

