// Tiny shared flag: is a SpriteGenModal mounted right now?
//
// The generation-complete toast (SpriteReadyToast) and the modal are both
// consumers of the same one-per-user job slot, and delivery is exactly-once —
// whoever polls first wins the conditional clear. That race is SAFE but bad
// UX: a student watching the modal's own preview should never have the result
// yanked into a corner toast instead. So the modal registers itself here and
// the toast stays silent (stream closed) while any modal is open.
//
// Module scope, not context: the two components live in unrelated trees (the
// toast under the root document, the modal wherever a page spawns it).

let openCount = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function genModalMounted(): void {
  openCount++
  notify()
}

export function genModalUnmounted(): void {
  openCount = Math.max(0, openCount - 1)
  notify()
}

export function isGenModalOpen(): boolean {
  return openCount > 0
}

/** useSyncExternalStore-compatible subscribe. */
export function subscribeGenModal(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
