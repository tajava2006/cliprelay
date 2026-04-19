/**
 * 이미지 핑거프린트 — 클립보드 모니터와 수신 경로가 같은 이미지를 식별할 때 쓴다.
 *
 * RGBA 바이트 기준 `${W}x${H}:${head32hex}` 포맷을 공용으로 사용한다.
 * App.tsx의 PNG 기반 `${length}:${head64hex}` 포맷과는 별개이며,
 * 각 ref가 자기 포맷으로 일관되게 비교하므로 혼용되지 않는다.
 */

/** Uint8Array 앞 n바이트를 hex 문자열로 변환 */
export function headHex(bytes: Uint8Array, n: number): string {
  return Array.from(bytes.subarray(0, n), b => b.toString(16).padStart(2, '0')).join('')
}

/** RGBA + 크기로 이미지 핑거프린트를 계산한다. */
export function fingerprintRgba(rgba: Uint8Array, width: number, height: number): string {
  return `${width}x${height}:${headHex(rgba, 32)}`
}
