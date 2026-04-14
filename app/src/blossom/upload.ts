/**
 * Blossom 파일 업로드 (BUD-02 + BUD-11)
 *
 * 업로드 흐름:
 *   1. RGBA → canvas → PNG bytes
 *   2. 일회용 AES-GCM 키 생성 → PNG 암호화 (파일 크기 제한 없음)
 *   3. sha256(encrypted bytes)
 *   4. kind:24242 auth 이벤트 → BunkerSigner 서명
 *   5. PUT /upload (Tauri HTTP — CORS 우회)
 *   6. FilePayload 반환 (key, iv 포함 → kind:9372에서 NIP-44로 암호화됨)
 */
import { fetch } from '@tauri-apps/plugin-http'
import { bytesToHex, type FilePayload } from '@cliprelay/shared'
import { getSigner } from '../platform/signer'
import { loadAuth } from '../store/auth-store'

const AUTH_EXPIRY_SECONDS = 60

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return bytesToHex(new Uint8Array(hashBuffer))
}

/** Tauri Image RGBA → PNG bytes (canvas 이용) */
export async function rgbaToPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob 실패'))), 'image/png'),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

// ─── AES-GCM 암호화 ─────────────────────────────────────────

/** 일회용 AES-GCM 키로 바이너리를 암호화한다. */
async function encryptFile(plainBytes: Uint8Array): Promise<{
  encrypted: Uint8Array
  keyHex: string
  ivHex: string
}> {
  const key = await globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  )
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const cipherBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainBytes.buffer as ArrayBuffer,
  )
  const rawKey = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', key))
  return {
    encrypted: new Uint8Array(cipherBuffer),
    keyHex: bytesToHex(rawKey),
    ivHex: bytesToHex(iv),
  }
}

// ─── 업로드 ──────────────────────────────────────────────────

export async function uploadImage(
  pngBytes: Uint8Array,
  servers: string[],
): Promise<FilePayload> {
  if (servers.length === 0) throw new Error('No Blossom servers')

  const auth = await loadAuth()
  if (!auth) throw new Error('Auth not found')

  // 1. AES-GCM 암호화 (로컬, 파일 크기 제한 없음)
  const { encrypted, keyHex, ivHex } = await encryptFile(pngBytes)

  // 2. sha256 계산
  const hash = await sha256hex(encrypted)

  // 3. kind:24242 auth 이벤트
  const signer = getSigner()
  const expiration = Math.floor(Date.now() / 1000) + AUTH_EXPIRY_SECONDS
  const authEvent = await signer.signEvent({
    kind: 24242,
    content: 'Upload Blob',
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'upload'],
      ['x', hash],
      ['expiration', String(expiration)],
    ],
  })
  const authToken = btoa(JSON.stringify(authEvent))

  // 4. 서버 순서대로 업로드 시도
  let lastError: unknown
  for (const server of servers) {
    const url = server.replace(/\/$/, '') + '/upload'
    try {
      const res = await fetch(url, {
        method: 'PUT',
        body: encrypted.buffer as ArrayBuffer,
        headers: {
          'Authorization': `Nostr ${authToken}`,
          'Content-Type': 'application/octet-stream',
          'X-SHA-256': hash,
        },
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText)
        throw new Error(`${res.status}: ${msg}`)
      }
      const descriptor = await res.json() as { url: string; sha256: string }
      if (descriptor.sha256 !== hash) {
        throw new Error(`SHA-256 mismatch (expected: ${hash}, got: ${descriptor.sha256})`)
      }
      console.log('[blossom] upload complete:', descriptor.url)
      return {
        type: 'file',
        sha256: descriptor.sha256,
        url: descriptor.url,
        mimeType: 'image/png',
        filename: 'clipboard.png',
        size: encrypted.length,
        key: keyHex,
        iv: ivHex,
      }
    } catch (err) {
      console.warn(`[blossom] ${server} upload failed:`, err)
      lastError = err
    }
  }
  throw new Error(`All Blossom servers upload failed: ${lastError}`)
}
