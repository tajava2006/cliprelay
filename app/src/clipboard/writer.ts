/**
 * OS 클립보드 쓰기
 * Tauri clipboard-manager 플러그인을 통해 텍스트/이미지를 클립보드에 삽입한다.
 * Android에서는 이미지 쓰기에 clipboard-action 플러그인(FileProvider 방식)을 사용한다.
 */
import { writeText, writeImage } from '@tauri-apps/plugin-clipboard-manager'
import { Image } from '@tauri-apps/api/image'
import { isAndroid } from '../platform/detect'

export async function writeClipboardText(text: string): Promise<void> {
  await writeText(text)
}

/**
 * PNG bytes를 클립보드에 이미지로 삽입한다.
 * 데스크탑: Tauri Image.fromBytes → clipboard-manager writeImage
 * Android: clipboard-action 플러그인 → FileProvider URI → ClipData.newUri
 */
export async function writeClipboardImage(pngBytes: Uint8Array): Promise<void> {
  if (isAndroid()) {
    const { writeImageToClipboardAndroid } = await import('../platform/clipboard-action')
    await writeImageToClipboardAndroid(pngBytes)
    return
  }
  const image = await Image.fromBytes(pngBytes)
  await writeImage(image)
}
