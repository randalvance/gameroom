// Bernard's cabinet progression is deliberately local to the player and
// browser. It is an arcade secret, not event or game-room state.

const BERNARD_UNLOCK_KEY = "impact-hackers.bernard-unlocked"

export function loadBernardUnlock(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(BERNARD_UNLOCK_KEY) === "true"
  } catch {
    return false
  }
}

export function saveBernardUnlock(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(BERNARD_UNLOCK_KEY, "true")
  } catch {
    // Private browsing must leave the cabinet playable even without storage.
  }
}
