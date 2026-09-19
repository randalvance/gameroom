import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SNAP } from "~/lib/snap-detector"
import { useSnapMic } from "./useSnapMic"

class FakeTrack {
  stopped = false
  stop() { this.stopped = true }
}
class FakeStream {
  tracks = [new FakeTrack()]
  getTracks() { return this.tracks }
}
/** What the analyser reports: a byte level around 128, set by the test. */
let level = 128
class FakeAnalyser {
  fftSize = 2048
  getByteTimeDomainData(out: Uint8Array) { out.fill(level) }
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  closed = false
  constructor() { FakeAudioContext.instances.push(this) }
  createAnalyser() { return new FakeAnalyser() }
  createMediaStreamSource() { return { connect: () => {} } }
  close() { this.closed = true; return Promise.resolve() }
}

const streams: FakeStream[] = []
let deny = false
const getUserMedia = vi.fn(async () => {
  if (deny) throw new DOMException("no", "NotAllowedError")
  const s = new FakeStream()
  streams.push(s)
  return s as unknown as MediaStream
})

/** rAF callbacks, pumped by hand. */
let frames: FrameRequestCallback[] = []
let now = 0

function Probe({ enabled, onSnap }: { enabled: boolean; onSnap: () => void }) {
  const { listening } = useSnapMic({ enabled, onSnap })
  return <div data-testid="state">{listening ? "listening" : "idle"}</div>
}

const key = (type: "keydown" | "keyup", init: KeyboardEventInit) => {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(e)
  return e
}
const pressChord = () => key("keydown", { code: "Space", key: " ", shiftKey: true })
const releaseSpace = () => key("keyup", { code: "Space", key: " ", shiftKey: true })
const releaseShift = () => key("keyup", { code: "ShiftLeft", key: "Shift" })

const pump = async (ms = 16) => {
  now += ms
  const due = frames
  frames = []
  for (const cb of due) cb(now)
  await act(async () => {})
}

beforeEach(() => {
  streams.length = 0
  FakeAudioContext.instances.length = 0
  frames = []
  now = 0
  level = 128
  deny = false
  getUserMedia.mockClear()
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } })
  vi.stubGlobal("AudioContext", FakeAudioContext)
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal("cancelAnimationFrame", () => { frames = [] })
  vi.spyOn(performance, "now").mockImplementation(() => now)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useSnapMic", () => {
  it("opens the mic only while Shift+Space is held, and stops the tracks on release", async () => {
    const onSnap = vi.fn()
    const { getByTestId } = render(<Probe enabled onSnap={onSnap} />)
    expect(getByTestId("state").textContent).toBe("idle")

    const down = pressChord()
    expect(down.defaultPrevented).toBe(true)
    await act(async () => {})
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getByTestId("state").textContent).toBe("listening")

    releaseSpace()
    await act(async () => {})
    expect(getByTestId("state").textContent).toBe("idle")
    expect(streams[0]!.tracks[0]!.stopped).toBe(true)
    expect(FakeAudioContext.instances[0]!.closed).toBe(true)
  })

  it("letting go of Shift breaks the chord too", async () => {
    const { getByTestId } = render(<Probe enabled onSnap={() => {}} />)
    pressChord()
    await act(async () => {})
    expect(getByTestId("state").textContent).toBe("listening")
    releaseShift()
    await act(async () => {})
    expect(getByTestId("state").textContent).toBe("idle")
  })

  it("ignores plain Space, Space while typing, and key repeat", async () => {
    render(<Probe enabled onSnap={() => {}} />)
    const plain = key("keydown", { code: "Space", key: " " })
    expect(plain.defaultPrevented).toBe(false)
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "Space", key: " ", shiftKey: true }))
    await act(async () => {})
    expect(getUserMedia).not.toHaveBeenCalled()
    pressChord()
    pressChord()
    await act(async () => {})
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it("calls onSnap when a transient lands in the stream, once per snap", async () => {
    const onSnap = vi.fn()
    render(<Probe enabled onSnap={onSnap} />)
    pressChord()
    await act(async () => {})
    // Past the warm-up, on a quiet floor.
    for (let i = 0; i < 30; i++) await pump()
    expect(onSnap).not.toHaveBeenCalled()
    level = 250
    await pump()
    expect(onSnap).toHaveBeenCalledTimes(1)
    level = 128
    await pump()
    level = 250
    await pump()
    expect(onSnap).toHaveBeenCalledTimes(1)
    level = 128
    await pump(SNAP.cooldownMs)
    level = 250
    await pump()
    expect(onSnap).toHaveBeenCalledTimes(2)
  })

  it("stops a stream whose permission arrived after the chord was released", async () => {
    let resolve!: (s: MediaStream) => void
    getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => { resolve = r }))
    const { getByTestId } = render(<Probe enabled onSnap={() => {}} />)
    pressChord()
    await act(async () => {})
    releaseSpace()
    const late = new FakeStream()
    await act(async () => { resolve(late as unknown as MediaStream) })
    expect(late.tracks[0]!.stopped).toBe(true)
    expect(getByTestId("state").textContent).toBe("idle")
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it("stays idle when permission is denied", async () => {
    deny = true
    const { getByTestId } = render(<Probe enabled onSnap={() => {}} />)
    pressChord()
    await act(async () => {})
    expect(getByTestId("state").textContent).toBe("idle")
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it("closes the mic when disabled mid-hold or on window blur", async () => {
    const { getByTestId, rerender } = render(<Probe enabled onSnap={() => {}} />)
    pressChord()
    await act(async () => {})
    expect(getByTestId("state").textContent).toBe("listening")
    rerender(<Probe enabled={false} onSnap={() => {}} />)
    expect(getByTestId("state").textContent).toBe("idle")
    expect(streams[0]!.tracks[0]!.stopped).toBe(true)

    rerender(<Probe enabled onSnap={() => {}} />)
    pressChord()
    await act(async () => {})
    expect(getByTestId("state").textContent).toBe("listening")
    await act(async () => { window.dispatchEvent(new Event("blur")) })
    expect(getByTestId("state").textContent).toBe("idle")
    expect(streams[1]!.tracks[0]!.stopped).toBe(true)
  })
})
