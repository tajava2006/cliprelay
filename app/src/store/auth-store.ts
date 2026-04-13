/**
 * NIP-46 로그인 정보를 Tauri Store에 영구 저장.
 * 재시작 시 저장된 정보로 BunkerSigner를 복원한다.
 *
 * clientPrivkey는 OS 키체인(데스크탑) / EncryptedSharedPreferences(Android)에
 * 별도 저장하여 평문 노출을 방지한다.
 */
import { Store } from '@tauri-apps/plugin-store'
import { invoke } from '@tauri-apps/api/core'
import type { AuthState } from '@cliprelay/shared'

let _store: Store | null = null

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await Store.load('auth.json')
  }
  return _store
}

// ─── keychain helpers ────────────────────────────────────────

const KEYCHAIN_CLIENT_PRIVKEY = 'client_privkey'

async function keychainSet(key: string, value: string): Promise<void> {
  await invoke('plugin:keychain|set_secret', { key, value })
}

async function keychainGet(key: string): Promise<string | null> {
  const result = await invoke<{ value?: string | null }>('plugin:keychain|get_secret', { key })
  return result?.value ?? null
}

async function keychainDelete(key: string): Promise<void> {
  await invoke('plugin:keychain|delete_secret', { key })
}

// ─── public API ──────────────────────────────────────────────

export async function loadAuth(): Promise<AuthState | null> {
  const store = await getStore()
  const auth = await store.get<AuthState>('auth')
  if (!auth) return null

  // keychain에서 clientPrivkey 복원
  if (auth.signerType === 'bunker' && !auth.clientPrivkey) {
    const privkey = await keychainGet(KEYCHAIN_CLIENT_PRIVKEY)
    if (privkey) {
      auth.clientPrivkey = privkey
    }
  }

  return auth
}

export async function saveAuth(auth: AuthState): Promise<void> {
  const store = await getStore()

  // clientPrivkey를 keychain에 별도 저장
  if (auth.clientPrivkey) {
    await keychainSet(KEYCHAIN_CLIENT_PRIVKEY, auth.clientPrivkey)
  }

  // store에는 clientPrivkey 제외한 나머지만 저장
  const { clientPrivkey: _, ...rest } = auth
  await store.set('auth', rest)
}

export async function clearAuth(): Promise<void> {
  const store = await getStore()
  await store.delete('auth')
  await keychainDelete(KEYCHAIN_CLIENT_PRIVKEY).catch(() => {})
}
