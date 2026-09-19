import { act, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const listClips = vi.fn()
vi.mock("~/server/market-news-clip", () => ({
  listMarketNewsClipsFn: () => listClips(),
}))

const { MARKET_NEWS_PREWARM_DELAY_MS, useMarketNewsPrewarm } = await import("./useMarketNewsPrewarm")

const CLIPS = [
  { id: "me1", webm: "/market-news/me1-a.webm", durationMs: 48_792 },
  { id: "me2", webm: "/market-news/me2-b.webm", durationMs: 59_667 },
  { id: "me3", webm: "/market-news/me3-c.webm", durationMs: 54_625 },
]

function Warm({ enabled = true }: { enabled?: boolean }) {
  useMarketNewsPrewarm(enabled)
  return null
}

/** Fetches that never settle until released, so ordering can be observed. */
function deferredFetch() {
  const calls: string[] = []
  const release: Array<() => void> = []
  const fetchMock = vi.fn((url: string) => {
    calls.push(url)
    return new Promise((resolve) => {
      release.push(() => resolve({ ok: true, body: null } as unknown as Response))
    })
  })
  vi.stubGlobal("fetch", fetchMock)
  return { calls, release }
}

beforeEach(() => {
  vi.useFakeTimers()
  listClips.mockReset()
  listClips.mockResolvedValue(CLIPS)
})

describe("useMarketNewsPrewarm", () => {
  it("asks for nothing at all in a room that will never play a clip", async () => {
    // Belt to the server gate's braces: a student's room should not even make
    // the request. The server would answer [] anyway, but not asking is the
    // difference between "told nothing" and "never in the conversation".
    const { calls } = deferredFetch()
    render(<Warm enabled={false} />)

    await act(async () => { vi.advanceTimersByTime(MARKET_NEWS_PREWARM_DELAY_MS * 4) })
    expect(listClips).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it("warms nothing for a room that was given no clips", async () => {
    // A student's room gets an empty list, so there is nothing to pull — and
    // no request that would tell them a clip exists.
    listClips.mockResolvedValue([])
    const { calls } = deferredFetch()
    render(<Warm />)

    await act(async () => { vi.advanceTimersByTime(MARKET_NEWS_PREWARM_DELAY_MS * 4) })
    expect(calls).toEqual([])
  })

  it("leaves the room alone until it has finished loading itself", async () => {
    const { calls } = deferredFetch()
    render(<Warm />)

    await act(async () => { await Promise.resolve() })
    expect(listClips).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(MARKET_NEWS_PREWARM_DELAY_MS) })
    expect(listClips).toHaveBeenCalledOnce()
    expect(calls).toHaveLength(1)
  })

  it("pulls the clips one at a time, in the order they fire", async () => {
    // Three at once would fight each other and the room's own traffic; the
    // first event is also the one needed soonest.
    const { calls, release } = deferredFetch()
    render(<Warm />)

    await act(async () => { vi.advanceTimersByTime(MARKET_NEWS_PREWARM_DELAY_MS) })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(CLIPS[0]!.webm)

    await act(async () => { release[0]!(); await Promise.resolve() })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toBe(CLIPS[1]!.webm)

    await act(async () => { release[1]!(); await Promise.resolve() })
    expect(calls[2]).toBe(CLIPS[2]!.webm)
  })

  it("keeps going when one clip fails to warm", async () => {
    // A warm is best-effort: the clip still plays on the day, just later.
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(url)
      return calls.length === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: true, body: null } as unknown as Response)
    }))
    render(<Warm />)

    await act(async () => { vi.advanceTimersByTime(MARKET_NEWS_PREWARM_DELAY_MS); await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    expect(calls.length).toBeGreaterThan(1)
  })

  it("stops pulling when the player leaves the room", async () => {
    const { calls, release } = deferredFetch()
    const view = render(<Warm />)

    await act(async () => { vi.advanceTimersByTime(MARKET_NEWS_PREWARM_DELAY_MS) })
    expect(calls).toHaveLength(1)

    view.unmount()
    await act(async () => { release[0]!(); await Promise.resolve() })
    expect(calls).toHaveLength(1)
  })
})
