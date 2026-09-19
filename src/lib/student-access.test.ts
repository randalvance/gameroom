// The student-access gate, pure: when a student is held on the "not started"
// screen, how the stored opening time is read, and how the organizer's SGT
// wall-clock entry round-trips. Everything the root route and the console
// row depend on is decided here, with no router and no database.
import { describe, expect, it } from "vitest"
import {
  DEFAULT_STUDENT_ACCESS_OPENS_AT_MS,
  EVENT_ENDED_AT_MS,
  countdownParts,
  decodeOpensAtMs,
  eventOver,
  formatSgtLocal,
  parseSgtLocal,
  studentGateDecision,
} from "./student-access"

const OPENS = Date.UTC(2026, 8, 18, 0, 0, 0) // 18 Sep 2026 08:00 SGT

describe("the default opening time", () => {
  it("is 18 Sep 2026, 08:00 SGT", () => {
    expect(DEFAULT_STUDENT_ACCESS_OPENS_AT_MS).toBe(OPENS)
  })
})

describe("decodeOpensAtMs", () => {
  it("reads an ISO timestamp", () => {
    expect(decodeOpensAtMs("2026-09-18T01:30:00.000Z")).toBe(Date.UTC(2026, 8, 18, 1, 30))
  })

  it("falls back to the default when there is no row", () => {
    expect(decodeOpensAtMs(undefined)).toBe(OPENS)
    expect(decodeOpensAtMs(null)).toBe(OPENS)
  })

  it("falls back to the default on a value it cannot read", () => {
    expect(decodeOpensAtMs("next friday")).toBe(OPENS)
    expect(decodeOpensAtMs(42)).toBe(OPENS)
    expect(decodeOpensAtMs({ at: "2026-09-18" })).toBe(OPENS)
  })
})

describe("studentGateDecision", () => {
  const before = OPENS - 1
  const after = OPENS + 1

  it("sends a student from the landing page to the game room before the opening time", () => {
    expect(studentGateDecision({ role: "student", path: "/", nowMs: before, opensAtMs: OPENS })).toBe("room")
  })

  it("lets a student reach the game room, and the wardrobe on the way, before the opening time", () => {
    for (const path of ["/game-room", "/character"]) {
      expect(studentGateDecision({ role: "student", path, nowMs: before, opensAtMs: OPENS })).toBe("pass")
    }
  })

  it("passes a student once the opening time has arrived", () => {
    expect(studentGateDecision({ role: "student", path: "/", nowMs: OPENS, opensAtMs: OPENS })).toBe("pass")
    expect(studentGateDecision({ role: "student", path: "/", nowMs: after, opensAtMs: OPENS })).toBe("pass")
  })

  it("never holds another role", () => {
    for (const role of ["viewer", "mentor", "judge", "admin"] as const) {
      expect(studentGateDecision({ role, path: "/", nowMs: before, opensAtMs: OPENS })).toBe("pass")
    }
  })

  it("lets a held student reach the holding screen, sign out, and the API", () => {
    for (const path of ["/not-started", "/sign-out", "/api/exchange/session"]) {
      expect(studentGateDecision({ role: "student", path, nowMs: before, opensAtMs: OPENS })).toBe("pass")
    }
  })

  it("holds a student on every other page before the opening time, deep links included", () => {
    for (const path of ["/profile/", "/challenges/trading-alpha", "/results", "/mentor"]) {
      expect(studentGateDecision({ role: "student", path, nowMs: before, opensAtMs: OPENS })).toBe("hold")
    }
  })
})

describe("SGT wall-clock round trip", () => {
  it("formats the default as 08:00 on the 18th, whatever the process timezone", () => {
    expect(formatSgtLocal(OPENS)).toBe("2026-09-18T08:00")
  })

  it("parses an organizer's SGT entry back to the same instant", () => {
    expect(parseSgtLocal("2026-09-18T08:00")).toBe(OPENS)
    expect(parseSgtLocal("2026-09-17T23:30")).toBe(Date.UTC(2026, 8, 17, 15, 30))
  })

  it("refuses an entry that is not a date-time", () => {
    expect(parseSgtLocal("")).toBeNull()
    expect(parseSgtLocal("2026-09-18")).toBeNull()
    expect(parseSgtLocal("2026-13-40T08:00")).toBeNull()
  })

  it("round-trips a value formatted from any instant", () => {
    const ms = Date.UTC(2026, 8, 17, 16, 5)
    expect(parseSgtLocal(formatSgtLocal(ms))).toBe(ms)
  })
})

describe("countdownParts", () => {
  it("splits a remaining span into days, hours, minutes and seconds", () => {
    const span = ((2 * 24 + 3) * 60 * 60 + 4 * 60 + 5) * 1000
    expect(countdownParts(span)).toEqual({ d: 2, h: 3, m: 4, s: 5 })
  })

  it("floors to whole seconds and never goes below zero", () => {
    expect(countdownParts(1500)).toEqual({ d: 0, h: 0, m: 0, s: 1 })
    expect(countdownParts(-1)).toEqual({ d: 0, h: 0, m: 0, s: 0 })
  })
})

describe("eventOver", () => {
  it("is false through the event day and true from midnight SGT after it", () => {
    expect(EVENT_ENDED_AT_MS).toBe(Date.UTC(2026, 8, 18, 16, 0, 0)) // 19 Sep 2026 00:00 SGT
    expect(eventOver(OPENS)).toBe(false)
    expect(eventOver(EVENT_ENDED_AT_MS - 1)).toBe(false)
    expect(eventOver(EVENT_ENDED_AT_MS)).toBe(true)
  })
})
