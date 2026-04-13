/**
 * 인앱 토스트 이벤트 버스
 *
 * fire-and-forget 방식으로 토스트를 발행한다.
 * React 컴포넌트가 구독해 화면에 표시한다.
 */

export interface ToastMessage {
  id: number
  text: string
  type: 'info' | 'ok' | 'error'
}

type Listener = (msg: ToastMessage) => void

let _nextId = 0
const _listeners: Set<Listener> = new Set()

export function onToast(listener: Listener): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

export function toast(text: string, type: ToastMessage['type'] = 'info'): void {
  const msg: ToastMessage = { id: _nextId++, text, type }
  for (const listener of _listeners) listener(msg)
}
