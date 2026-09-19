import { afterEach, describe, expect, it, vi } from "vitest"
import { logger, resetLogSink, setLogSink, type LogRecord } from "./logger"

function capture(): LogRecord[] {
  const seen: LogRecord[] = []
  setLogSink((record) => seen.push(record))
  return seen
}

describe("logger", () => {
  afterEach(() => {
    resetLogSink()
  })

  it("logs the registered message for an event, at the level asked for", () => {
    const seen = capture()
    logger.warn("room3d.quality_reduced")
    expect(seen).toEqual([
      {
        level: "warn",
        event: "room3d.quality_reduced",
        message: "3D frame budget missed; reducing quality",
        details: [],
      },
    ])
  })

  // What a log SAYS is the reviewed string; an Error, a response or an id
  // travels beside it as a local diagnostic and is never folded into it.
  it("keeps details beside the message rather than in it", () => {
    const seen = capture()
    const err = new Error("ws://hub-7.internal refused the connection")
    logger.error("room3d.init_failed", err)
    expect(seen[0]!.message).toBe("3D room failed to initialise")
    expect(seen[0]!.message).not.toContain("hub-7")
    expect(seen[0]!.details).toEqual([err])
  })

  it("goes to the console by default", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {})
    logger.info("game_room.connected")
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it("can be silenced", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    setLogSink(null)
    logger.warn("duel.chunk_load_failed")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  // Logging never breaks the thing being logged.
  it("swallows a sink that throws", () => {
    setLogSink(() => {
      throw new Error("no")
    })
    expect(() => logger.error("room3d.cleanup_failed")).not.toThrow()
  })
})
