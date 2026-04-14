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

/** 키체인에서 읽은 clientPrivkey 메모리 캐시 — 매번 OS 프롬프트 방지 */
let _cachedClientPrivkey: string | null = null

async function keychainSet(key: string, value: string): Promise<void> {
  await invoke('plugin:keychain|set_secret', { key, value })
  if (key === KEYCHAIN_CLIENT_PRIVKEY) {
    _cachedClientPrivkey = value
  }
}

async function keychainGet(key: string): Promise<string | null> {
  if (key === KEYCHAIN_CLIENT_PRIVKEY && _cachedClientPrivkey !== null) {
    return _cachedClientPrivkey
  }
  const result = await invoke<{ value?: string | null }>('plugin:keychain|get_secret', { key })
  const value = result?.value ?? null
  if (key === KEYCHAIN_CLIENT_PRIVKEY) {
    _cachedClientPrivkey = value
  }
  return value
}

async function keychainDelete(key: string): Promise<void> {
  await invoke('plugin:keychain|delete_secret', { key })
  if (key === KEYCHAIN_CLIENT_PRIVKEY) {
    _cachedClientPrivkey = null
  }
}

// ─── public API ──────────────────────────────────────────────

/** loadAuth 결과 메모리 캐시 — 키체인 반복 접근 방지 */
let _cachedAuth: AuthState | null = null
/** 진행 중인 loadAuth Promise — 동시 호출 시 키체인 중복 접근 방지 */
let _loadAuthPromise: Promise<AuthState | null> | null = null

export function loadAuth(): Promise<AuthState | null> {
  if (_cachedAuth) return Promise.resolve(_cachedAuth)
  if (_loadAuthPromise) return _loadAuthPromise

  _loadAuthPromise = _doLoadAuth().finally(() => {
    _loadAuthPromise = null
  })
  return _loadAuthPromise
}

async function _doLoadAuth(): Promise<AuthState | null> {
  const store = await getStore()
  const auth = await store.get<AuthState>('auth')
  if (!auth) return null

  // keychain에서 clientPrivkey 복원 (최초 1회만 OS 프롬프트)
  if (auth.signerType === 'bunker' && !auth.clientPrivkey) {
    const privkey = await keychainGet(KEYCHAIN_CLIENT_PRIVKEY)
    if (privkey) {
      auth.clientPrivkey = privkey
    }
  }

  _cachedAuth = auth
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

  // 메모리 캐시 갱신
  _cachedAuth = auth
}

export async function clearAuth(): Promise<void> {
  const store = await getStore()
  await store.delete('auth')
  await keychainDelete(KEYCHAIN_CLIENT_PRIVKEY).catch(() => {})

  // 메모리 캐시 무효화
  _cachedAuth = null
}
