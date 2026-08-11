/**
 * 연결 복구 이벤트 로그 — 링버퍼 + localStorage 영속
 *
 * 사다리·워치독·최후수단이 뭘 했는지는 전부 console에만 남아 프로덕션에선
 * 보이지 않는다. 며칠 켜놓고 관찰할 때 "새벽에 무슨 일이 있었나"를 UI에서
 * 읽을 수 있도록, 의미 있는 연결 이벤트를 여기에 쌓는다.
 *
 * - localStorage 영속: 최후수단(페이지 리로드/앱 재시작)이 정확히 가장 궁금한
 *   순간인데 그때 JS 메모리가 날아가므로, 리로드와 재시작 모두 견디는
 *   localStorage에 write-through로 쓴다.
 * - 코얼레싱: 죽어 있는 동안 사다리가 15초마다 같은 행동을 반복하므로, 직전
 *   항목과 같은 메시지면 count만 올린다 (링버퍼 50개가 몇 분 만에 밀리는 것 방지).
 */

export interface ConnLogEntry {
  ts: number
  msg: string
  count: number
}

const STORAGE_KEY = 'cliprelay.connlog'
const MAX_ENTRIES = 50

function load(): ConnLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as ConnLogEntry[]) : []
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : []
  } catch {
    return []
  }
}

let entries: ConnLogEntry[] = load()
/** React useSyncExternalStore용 안정 스냅샷 (최신순) */
let snapshot: readonly ConnLogEntry[] = [...entries].reverse()
const listeners = new Set<() => void>()

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch { /* quota 등 — 로그는 최선노력 */ }
}

/** 연결 이벤트 기록. 직전 항목과 같은 메시지면 count만 올린다. */
export function logConn(msg: string): void {
  const last = entries[entries.length - 1]
  if (last && last.msg === msg) {
    last.count++
    last.ts = Date.now()
  } else {
    entries.push({ ts: Date.now(), msg, count: 1 })
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
  }
  persist()
  snapshot = [...entries].reverse()
  listeners.forEach(fn => fn())
}

export function getConnLogSnapshot(): readonly ConnLogEntry[] {
  return snapshot
}

export function subscribeConnLog(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
