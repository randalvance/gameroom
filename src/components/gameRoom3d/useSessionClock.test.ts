// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getPublicSessionFn = vi.fn()
vi.mock("~/server/exchange", () => ({
  getPublicSessionFn: (...args: unknown[]) => getPublicSessionFn(...args),
}))

import { SESSION_CLOCK_POLL_MS, useSessionClock } from "./useSessionClock"

const NOW = new Date("2026-09-18T02:30:00Z").getTime()

const session = (overrides: Record<string, unknown> = {}) => ({
  id: "w1",
  status: "running",
  mode: "live",
  startedAt: "2026-09-18T02:00:00Z",
  elapsedSeconds: 1800,
  durationSeconds: 3600,
  remainingSeconds: 1800,
  ...overrides,
})

beforeEach(() => {
  getPublicSessionFn.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/** Let the in-flight poll resolve and React re-render. */
async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

describe("useSessionClock", () => {
  it("reads the effective window rather than a named one", async () => {
    getPublicSessionFn.mockResolvedValue(null)
    renderHook(() => useSessionClock())
    await flush()
    expect(getPublicSessionFn).toHaveBeenCalledWith({ data: {} })
  })

  it("stamps the snapshot with the moment it landed, so the screen can tick", async () => {
    getPublicSessionFn.mockResolvedValue(session())
    const { result } = renderHook(() => useSessionClock())

    await flush()
    expect(result.current).toEqual({
      status: "running",
      elapsedSeconds: 1800,
      remainingSeconds: 1800,
      fetchedAtMs: NOW,
    })
  })

  it("stays null while no window is scheduled", async () => {
    getPublicSessionFn.mockResolvedValue(null)
    const { result } = renderHook(() => useSessionClock())

    await flush()
    expect(result.current).toBeNull()
  })

  it("re-polls on the interval and replaces the snapshot", async () => {
    getPublicSessionFn.mockResolvedValue(session())
    const { result } = renderHook(() => useSessionClock())
    await flush()

    getPublicSessionFn.mockResolvedValue(session({ status: "paused", remainingSeconds: 900 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CLOCK_POLL_MS)
    })

    expect(result.current).toEqual({
      status: "paused",
      elapsedSeconds: 1800,
      remainingSeconds: 900,
      fetchedAtMs: NOW + SESSION_CLOCK_POLL_MS,
    })
  })

  it("keeps the last good snapshot when a poll fails", async () => {
    getPublicSessionFn.mockResolvedValue(session())
    const { result } = renderHook(() => useSessionClock())
    await flush()
    const before = result.current

    getPublicSessionFn.mockRejectedValue(new Error("offline"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CLOCK_POLL_MS)
    })

    expect(result.current).toEqual(before)
  })

  it("stops polling once the room is closed", async () => {
    getPublicSessionFn.mockResolvedValue(session())
    const { unmount } = renderHook(() => useSessionClock())
    await flush()

    unmount()
    const calls = getPublicSessionFn.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CLOCK_POLL_MS * 3)
    })

    expect(getPublicSessionFn.mock.calls.length).toBe(calls)
  })
})
