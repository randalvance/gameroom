// The spoken half of a typed room announcement.
//
// Only the admin screen driving the venue PA ever speaks. This is the client
// half of that gate; the server fn behind it is admin-only regardless of what
// a client claims to be — the same two-sided rule the filmed clips follow.
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const takeSpeech = vi.fn(async (_args: unknown) => null as { audioBase64: string } | null)
vi.mock("~/server/game-room-control", () => ({
  takeRoomSpeechFn: (args: unknown) => takeSpeech(args),
}))

const { useAnnouncementVoice } = await import("./useAnnouncementVoice")
const { ANNOUNCEMENT_SPEECH_LEAD_MS } = await import("./useMarketNews")

class FakeAudio {
  static instances: FakeAudio[] = []
  volume = 1
  muted = false
  paused = false
  currentTime = 0
  playCalls = 0

  constructor(readonly src: string) {
    FakeAudio.instances.push(this)
  }

  play() {
    this.playCalls++
    return Promise.resolve()
  }

  pause() {
    this.paused = true
  }
}

const BULLETIN = { message: "Lunch at 12:30.", affectedSymbol: "", nonce: 1, speechMs: 8_400 }

function Voice({
  bulletin,
  enabled = true,
  audio = { muted: false, volume: 0.8 },
}: {
  bulletin: typeof BULLETIN | null
  enabled?: boolean
  audio?: { muted: boolean; volume: number }
}) {
  useAnnouncementVoice(bulletin, enabled, audio)
  return null
}

/** Let the fetch resolve, then run out the lead-in so the voice starts. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_SPEECH_LEAD_MS)
  })
}

/** Let the fetch resolve but stop short of the lead-in. */
const settleWithoutLeadIn = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeAudio.instances = []
  takeSpeech.mockReset()
  takeSpeech.mockResolvedValue({ audioBase64: "QUJD" })
  vi.stubGlobal("Audio", FakeAudio)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("on the admin's screen", () => {
  it("collects the audio for the announcement and plays it", async () => {
    render(<Voice bulletin={BULLETIN} />)
    await settle()

    expect(takeSpeech).toHaveBeenCalledWith({ data: { nonce: 1 } })
    const played = FakeAudio.instances[0]!
    expect(played.src).toContain("QUJD")
    expect(played.playCalls).toBe(1)
  })

  it("plays at the volume the room's own sound controls are set to", async () => {
    render(<Voice bulletin={BULLETIN} audio={{ muted: false, volume: 0.5 }} />)
    await settle()
    expect(FakeAudio.instances[0]!.volume).toBe(0.5)
  })

  // Whether the room's PA is ever muted is the ROUTE's decision (it is not —
  // see game-room.tsx). The hook's own contract is simply that it applies the
  // flag it is handed.
  it("applies the muted flag it is handed", async () => {
    render(<Voice bulletin={BULLETIN} audio={{ muted: true, volume: 0.8 }} />)
    await settle()
    expect(FakeAudio.instances[0]!.muted).toBe(true)
  })

  // A second announcement while the first is still talking must not leave two
  // voices over each other on the PA.
  it("stops the previous announcement before starting the next", async () => {
    const view = render(<Voice bulletin={BULLETIN} />)
    await settle()
    takeSpeech.mockResolvedValue({ audioBase64: "WFla" })

    view.rerender(<Voice bulletin={{ ...BULLETIN, nonce: 2 }} />)
    await settle()

    expect(FakeAudio.instances[0]!.paused).toBe(true)
    expect(FakeAudio.instances[1]!.playCalls).toBe(1)
  })

  it("leaves the room silent when there is no audio waiting", async () => {
    takeSpeech.mockResolvedValue(null)
    render(<Voice bulletin={BULLETIN} />)
    await settle()
    expect(FakeAudio.instances).toHaveLength(0)
  })

  // A deployment with no ElevenLabs credentials sends a bulletin with no
  // speechMs. There is nothing to collect, so it must not ask.
  it("does not ask for audio for an unspoken announcement", async () => {
    render(<Voice bulletin={{ ...BULLETIN, speechMs: undefined as unknown as number }} />)
    await settle()
    expect(takeSpeech).not.toHaveBeenCalled()
  })
})

describe("on everyone else's screen", () => {
  it("never asks for the audio at all", async () => {
    render(<Voice bulletin={BULLETIN} enabled={false} />)
    await settle()
    expect(takeSpeech).not.toHaveBeenCalled()
    expect(FakeAudio.instances).toHaveLength(0)
  })
})

describe("the beat before the voice starts", () => {
  // The camera is still swinging to the wall when the bulletin lands, and a
  // voice that began on that same frame talked over the move. The lead-in lets
  // the room finish turning and settle on the message before it is read.
  it("holds the voice back while the room turns to look", async () => {
    render(<Voice bulletin={BULLETIN} />)
    await settleWithoutLeadIn()

    expect(FakeAudio.instances).toHaveLength(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_SPEECH_LEAD_MS)
    })
    expect(FakeAudio.instances[0]!.playCalls).toBe(1)
  })

  // The audio is collected immediately and only its PLAYBACK waits, so the
  // round trip overlaps the lead-in rather than following it.
  it("collects the audio during the wait, not after it", async () => {
    render(<Voice bulletin={BULLETIN} />)
    await settleWithoutLeadIn()
    expect(takeSpeech).toHaveBeenCalled()
  })

  // A second announcement inside the lead-in supersedes the first. Without
  // cancelling the pending start, the room would hear the old message begin
  // after the new one had already replaced it on the wall.
  it("never speaks an announcement that was superseded during the wait", async () => {
    const view = render(<Voice bulletin={BULLETIN} />)
    await settleWithoutLeadIn()

    takeSpeech.mockResolvedValue({ audioBase64: "WFla" })
    view.rerender(<Voice bulletin={{ ...BULLETIN, nonce: 2 }} />)
    await settle()

    const played = FakeAudio.instances.filter((a) => a.playCalls > 0)
    expect(played).toHaveLength(1)
    expect(played[0]!.src).toContain("WFla")
  })

  it("says nothing at all if the room is left during the wait", async () => {
    const view = render(<Voice bulletin={BULLETIN} />)
    await settleWithoutLeadIn()

    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_SPEECH_LEAD_MS)
    })

    expect(FakeAudio.instances.filter((a) => a.playCalls > 0)).toHaveLength(0)
  })
})
