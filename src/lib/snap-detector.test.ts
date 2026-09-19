import { describe, expect, it } from "vitest"
import { SNAP, createSnapDetector, rmsOf } from "./snap-detector"

/** Feed one level for a stretch of frames; returns whether any frame fired. */
function feed(detector: ReturnType<typeof createSnapDetector>, level: number, frames: number, from: number, stepMs = 16) {
  let fired = false
  let t = from
  for (let i = 0; i < frames; i++) {
    t += stepMs
    if (detector.push(level, t)) fired = true
  }
  return { fired, t }
}

describe("snap detector", () => {
  it("fires on a sharp transient over a quiet floor", () => {
    const d = createSnapDetector()
    const quiet = feed(d, 0.01, 60, 0)
    expect(quiet.fired).toBe(false)
    expect(d.push(0.5, quiet.t + 16)).toBe(true)
  })

  it("stays quiet while the mic is still settling", () => {
    const d = createSnapDetector()
    // A pop on the very first frames is the stream switching on, not a snap.
    expect(d.push(0.6, 10)).toBe(false)
    expect(d.push(0.6, 40)).toBe(false)
  })

  it("does not fire on a level that rises gradually, like speech", () => {
    const d = createSnapDetector()
    let { t } = feed(d, 0.01, 60, 0)
    let fired = false
    for (let level = 0.02; level < 0.6; level += 0.02) {
      t += 16
      if (d.push(level, t)) fired = true
    }
    expect(fired).toBe(false)
  })

  it("does not fire on a small bump in a noisy room", () => {
    const d = createSnapDetector()
    const noisy = feed(d, 0.2, 120, 0)
    expect(noisy.fired).toBe(false)
    expect(d.push(0.4, noisy.t + 16)).toBe(false)
  })

  it("ignores a second transient inside the cooldown, then hears the next", () => {
    const d = createSnapDetector()
    const { t } = feed(d, 0.01, 60, 0)
    expect(d.push(0.5, t + 16)).toBe(true)
    const after = feed(d, 0.01, 10, t + 16)
    expect(d.push(0.5, after.t + 16)).toBe(false)
    const later = feed(d, 0.01, 10, after.t + SNAP.cooldownMs)
    expect(d.push(0.5, later.t + 16)).toBe(true)
  })

  it("needs the level to clear the absolute floor even in silence", () => {
    const d = createSnapDetector()
    const { t } = feed(d, 0.001, 60, 0)
    expect(d.push(SNAP.minLevel * 0.9, t + 16)).toBe(false)
  })
})

describe("rmsOf", () => {
  it("measures a byte-encoded time-domain buffer around its 128 centre", () => {
    expect(rmsOf(new Uint8Array([128, 128, 128, 128]))).toBe(0)
    expect(rmsOf(new Uint8Array([0, 255, 0, 255]))).toBeCloseTo(1, 1)
    expect(rmsOf(new Uint8Array([]))).toBe(0)
  })
})
