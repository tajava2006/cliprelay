/**
 * Blossom 서버 목록 로컬 캐시 (Tauri Store)
 */
import { Store } from '@tauri-apps/plugin-store'

let _store: Store | null = null

async function getStore(): Promise<Store> {
  if (!_store) _store = await Store.load('blossom.json')
  return _store
}

export async function loadBlossomServers(): Promise<string[]> {
  const store = await getStore()
  return (await store.get<string[]>('servers')) ?? []
}

export async function saveBlossomServers(servers: string[]): Promise<void> {
  const store = await getStore()
  await store.set('servers', servers)
}
