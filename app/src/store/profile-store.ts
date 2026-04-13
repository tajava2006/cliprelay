/**
 * 사용자 프로필(kind:0)을 Tauri Store에 캐싱.
 * 프로필 디스커버리 결과를 저장해 재시작 시 빠르게 복원한다.
 */
import { Store } from '@tauri-apps/plugin-store'
import type { UserProfile } from '@cliprelay/shared'

let _store: Store | null = null

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await Store.load('profile.json')
  }
  return _store
}

export async function loadProfile(): Promise<UserProfile | null> {
  const store = await getStore()
  return (await store.get<UserProfile>('profile')) ?? null
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  const store = await getStore()
  await store.set('profile', profile)
}

export async function clearProfile(): Promise<void> {
  const store = await getStore()
  await store.delete('profile')
}
