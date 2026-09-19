// The doors, as the game room watches them.
//
// Before the opening time (lib/student-access) the room is a waiting room:
// the wall counts to the doors and nothing else, the desks carry no placings,
// the price strip is off, and at zero a student is sent to the main menu.
// This hook is the one clock all of that hangs off. It counts on the SERVER's
// time — the loader hands in the server's "now" alongside the opening time,
// and the hook keeps that offset from Date.now() — so a laptop set a day
// ahead does not open the room early, and it re-reads the time on the
// holding screen's cadence so the console opening the doors early reaches a
// room that is already full without anyone reloading.

import { useEffect, useState } from "react"
import { STUDENT_ACCESS_POLL_MS, eventOver } from "~/lib/student-access"
import { getStudentAccessFn, type StudentAccessView } from "~/server/student-access"

/** How often the room re-checks whether the count has reached zero. */
const TICK_MS = 1000

export interface Doors {
  /** The doors are still shut: the room is in its waiting state. */
  preEvent: boolean
  /** When they open, for the wall to count to. */
  opensAtMs: number
  /** The hackathon is behind us, so shut doors are the site closed again
   * rather than a wait for it to open: the wall says so instead of counting. */
  over: boolean
}

function isStudentAccessView(v: unknown): v is StudentAccessView {
  const o = v as Partial<StudentAccessView> | null | undefined
  return Number.isFinite(o?.opensAtMs) && Number.isFinite(o?.serverNowMs)
}

export function useDoors(initial: StudentAccessView): Doors {
  const [view, setView] = useState(initial)
  // Laptop clock → server clock, re-fixed on every poll response.
  const [offsetMs, setOffsetMs] = useState(() => initial.serverNowMs - Date.now())
  const [preEvent, setPreEvent] = useState(() => initial.serverNowMs < initial.opensAtMs)
  const [over, setOver] = useState(() => eventOver(initial.serverNowMs))

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const next: unknown = await getStudentAccessFn()
        // Not every reply that resolves is a view: TanStack Start resolves a
        // bare h3 error body — the server's answer mid-deploy — with undefined
        // (CODE2IMPACT2026-W). Treat anything else like a dropped poll.
        if (!alive || !isStudentAccessView(next)) return
        setView(next)
        setOffsetMs(next.serverNowMs - Date.now())
      } catch {
        // A dropped poll keeps the last known time; the count carries on.
      }
    }
    const id = setInterval(() => { void poll() }, STUDENT_ACCESS_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])

  useEffect(() => {
    const tick = () => {
      const nowMs = Date.now() + offsetMs
      setPreEvent(nowMs < view.opensAtMs)
      setOver(eventOver(nowMs))
    }
    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [view.opensAtMs, offsetMs])

  return { preEvent, opensAtMs: view.opensAtMs, over }
}
