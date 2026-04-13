/**
 * 사용자의 write 릴레이 목록을 Tauri Store에 캐싱.
 * kind:10002 디스커버리 결과를 저장해 재시작 시 빠르게 복원한다.
 */
import { Store } from '@tauri-apps/plugin-store'

let _store: Store | null = null

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await Store.load('relay.json')
  }
  return _store
}

export async function loadWriteRelays(): Promise<string[]> {
  const store = await getStore()
  return (await store.get<string[]>('writeRelays')) ?? []
}

export async function saveWriteRelays(relays: string[]): Promise<void> {
  const store = await getStore()
  await store.set('writeRelays', relays)
}

export async function clearWriteRelays(): Promise<void> {
  const store = await getStore()
  await store.delete('writeRelays')
}
