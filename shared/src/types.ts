/** kind:9372 이벤트 content를 NIP-44 복호화 후 파싱한 페이로드 */
export type ClipboardPayload = TextPayload | FilePayload

export interface TextPayload {
  type: 'text'
  content: string
}

export interface FilePayload {
  type: 'file'
  sha256: string      // 암호화된 바이너리 기준 SHA256
  url: string         // Blossom 서버 URL
  mimeType: string
  filename: string
  size: number        // 암호화된 파일 크기 (bytes)
  key: string         // AES-GCM 일회용 대칭키 (hex)
  iv: string          // AES-GCM IV (hex)
}

/** kind:0 프로필 메타데이터 (NIP-01) */
export interface UserProfile {
  name?: string
  display_name?: string
  picture?: string
  banner?: string
  about?: string
  nip05?: string
  lud06?: string
  lud16?: string
  website?: string
}

/** auth-store에 저장되는 로그인 정보 */
export interface AuthState {
  signerType: 'bunker' | 'amber'
  userPubkey: string      // hex (실제 사용자 pubkey)
  // bunker 전용 (signerType === 'bunker')
  clientPrivkey?: string  // hex
  clientPubkey?: string   // hex
  signerPubkey?: string   // hex (remote signer)
  signerRelays?: string[] // bunker가 리슨하는 릴레이
  // amber 전용 (signerType === 'amber')
  amberPackage?: string   // Amber 앱 패키지명
}
