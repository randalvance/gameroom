// @vitest-environment jsdom
// CODE2IMPACT2026-W: "Cannot read properties of undefined (reading
// 'opensAtMs')" on /game-room, every event during a deploy. A server function
// answered with a bare h3 error body (`{"status":500,"unhandled":true,...}`,
// no seroval header) — which is what the server says to a function id it does
// not know — and TanStack Start's client RESOLVES that with `undefined`
// instead of rejecting. The poll stored it before reading `serverNowMs`, so
// the throw was swallowed but the state was already gone, and the next render
// crashed the room.
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getStudentAccessFn = vi.fn()
vi.mock("~/server/student-access", () => ({
  getStudentAccessFn: (...args: unknown[]) => getStudentAccessFn(...args),
}))

import { STUDENT_ACCESS_POLL_MS } from "~/lib/student-access"
import { useDoors } from "./useDoors"

const NOW = Date.UTC(2026, 8, 16, 3, 0)
const OPENS = NOW + 3_600_000

beforeEach(() => {
  getStudentAccessFn.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(STUDENT_ACCESS_POLL_MS) })
}

describe("useDoors", () => {
  it("counts to the doors from the loader's view", () => {
    const { result } = renderHook(() => useDoors({ opensAtMs: OPENS, serverNowMs: NOW }))
    expect(result.current).toEqual({ preEvent: true, opensAtMs: OPENS, over: false })
  })

  it("follows a poll that moves the doors", async () => {
    const moved = NOW - 1
    getStudentAccessFn.mockResolvedValue({ opensAtMs: moved, serverNowMs: NOW })
    const { result } = renderHook(() => useDoors({ opensAtMs: OPENS, serverNowMs: NOW }))
    await poll()
    expect(result.current).toEqual({ preEvent: false, opensAtMs: moved, over: false })
  })

  it.each([
    ["undefined (an h3 error body the client resolved)", undefined],
    ["an h3 error body passed through as data", { status: 500, unhandled: true, message: "HTTPError" }],
    ["a view with a missing clock", { opensAtMs: OPENS }],
  ])("keeps the last known doors when a poll resolves with %s", async (_label, reply) => {
    getStudentAccessFn.mockResolvedValue(reply)
    const { result } = renderHook(() => useDoors({ opensAtMs: OPENS, serverNowMs: NOW }))
    await poll()
    await poll()
    expect(result.current).toEqual({ preEvent: true, opensAtMs: OPENS, over: false })
  })
})
