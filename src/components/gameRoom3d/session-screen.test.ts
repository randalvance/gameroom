import { describe, expect, it } from "vitest"
import { TEXT_GAIN, TEXT_GOLD, TEXT_LOSS } from "./screen-pages"
import { EVENT_OVER_SCREEN, doorsCountdown, eventStarted, LAUNCH_MS, screenLines, type SessionClockSnapshot } from "./session-screen"

const at = (iso: string) => new Date(iso).getTime()

function running(overrides: Partial<SessionClockSnapshot> = {}): SessionClockSnapshot {
  return {
    status: "running",
    elapsedSeconds: 60,
    remainingSeconds: 300,
    fetchedAtMs: at("2026-09-18T02:00:00Z"),
    ...overrides,
  }
}

describe("screenLines — no trading window", () => {
  it("falls back to the launch countdown when there is no session", () => {
    const lines = screenLines(null, LAUNCH_MS - (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000)
    expect(lines.subtitle).toBe("COUNTDOWN TO LAUNCH  ·  18 SEP 2026  9:00 AM SGT")
    expect(lines.readout).toBe("002d 03h 04m 05s")
    expect(lines.color).toBe(TEXT_GAIN)
  })

  it("falls back to the launch countdown once the window has ended", () => {
    const lines = screenLines(running({ status: "ended" }), LAUNCH_MS - 86400_000)
    expect(lines.subtitle).toBe("COUNTDOWN TO LAUNCH  ·  18 SEP 2026  9:00 AM SGT")
    expect(lines.readout).toBe("001d 00h 00m 00s")
  })

  it("clamps the launch countdown at zero after launch", () => {
    const lines = screenLines(null, LAUNCH_MS + 3600_000)
    expect(lines.readout).toBe("000d 00h 00m 00s")
    expect(lines.color).toBe(TEXT_LOSS)
  })
})

describe("screenLines — a window is running", () => {
  it("shows the remaining time as a T-minus countdown", () => {
    const s = running({ remainingSeconds: 252 })
    expect(screenLines(s, s.fetchedAtMs)).toEqual({
      subtitle: "TRADING WINDOW  ·  LIVE",
      readout: "T-04:12",
      color: TEXT_GAIN,
      solo: false,
    })
  })

  it("ticks the countdown down between polls", () => {
    const s = running({ remainingSeconds: 300 })
    expect(screenLines(s, s.fetchedAtMs + 10_000).readout).toBe("T-04:50")
  })

  it("keeps the hour field for a window longer than an hour", () => {
    const s = running({ remainingSeconds: 3725 })
    expect(screenLines(s, s.fetchedAtMs).readout).toBe("T-1:02:05")
  })

  it("turns red inside the last two minutes", () => {
    const s = running({ remainingSeconds: 119 })
    expect(screenLines(s, s.fetchedAtMs).color).toBe(TEXT_LOSS)
  })

  it("stays green at exactly two minutes left", () => {
    const s = running({ remainingSeconds: 120 })
    expect(screenLines(s, s.fetchedAtMs).color).toBe(TEXT_GAIN)
  })

  it("never counts past zero while waiting for the next poll", () => {
    const s = running({ remainingSeconds: 5 })
    expect(screenLines(s, s.fetchedAtMs + 60_000).readout).toBe("0")
  })

  it("counts elapsed time up for an open-ended window", () => {
    const s = running({ elapsedSeconds: 767, remainingSeconds: null })
    expect(screenLines(s, s.fetchedAtMs)).toEqual({
      subtitle: "TRADING WINDOW  ·  LIVE",
      readout: "12:47 ELAPSED",
      color: TEXT_GAIN,
      solo: false,
    })
  })

  it("ticks an open-ended window's elapsed time up between polls", () => {
    const s = running({ elapsedSeconds: 767, remainingSeconds: null })
    expect(screenLines(s, s.fetchedAtMs + 13_000).readout).toBe("13:00 ELAPSED")
  })
})

describe("screenLines — a window is paused", () => {
  it("marks the clock paused and holds the remaining time", () => {
    const s = running({ status: "paused", remainingSeconds: 252 })
    expect(screenLines(s, s.fetchedAtMs)).toEqual({
      subtitle: "TRADING WINDOW  ·  PAUSED",
      readout: "▮▮ 04:12",
      color: TEXT_GOLD,
      solo: false,
    })
  })

  it("does not tick while paused", () => {
    const s = running({ status: "paused", remainingSeconds: 252 })
    expect(screenLines(s, s.fetchedAtMs + 30_000).readout).toBe("▮▮ 04:12")
  })

  it("holds elapsed time for a paused open-ended window", () => {
    const s = running({ status: "paused", elapsedSeconds: 767, remainingSeconds: null })
    const lines = screenLines(s, s.fetchedAtMs + 30_000)
    expect(lines.readout).toBe("▮▮ 12:47 ELAPSED")
    expect(lines.color).toBe(TEXT_GOLD)
  })

  it("stays amber inside the last two minutes — paused is not urgent", () => {
    const s = running({ status: "paused", remainingSeconds: 30 })
    expect(screenLines(s, s.fetchedAtMs).color).toBe(TEXT_GOLD)
  })
})

describe("screenLines — the last minute", () => {
  it("clears the wall and counts bare seconds", () => {
    const s = running({ remainingSeconds: 45 })
    expect(screenLines(s, s.fetchedAtMs)).toEqual({
      subtitle: "",
      readout: "45",
      color: TEXT_LOSS,
      solo: true,
    })
  })

  it("still shows the full screen with a minute left", () => {
    const s = running({ remainingSeconds: 60 })
    const lines = screenLines(s, s.fetchedAtMs)
    expect(lines.solo).toBe(false)
    expect(lines.readout).toBe("T-01:00")
    expect(lines.subtitle).toBe("TRADING WINDOW  ·  LIVE")
  })

  it("drops to the bare count as the clock ticks past a minute", () => {
    const s = running({ remainingSeconds: 65 })
    expect(screenLines(s, s.fetchedAtMs + 10_000).readout).toBe("55")
  })

  it("holds the whole screen for a paused window — a frozen clock is not urgent", () => {
    const s = running({ status: "paused", remainingSeconds: 30 })
    expect(screenLines(s, s.fetchedAtMs)).toEqual({
      subtitle: "TRADING WINDOW  ·  PAUSED",
      readout: "▮▮ 00:30",
      color: TEXT_GOLD,
      solo: false,
    })
  })

  it("gives launch day the same last minute", () => {
    const lines = screenLines(null, LAUNCH_MS - 45_000)
    expect(lines).toEqual({ subtitle: "", readout: "45", color: TEXT_LOSS, solo: true })
  })

  it("still shows the full screen with a minute to launch", () => {
    const lines = screenLines(null, LAUNCH_MS - 60_000)
    expect(lines.solo).toBe(false)
    expect(lines.readout).toBe("000d 00h 01m 00s")
  })

  it("rests on the full screen once launch has passed, not on a lone zero", () => {
    const lines = screenLines(null, LAUNCH_MS)
    expect(lines.solo).toBe(false)
    expect(lines.readout).toBe("000d 00h 00m 00s")
  })
})

describe("eventStarted", () => {
  it("is false before the event's first trading window", () => {
    expect(eventStarted(null)).toBe(false)
  })

  it("stays true for a window that has already closed", () => {
    // The room keeps its standings after the last window ends — the event
    // started, and the placings teams earned are still the answer.
    expect(eventStarted(running({ status: "ended" }))).toBe(true)
    expect(eventStarted(running({ status: "paused" }))).toBe(true)
    expect(eventStarted(running())).toBe(true)
  })
})

// Before the doors open the room counts to the DOORS, not to launch: that is
// the zero the room empties on (routes/game-room.tsx sends students to the
// main menu), so the wall must agree with it to the second.
describe("screenLines — the doors countdown", () => {
  const DOORS = Date.UTC(2026, 8, 18, 0, 0, 0) // 18 Sep 2026 08:00 SGT

  it("counts to the doors under a DOORS OPEN title, in SGT", () => {
    const lines = screenLines(null, DOORS - (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000, doorsCountdown(DOORS))
    expect(lines.subtitle).toBe("DOORS OPEN  ·  18 SEP 2026  8:00 AM SGT")
    expect(lines.readout).toBe("002d 03h 04m 05s")
    expect(lines.color).toBe(TEXT_GAIN)
  })

  it("gives the last minute the whole screen, like launch", () => {
    const lines = screenLines(null, DOORS - 30_000, doorsCountdown(DOORS))
    expect(lines).toEqual({ subtitle: "", readout: "30", color: TEXT_LOSS, solo: true })
  })

  it("formats a moved opening time from the instant, not a fixed string", () => {
    const moved = Date.UTC(2026, 8, 17, 23, 30, 0) // 18 Sep 2026 07:30 SGT
    expect(screenLines(null, moved - 60_000 * 5, doorsCountdown(moved)).subtitle)
      .toBe("DOORS OPEN  ·  18 SEP 2026  7:30 AM SGT")
  })
})

// After the event the site is locked again with the doors pushed far out: the
// wall says the hackathon is over rather than counting down to them.
describe("screenLines — after the event", () => {
  const ended = { status: "ended", elapsedSeconds: 1800, remainingSeconds: 0, fetchedAtMs: 0 } as const

  it("shows the over message in place of a count, with or without a last window", () => {
    const nowMs = Date.UTC(2026, 8, 19, 4, 0, 0)
    const expected = { subtitle: "THE HACKATHON IS NOW OVER", readout: "FEEL FREE TO ROAM", color: TEXT_GOLD, solo: false }
    expect(screenLines(null, nowMs, EVENT_OVER_SCREEN)).toEqual(expected)
    expect(screenLines({ ...ended }, nowMs, EVENT_OVER_SCREEN)).toEqual(expected)
  })
})
