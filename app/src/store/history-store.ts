/**
 * 클립보드 히스토리 로컬 저장소
 *
 * 수신/발신한 kind:9372 이벤트를 최대 MAX_ITEMS개까지 저장한다.
 * Step 9 히스토리 뷰어에서 읽는다.
 */
import { Store } from '@tauri-apps/plugin-store'
import type { ClipboardPayload } from '@cliprelay/shared'

export interface HistoryItem {
  id: string
  createdAt: number
  payload: ClipboardPayload
  fingerprint?: string
}

const MAX_ITEMS = 100
let _store: Store | null = null

async function getStore(): Promise<Store> {
  if (!_store) _store = await Store.load('history.json')
  return _store
}

export async function loadHistory(): Promise<HistoryItem[]> {
  const store = await getStore()
  return (await store.get<HistoryItem[]>('items')) ?? []
}

export async function clearHistory(): Promise<void> {
  const store = await getStore()
  await store.set('items', [])
}

export async function appendHistory(item: HistoryItem): Promise<void> {
  const store = await getStore()
  const items = (await store.get<HistoryItem[]>('items')) ?? []
  items.unshift(item)
  if (items.length > MAX_ITEMS) items.splice(MAX_ITEMS)
  await store.set('items', items)
}
