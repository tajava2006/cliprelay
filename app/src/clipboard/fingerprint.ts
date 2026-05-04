/**
 * 이미지 핑거프린트 — 클립보드 모니터와 수신 경로가 같은 이미지를 식별할 때 쓴다.
 *
 * 두 종류 포맷을 의도적으로 분리해 둔다:
 * - RGBA 기반 (`fingerprintRgba`): `${W}x${H}:${head32hex}` — 모니터에서 OS 클립보드를 직접 읽을 때
 * - PNG 기반 (`fingerprintPng`): `${length}:${head64hex}` — 네트워크 수신 후 PNG bytes로 비교할 때
 *
 * 각 호출자(ref)가 자기 포맷으로 일관되게 비교하므로 혼용되지 않는다.
 */

/** Uint8Array 앞 n바이트를 hex 문자열로 변환 */
export function headHex(bytes: Uint8Array, n: number): string {
  return Array.from(bytes.subarray(0, n), b => b.toString(16).padStart(2, '0')).join('')
}

/** RGBA + 크기로 이미지 핑거프린트를 계산한다. */
export function fingerprintRgba(rgba: Uint8Array, width: number, height: number): string {
  return `${width}x${height}:${headHex(rgba, 32)}`
}

/** PNG bytes로 이미지 핑거프린트를 계산한다. */
export function fingerprintPng(pngBytes: Uint8Array): string {
  return `${pngBytes.length}:${headHex(pngBytes, 64)}`
}
