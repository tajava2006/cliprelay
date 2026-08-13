/**
 * 이 세션에서 우리가 발행한 이벤트 id — 에코(자기 이벤트 재수신) 판별용.
 *
 * 일반 텍스트는 발행 전에 히스토리에 미리 저장해서 에코를 거르지만(hasHistoryId),
 * concealed 텍스트는 히스토리에 남기지 않으므로 그 방법을 쓸 수 없다.
 * 인메모리 셋으로 대신한다 — 에코는 발행 직후 수 초 안에 오므로 세션 수명이면
 * 충분하고, 민감 정보의 흔적을 디스크에 남기지 않는다는 목적에도 부합한다.
 */
const MAX_IDS = 500

const ownIds = new Set<string>()

export function noteOwnEvent(id: string): void {
  ownIds.add(id)
  if (ownIds.size > MAX_IDS) {
    const first = ownIds.values().next().value
    if (first !== undefined) ownIds.delete(first)
  }
}

export function isOwnEvent(id: string): boolean {
  return ownIds.has(id)
}
