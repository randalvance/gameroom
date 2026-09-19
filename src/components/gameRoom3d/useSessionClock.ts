// The trading window's clock, for the room's big screen.
//
// The room has no window selector, so this always reads the effective window —
// the same one the leaderboard's clock reads when nobody has picked a past one.
import { useEffect, useState } from "react"
import { getPublicSessionFn } from "~/server/exchange"
import type { SessionClockSnapshot } from "./session-screen"

/** Same cadence as the leaderboard's clock; the screen ticks between polls. */
export const SESSION_CLOCK_POLL_MS = 5000

export function useSessionClock(): SessionClockSnapshot | null {
  const [snapshot, setSnapshot] = useState<SessionClockSnapshot | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const session = await getPublicSessionFn({ data: {} })
        if (!alive) return
        setSnapshot(session === null ? null : {
          status: session.status,
          elapsedSeconds: session.elapsedSeconds,
          remainingSeconds: session.remainingSeconds,
          fetchedAtMs: Date.now(),
        })
      } catch {
        // A dropped poll leaves the last snapshot on the wall — it keeps
        // ticking, and the next poll re-anchors it. Better than blanking the
        // screen because one request timed out.
      }
    }
    load()
    const id = setInterval(load, SESSION_CLOCK_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])

  return snapshot
}
