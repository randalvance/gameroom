import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  allowedAnalyticsAttributes,
  analyticsEvents,
  isAnalyticsEvent,
  MAX_TEXT_LENGTH,
  setAnalyticsActor,
  setAnalyticsSink,
  track,
  type AnalyticsRecord,
} from "./analytics"

describe("analytics", () => {
  beforeEach(() => {
    setAnalyticsSink(null)
    setAnalyticsActor(null)
  })

  // The library ships no telemetry: an embedder who installs nothing sends
  // nothing anywhere, which is the whole reason track() goes through a sink.
  it("sends nothing until a sink is installed", () => {
    expect(() => track("easter_egg.arcade_unlocked", { already_unlocked: false })).not.toThrow()
  })

  it("hands the sink the event, its message and the actor", () => {
    const seen: AnalyticsRecord[] = []
    setAnalyticsSink((record) => seen.push(record))
    setAnalyticsActor({ id: "u1", name: "Wei Ming", email: null, role: "student" })

    track("easter_egg.arcade_unlocked", { already_unlocked: true })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.event).toBe("easter_egg.arcade_unlocked")
    expect(seen[0]!.message).toBe(analyticsEvents["easter_egg.arcade_unlocked"].message)
    expect(seen[0]!.actor?.id).toBe("u1")
    expect(seen[0]!.attributes).toEqual({ already_unlocked: true })
  })

  // The registry is the contract. An attribute the event did not declare is
  // dropped here rather than forwarded, so a sink is never handed a field
  // nobody reviewed — the room's chat text being the case that matters.
  it("drops attributes the event never declared", () => {
    const seen: AnalyticsRecord[] = []
    setAnalyticsSink((record) => seen.push(record))

    track("game_room.chat_sent", { text: "meet me at the white desk" } as never)

    expect(seen[0]!.attributes).toEqual({})
  })

  it("cuts free text to a bounded length", () => {
    const kept = allowedAnalyticsAttributes("primey.question_asked", {
      question: "x".repeat(MAX_TEXT_LENGTH + 50),
    })
    expect((kept.question as string).length).toBe(MAX_TEXT_LENGTH)
  })

  // Analytics never breaks the thing being measured.
  it("swallows a sink that throws", () => {
    setAnalyticsSink(() => {
      throw new Error("no")
    })
    expect(() => track("easter_egg.backrooms_unlocked")).not.toThrow()
  })

  it("knows its own event names", () => {
    expect(isAnalyticsEvent("arcade.match_started")).toBe(true)
    expect(isAnalyticsEvent("arcade.not_a_thing")).toBe(false)
  })

  it("every registered event has a message", () => {
    const missing = Object.entries(analyticsEvents).filter(([, spec]) => !spec.message.trim())
    expect(missing).toEqual([])
  })

  it("does not reach for a global logger", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {})
    setAnalyticsSink(null)
    track("backrooms.escaped")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
