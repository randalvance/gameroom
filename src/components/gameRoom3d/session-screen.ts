// What the room's wall-wide screen says.
//
// The screen has one big readout, and two things want it: the countdown to
// launch day, and — once the event is actually running — the trading window's
// clock. The window wins whenever there is one, because a room full of people
// trading against a deadline cares about the deadline, not about the date they
// are already standing on. With no window running the screen goes back to the
// launch countdown rather than holding a dead 00:00 on the wall.
//
// Everything here is pure so the four states can be tested without a canvas:
// `drawScreenCanvas` only paints what this returns.

import { TEXT_GAIN, TEXT_GOLD, TEXT_LOSS } from "./screen-pages"

/** Launch day: 18 Sep 2026, 09:00 SGT. */
export const LAUNCH_MS = new Date("2026-09-18T01:00:00Z").getTime()

/**
 * What the clock page counts to when no trading window is running: an
 * instant and the title over it. Launch day by default; before the doors open
 * the room hands in the doors instead (routes/game-room.tsx), because that is
 * the zero the room empties on and the wall must agree with it to the second.
 */
export interface ScreenCountdown {
  atMs: number
  title: string
  /** Words for the readout in place of a count — the wall after the event,
   * when the doors are a lock rather than a moment anyone is waiting for. */
  message?: string
}

export const LAUNCH_COUNTDOWN: ScreenCountdown = { atMs: LAUNCH_MS, title: "COUNTDOWN TO LAUNCH" }

/** The doors as the wall counts to them (lib/student-access holds the time). */
export function doorsCountdown(opensAtMs: number): ScreenCountdown {
  return { atMs: opensAtMs, title: "DOORS OPEN" }
}

/** The wall once the hackathon is over and the site has closed behind it. */
export const EVENT_OVER_SCREEN: ScreenCountdown = {
  atMs: 0,
  title: "THE HACKATHON IS NOW OVER",
  message: "FEEL FREE TO ROAM",
}

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

/** An instant as the wall writes it: "18 SEP 2026  9:00 AM SGT", by hand
 * rather than through the browser's zone, which is not the event's. */
export function formatCountdownSgt(ms: number): string {
  const d = new Date(ms + SGT_OFFSET_MS)
  const h24 = d.getUTCHours()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const minutes = String(d.getUTCMinutes()).padStart(2, "0")
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}  ${h12}:${minutes} ${h24 < 12 ? "AM" : "PM"} SGT`
}


/** The last poll of `getPublicSessionFn`, stamped with when it landed. */
export interface SessionClockSnapshot {
  status: "running" | "paused" | "ended"
  elapsedSeconds: number
  /** null for an open-ended window — it counts up instead. */
  remainingSeconds: number | null
  /** Wall-clock ms at which this snapshot was read, so the seconds can tick
   * between the 5s polls instead of jumping. */
  fetchedAtMs: number
}

/**
 * Has the event started?
 *
 * A trading window is the event starting: `getPublicSessionFn` answers null
 * only before the first window of the event has ever opened (and keeps
 * answering with the last one after it closes, so an ended window still
 * counts). Everything the room derives from standings — the wall screen's
 * leaderboard page, the floating placing over each desk — hangs off this,
 * because before that moment a placing is a number nobody has earned.
 */
export function eventStarted(session: SessionClockSnapshot | null): boolean {
  return session !== null
}

export interface ScreenLines {
  subtitle: string
  readout: string
  color: string
  /**
   * The last minute: the screen clears to nothing but the count. The title,
   * its rule, and the subtitle all come off, so what is left is one number
   * readable from the back of the room. `subtitle` is empty when this is set.
   */
  solo: boolean
}

/** Under this much left, the countdown goes red. */
const URGENT_SECONDS = 120

/** Under this much left, the screen shows the count and nothing else. */
const SOLO_SECONDS = 60

const pad = (n: number) => String(n).padStart(2, "0")

/** mm:ss, growing an hour field only when there is one. */
function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

/** The whole screen given over to one number. */
function soloLines(seconds: number): ScreenLines {
  return { subtitle: "", readout: String(seconds), color: TEXT_LOSS, solo: true }
}

function launchLines(nowMs: number, countdown: ScreenCountdown): ScreenLines {
  if (countdown.message !== undefined) {
    return { subtitle: countdown.title, readout: countdown.message, color: TEXT_GOLD, solo: false }
  }
  const diff = Math.max(0, countdown.atMs - nowMs)
  // Launch itself is the resting state for every day after the event, so it
  // keeps the full screen — a lone red 0 on the wall forever is not a state.
  if (diff > 0 && diff < SOLO_SECONDS * 1000) return soloLines(Math.floor(diff / 1000))
  const dd = Math.floor(diff / 86400000)
  const hh = Math.floor((diff % 86400000) / 3600000)
  const mm = Math.floor((diff % 3600000) / 60000)
  const ss = Math.floor((diff % 60000) / 1000)
  return {
    subtitle: `${countdown.title}  ·  ${formatCountdownSgt(countdown.atMs)}`,
    readout: `${String(dd).padStart(3, "0")}d ${pad(hh)}h ${pad(mm)}m ${pad(ss)}s`,
    color: diff === 0 ? TEXT_LOSS : TEXT_GAIN,
    solo: false,
  }
}

export function screenLines(
  session: SessionClockSnapshot | null,
  nowMs: number,
  countdown: ScreenCountdown = LAUNCH_COUNTDOWN,
): ScreenLines {
  if (!session || session.status === "ended") return launchLines(nowMs, countdown)

  // A paused window's clock is frozen — the seconds it spends paused are not
  // seconds of trading, and a screen that kept counting would say otherwise.
  const paused = session.status === "paused"
  const sinceFetch = paused ? 0 : Math.max(0, Math.floor((nowMs - session.fetchedAtMs) / 1000))

  if (session.remainingSeconds === null) {
    const elapsed = session.elapsedSeconds + sinceFetch
    return {
      subtitle: paused ? "TRADING WINDOW  ·  PAUSED" : "TRADING WINDOW  ·  LIVE",
      readout: `${paused ? "▮▮ " : ""}${clock(elapsed)} ELAPSED`,
      color: paused ? TEXT_GOLD : TEXT_GAIN,
      solo: false,
    }
  }

  const remaining = Math.max(0, session.remainingSeconds - sinceFetch)
  // A paused clock is not in its final minute in any sense that matters — it
  // is not moving — so it keeps the full screen however little is left.
  if (!paused && remaining < SOLO_SECONDS) return soloLines(remaining)
  return {
    subtitle: paused ? "TRADING WINDOW  ·  PAUSED" : "TRADING WINDOW  ·  LIVE",
    readout: paused ? `▮▮ ${clock(remaining)}` : `T-${clock(remaining)}`,
    // Paused stays amber however little is left: the clock is not running, so
    // the last two minutes are not ticking away.
    color: paused ? TEXT_GOLD : remaining < URGENT_SECONDS ? TEXT_LOSS : TEXT_GAIN,
    solo: false,
  }
}
