/**
 * NIP-44 자기암호화/복호화
 *
 * 자기암호화: conversation_key = getConversationKey(userPrivKey, userPubKey)
 * ECDH 결과가 자기 자신과의 공유 비밀이 된다.
 *
 * 암호화 실패 시 예외를 던진다. 호출자는 반드시 실패 시 발행을 중단해야 한다.
 */
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { hexToBytes } from './nip46.ts'

/**
 * 평문 JSON을 NIP-44 자기암호화해 암호문 반환.
 * @param payload   직렬화할 객체
 * @param privkeyHex 사용자 개인키 (hex)
 * @param pubkeyHex  사용자 공개키 (hex)
 */
export function encryptPayload(
  payload: unknown,
  privkeyHex: string,
  pubkeyHex: string,
): string {
  const privkey = hexToBytes(privkeyHex)
  const convKey = getConversationKey(privkey, pubkeyHex)
  return encrypt(JSON.stringify(payload), convKey)
}

/**
 * NIP-44 자기암호화된 암호문을 복호화해 파싱된 객체 반환.
 * @param ciphertext 암호문
 * @param privkeyHex 사용자 개인키 (hex)
 * @param pubkeyHex  사용자 공개키 (hex)
 */
export function decryptPayload<T>(
  ciphertext: string,
  privkeyHex: string,
  pubkeyHex: string,
): T {
  const privkey = hexToBytes(privkeyHex)
  const convKey = getConversationKey(privkey, pubkeyHex)
  return JSON.parse(decrypt(ciphertext, convKey)) as T
}
