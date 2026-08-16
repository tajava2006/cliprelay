/**
 * QR 카메라 스캔 (Android 전용)
 *
 * tauri-plugin-barcode-scanner의 windowed 모드를 사용한다:
 * 카메라 프리뷰가 WebView **뒤에** 깔리고 플러그인이 네이티브 WebView를
 * 투명하게 만든다. 페이지 쪽 배경(html/body/#root의 CSS 배경)은 플러그인이
 * 못 건드리므로 스캔 동안 여기서 직접 투명으로 바꿨다가 복원한다.
 * (스캔 UI 오버레이 자체는 Login.tsx가 그린다.)
 */
import {
  scan,
  cancel,
  checkPermissions,
  requestPermissions,
  Format,
} from '@tauri-apps/plugin-barcode-scanner'

/** 카메라 권한 거부 — UI가 안내 문구를 분기할 수 있게 별도 타입 */
export class CameraPermissionError extends Error {
  constructor() {
    super('camera permission denied')
    this.name = 'CameraPermissionError'
  }
}

/**
 * QR 하나를 스캔해 내용 문자열을 돌려준다.
 * 사용자가 cancelScan()으로 취소하면 reject된다(호출부에서 취소 플래그로 구분).
 */
export async function scanQR(): Promise<string> {
  let perm = await checkPermissions()
  if (perm !== 'granted') perm = await requestPermissions()
  if (perm !== 'granted') throw new CameraPermissionError()

  const html = document.documentElement
  const body = document.body
  const root = document.getElementById('root')
  const saved = [html.style.background, body.style.background, root?.style.background ?? '']
  html.style.background = 'transparent'
  body.style.background = 'transparent'
  if (root) root.style.background = 'transparent'
  try {
    const result = await scan({ windowed: true, formats: [Format.QRCode], cameraDirection: 'back' })
    return result.content
  } finally {
    html.style.background = saved[0]
    body.style.background = saved[1]
    if (root) root.style.background = saved[2]
  }
}

/** 진행 중인 스캔 취소 — pending scan()이 reject되며 끝난다 */
export async function cancelScan(): Promise<void> {
  try {
    await cancel()
  } catch {
    // 이미 끝났거나 스캔 중이 아님 — 무시
  }
}
