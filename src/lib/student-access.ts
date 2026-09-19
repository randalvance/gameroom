// When students may enter the site — the pure half.
//
// Before the opening time a signed-in student has ONE place on the site: the
// game room, where they can hang out with their own team while they wait (the
// hub scopes the room to a team until the doors open — see
// lib/gameRoomNet/visibility). The landing page sends them straight there,
// passing through /character first if they have no sprite yet; any other page
// holds them on /not-started, a countdown to the moment the organizers set with
// a way back into the room. At zero the count becomes an ENTER button and the
// whole site opens. The time lives in
// app_settings (server/student-access.ts) so it survives a redeploy and can
// be moved from the gamemaster console; this module is everything that can
// be decided without the database or the router, so the root route's gate,
// the console row and the holding screen all share one answer.
//
// The stored value is an ISO instant. Organizers read and write it as
// Singapore wall-clock time — the event runs in SGT and a laptop set to
// another zone must not shift the doors — so the SGT helpers here do the
// conversion by hand rather than trusting the browser's zone.

import type { Role } from "./auth"

/** Doors open: 18 Sep 2026, 08:00 SGT. The default when nothing is stored. */
export const DEFAULT_STUDENT_ACCESS_OPENS_AT_MS = Date.UTC(2026, 8, 18, 0, 0, 0)

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000

/** The hackathon's last day is over: 19 Sep 2026, 00:00 SGT. Doors that
 * still hold a student after this are not a countdown to an opening — they
 * are the site closed again behind the event, with only the game room left
 * open. The holding screen, the briefing and the room's wall say so instead
 * of counting to a date nobody is waiting for. */
export const EVENT_ENDED_AT_MS = Date.UTC(2026, 8, 18, 16, 0, 0)

/** Whether the event is behind us, by the server's clock. */
export function eventOver(nowMs: number): boolean {
  return nowMs >= EVENT_ENDED_AT_MS
}

/** The stored app_settings value → an instant. Anything unreadable is the
 * default, so a bad row can never lock students out for good or let them in
 * early — it only means "the scheduled morning". */
export function decodeOpensAtMs(value: unknown): number {
  if (typeof value !== "string") return DEFAULT_STUDENT_ACCESS_OPENS_AT_MS
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : DEFAULT_STUDENT_ACCESS_OPENS_AT_MS
}

/** How often a screen that waits on the doors re-reads the opening time —
 * the holding screen and the game room alike. Same cadence as the trading
 * kill switch's poll. */
export const STUDENT_ACCESS_POLL_MS = 5000

export type StudentGateDecision = "pass" | "room" | "hold"

/** Paths a student may still reach before the doors open: the game room and
 * the wardrobe on the way to it, the holding screen itself, the way out, and
 * the API (so a server-fn or SSE call answers instead of redirecting to HTML —
 * the same exemption the character gate makes). */
const EXEMPT_PREFIXES = ["/game-room", "/character", "/not-started", "/sign-out", "/api"]

export function studentGateDecision(input: {
  role: Role
  path: string
  nowMs: number
  opensAtMs: number
}): StudentGateDecision {
  if (input.role !== "student") return "pass"
  if (input.nowMs >= input.opensAtMs) return "pass"
  if (EXEMPT_PREFIXES.some((p) => input.path.startsWith(p))) return "pass"
  // The landing page is where a sign-in drops them: into the room, not a wall.
  if (input.path === "/") return "room"
  return "hold"
}

const pad = (n: number) => String(n).padStart(2, "0")

/** An instant as the `YYYY-MM-DDTHH:mm` an <input type="datetime-local">
 * shows, in SGT regardless of where the code runs. */
export function formatSgtLocal(ms: number): string {
  const d = new Date(ms + SGT_OFFSET_MS)
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  )
}

/** The inverse of formatSgtLocal; null for anything that is not a complete
 * SGT date-time, so a half-typed field cannot be saved as garbage. */
export function parseSgtLocal(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
  const ms = Date.UTC(y, mo - 1, d, h, mi) - SGT_OFFSET_MS
  // Date.UTC rolls an impossible date forward (month 13 → next year); refuse
  // anything that did not come back out the way it went in.
  return formatSgtLocal(ms) === value ? ms : null
}

export interface CountdownParts {
  d: number
  h: number
  m: number
  s: number
}

/** A remaining span as whole days/hours/minutes/seconds, clamped at zero. */
export function countdownParts(remainingMs: number): CountdownParts {
  const total = Math.max(0, Math.floor(remainingMs / 1000))
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  }
}
