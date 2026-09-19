import { describe, expect, it } from "vitest"
import { createArcadeReveal, REVEAL, type RevealFrame } from "./arcade-reveal"

const STEP = 1000 / 60

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** Every frame of the sequence, in order. */
function play(): RevealFrame[] {
  const reveal = createArcadeReveal(seeded(1))
  const frames: RevealFrame[] = []
  for (let t = 0; t < reveal.totalMs + STEP; t += STEP) frames.push(reveal.advance(STEP))
  return frames
}

describe("arcade reveal timeline", () => {
  it("moves the camera in to the cabinet, holds, and moves back to where it started", () => {
    const frames = play()
    expect(frames[0]!.focus).toBeLessThan(0.05)
    const atPanIn = frames[Math.ceil(REVEAL.panInMs / STEP)]!
    expect(atPanIn.focus).toBe(1)
    // The camera stays on the cabinet until the move back.
    const mid = frames[Math.floor((REVEAL.panInMs + REVEAL.dropMs) / STEP)]!
    expect(mid.focus).toBe(1)
    const last = frames[frames.length - 1]!
    expect(last.done).toBe(true)
    expect(last.focus).toBe(0)
    // Monotonic in, monotonic out.
    const inIdx = Math.ceil(REVEAL.panInMs / STEP)
    for (let i = 1; i <= inIdx; i++) expect(frames[i]!.focus).toBeGreaterThanOrEqual(frames[i - 1]!.focus)
  })

  it("shakes the camera briefly on impact and nowhere else", () => {
    const frames = play()
    const landIdx = frames.findIndex((f) => f.landedNow)
    for (const f of frames.slice(0, landIdx)) expect(f.shake).toEqual({ x: 0, z: 0 })
    const shaking = frames.slice(landIdx, landIdx + Math.floor(REVEAL.shakeMs / STEP))
    expect(Math.max(...shaking.map((f) => Math.abs(f.shake.x)))).toBeGreaterThan(0.05)
    for (const f of frames.slice(landIdx + Math.ceil(REVEAL.shakeMs / STEP) + 1)) expect(f.shake).toEqual({ x: 0, z: 0 })
  })

  it("drops the cabinet from height and lands it exactly once, on the floor", () => {
    const frames = play()
    expect(frames[0]!.cabinetY).toBe(REVEAL.dropHeight)
    const landings = frames.filter((f) => f.landedNow)
    expect(landings).toHaveLength(1)
    const landIdx = frames.indexOf(landings[0]!)
    // Falling accelerates: the last third of the drop covers more height than the first.
    const dropStartIdx = Math.ceil((REVEAL.panInMs - REVEAL.dropLeadMs) / STEP)
    const third = Math.floor((landIdx - dropStartIdx) / 3)
    const early = frames[dropStartIdx]!.cabinetY - frames[dropStartIdx + third]!.cabinetY
    const late = frames[landIdx - third]!.cabinetY - frames[landIdx]!.cabinetY
    expect(late).toBeGreaterThan(early)
    for (const f of frames.slice(landIdx)) expect(f.cabinetY).toBe(0)
    for (const f of frames.slice(0, landIdx)) expect(f.landed).toBe(false)
  })

  it("squashes on impact and springs back", () => {
    const frames = play()
    const landIdx = frames.findIndex((f) => f.landedNow)
    const during = frames.slice(landIdx, landIdx + Math.floor(REVEAL.squashMs / STEP))
    expect(Math.min(...during.map((f) => f.squash))).toBeLessThan(0.9)
    expect(frames[landIdx + Math.ceil(REVEAL.squashMs / STEP) + 1]!.squash).toBe(1)
    for (const f of frames.slice(0, landIdx)) expect(f.squash).toBe(1)
  })

  it("raises dust and a ground ring on landing that spread out and fade away", () => {
    const frames = play()
    const landIdx = frames.findIndex((f) => f.landedNow)
    expect(frames[landIdx - 1]!.dust).toHaveLength(0)
    const first = frames[landIdx + 1]!
    const later = frames[landIdx + Math.floor(REVEAL.dustMs / STEP / 2)]!
    const gone = frames[landIdx + Math.ceil(REVEAL.dustMs / STEP) + 1]!
    expect(first.dust).toHaveLength(REVEAL.dustCount)
    const spread = (f: RevealFrame) => Math.max(...f.dust.map((d) => Math.hypot(d.x, d.z)))
    expect(spread(later)).toBeGreaterThan(spread(first))
    expect(Math.max(...later.dust.map((d) => d.alpha))).toBeLessThan(Math.max(...first.dust.map((d) => d.alpha)))
    for (const d of later.dust) expect(d.y).toBeGreaterThan(0)
    expect(later.ring.radius).toBeGreaterThan(first.ring.radius)
    expect(later.ring.opacity).toBeLessThan(first.ring.opacity)
    expect(gone.dust).toHaveLength(0)
    expect(gone.ring.opacity).toBe(0)
  })

  it("reports its total length so the room can freeze input for exactly that long", () => {
    const reveal = createArcadeReveal(seeded(2))
    expect(reveal.totalMs).toBe(REVEAL.panInMs - REVEAL.dropLeadMs + REVEAL.dropMs + REVEAL.holdMs + REVEAL.panBackMs)
    let frame = reveal.advance(reveal.totalMs - 1)
    expect(frame.done).toBe(false)
    frame = reveal.advance(2)
    expect(frame.done).toBe(true)
  })
})
