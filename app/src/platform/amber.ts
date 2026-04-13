/**
 * Amber Intent 기반 서명자 (NIP-55)
 *
 * Android에서 Amber 앱이 설치되어 있을 때 사용한다.
 * Tauri 플러그인(tauri-plugin-amber)을 통해 Kotlin AmberPlugin과 통신.
 *
 * UniversalSigner 인터페이스를 구현하므로 기존 publish/subscribe/upload에서
 * BunkerSigner와 동일하게 사용할 수 있다.
 */
import { invoke } from '@tauri-apps/api/core'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure'
import { decode as decodeBech32 } from 'nostr-tools/nip19'
import type { UniversalSigner } from './signer'

/** npub/hex 어느 쪽이든 hex로 정규화 */
function toHex(pubkey: string): string {
  if (pubkey.startsWith('npub1')) {
    const { data } = decodeBech32(pubkey)
    return data as string
  }
  return pubkey
}

/** Amber 앱 설치 여부 확인 */
export async function isAmberInstalled(): Promise<boolean> {
  const result = await invoke<{ installed: boolean }>('plugin:amber|is_installed')
  return result.installed
}

/** Amber에서 공개키를 가져온다 (최초 로그인 시 1회) */
export async function getAmberPublicKey(): Promise<{ pubkey: string; packageName: string }> {
  const result = await invoke<{ pubkey: string; packageName: string }>('plugin:amber|get_public_key')
  return { pubkey: toHex(result.pubkey), packageName: result.packageName }
}

/**
 * Amber 기반 UniversalSigner 구현체.
 * Amber Intent로 signEvent, nip44Encrypt, nip44Decrypt를 수행한다.
 */
export class AmberSigner implements UniversalSigner {
  constructor(
    private readonly userPubkey: string,
    private readonly packageName: string = '',
  ) {}

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    const eventJson = JSON.stringify(event)
    const result = await invoke<{ result: string }>('plugin:amber|sign_event', {
      eventJson,
      currentUser: this.userPubkey,
      packageName: this.packageName,
    })
    return JSON.parse(result.result) as VerifiedEvent
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    const result = await invoke<{ result: string }>('plugin:amber|nip44_encrypt', {
      pubkey,
      content: plaintext,
      currentUser: this.userPubkey,
      packageName: this.packageName,
    })
    return result.result
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    const result = await invoke<{ result: string }>('plugin:amber|nip44_decrypt', {
      pubkey,
      content: ciphertext,
      currentUser: this.userPubkey,
      packageName: this.packageName,
    })
    return result.result
  }
}
