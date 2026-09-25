// Who you are, for as long as this browser remembers it.
//
// The room needs an id (the hub seats one character per id), a name and a
// role. A real host has an account system; the demo has localStorage and a
// cookie, because the hub's SSE stream cannot carry a header and a cookie is
// what a same-origin EventSource does send.

import type { Role } from "~/lib/auth"

const KEY = "gameroom.demo.identity"

export interface Identity {
  id: string
  name: string
  role: Role
  /** The pool character they chose, or null for the derived one. */
  spriteId: number | null
  /** Set once the arcade's code has been entered: the cabinet is already
   * standing there on the next visit, with no drop-in entrance. */
  arcadeUnlocked: boolean
}

function fresh(): Identity {
  return {
    id: `visitor-${Math.random().toString(36).slice(2, 10)}`,
    name: "",
    role: "visitor",
    spriteId: null,
    arcadeUnlocked: false,
  }
}

export function loadIdentity(): Identity {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return fresh()
    const saved = JSON.parse(raw) as Partial<Identity>
    // A stored identity missing a field is a shape from an older build, not a
    // reason to refuse someone entry.
    return { ...fresh(), ...saved, id: saved.id ?? fresh().id }
  } catch {
    return fresh()
  }
}

export function saveIdentity(identity: Identity): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(identity))
  } catch {
    // A visitor with storage blocked still gets a room, just not a memory.
  }
}

/** The hub reads this: same-origin EventSource sends cookies, headers it cannot. */
export function publishIdentityCookie(identity: Identity): void {
  document.cookie = `gameroom_uid=${encodeURIComponent(identity.id)}; path=/; max-age=86400; samesite=lax`
}
