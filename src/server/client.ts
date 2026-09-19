// How the components reach the room server.
//
// In the event site this came from, everything in ~/server was a TanStack
// Start server function — code that ran on the server and was called like a
// local async function. Standalone there is no such compiler, so this file is
// the seam: the same call shapes, implemented as plain fetches to the room
// hub (server/hub-server.ts, or your own service speaking the same routes).
//
// Every call is written to DEGRADE rather than throw: a room with no hub is a
// single-player room, not a broken page. Callers already treat a failed poll
// as "keep what you had", so the one thing this must never do is reject in a
// way that tears down a render.

let baseUrl = ""

/**
 * Point the room at a hub somewhere else (a different origin, a sub-path).
 * Default is same-origin `/api`, which is what the demo app's dev proxy
 * serves.
 */
export function configureGameRoomApi(options: { baseUrl?: string }): void {
  baseUrl = (options.baseUrl ?? "").replace(/\/$/, "")
}

export function apiUrl(path: string): string {
  return `${baseUrl}${path}`
}

/** GET that answers `fallback` instead of throwing. */
export async function apiGet<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(apiUrl(path), { headers: { Accept: "application/json" } })
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

/** POST that answers `fallback` instead of throwing. */
export async function apiPost<T>(path: string, body: unknown, fallback: T): Promise<T> {
  try {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
    if (!res.ok) return fallback
    if (res.status === 204) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}
