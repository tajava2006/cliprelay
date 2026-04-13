/**
 * Blossom 파일 다운로드 + AES-GCM 복호화
 *
 * 수신 흐름:
 *   1. Blossom URL에서 암호화된 바이너리 다운로드
 *   2. FilePayload의 key, iv로 AES-GCM 복호화
 *   3. 원본 PNG bytes 반환
 *
 * URL이 깨진 경우 사용자의 Blossom 서버 목록(kind:10063)에서 sha256으로 폴백.
 */
import { fetch } from '@tauri-apps/plugin-http'
import { loadBlossomServers } from '../store/blossom-store'

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

/**
 * AES-GCM으로 암호화된 바이너리를 복호화한다.
 */
async function decryptFile(
  encrypted: Uint8Array,
  keyHex: string,
  ivHex: string,
): Promise<Uint8Array> {
  const rawKey = hexToBytes(keyHex)
  const iv = hexToBytes(ivHex)
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    rawKey.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const plainBuffer = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encrypted.buffer as ArrayBuffer,
  )
  return new Uint8Array(plainBuffer)
}

/**
 * Blossom에서 암호화된 파일을 다운로드하고 복호화해 PNG bytes를 반환한다.
 */
export async function downloadAndDecrypt(
  url: string,
  sha256: string,
  keyHex: string,
  ivHex: string,
): Promise<Uint8Array> {
  console.log('[blossom] download starting')
  const encryptedBytes = await fetchBlob(url, sha256)
  console.log('[blossom] decrypting')
  const plainBytes = await decryptFile(encryptedBytes, keyHex, ivHex)
  console.log('[blossom] decrypted')
  return plainBytes
}

/**
 * URL에서 blob을 fetch한다. 실패 시 사용자의 Blossom 서버에서 sha256으로 폴백.
 */
async function fetchBlob(url: string, sha256: string): Promise<Uint8Array> {
  try {
    const res = await fetch(url)
    if (res.ok) {
      console.log('[blossom] downloaded (original URL)')
      return new Uint8Array(await res.arrayBuffer())
    }
  } catch {
    console.warn('[blossom] original URL failed, trying fallback:', url)
  }

  const servers = await loadBlossomServers()
  for (const server of servers) {
    const fallbackUrl = server.replace(/\/$/, '') + '/' + sha256
    try {
      const res = await fetch(fallbackUrl)
      if (res.ok) {
        console.log('[blossom] downloaded (fallback):', server)
        return new Uint8Array(await res.arrayBuffer())
      }
    } catch {
      console.warn('[blossom] fallback failed:', server)
    }
  }

  throw new Error(`Blossom download failed: ${sha256}`)
}
