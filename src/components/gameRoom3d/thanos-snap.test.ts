import { describe, expect, it } from "vitest"
import { DISSOLVE, chooseSnapped, createSnapDissolve, type SnapTarget } from "./thanos-snap"

const STEP = 1000 / 60

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function targets(n: number): SnapTarget[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, x: i * 2, y: 1, z: 0, w: 1.2, h: 1.8 }))
}

describe("chooseSnapped", () => {
  it("takes exactly half, rounded down, and never the same one twice", () => {
    for (const n of [0, 1, 2, 3, 7, 10]) {
      const picked = chooseSnapped(Array.from({ length: n }, (_, i) => i), seeded(n))
      expect(picked).toHaveLength(Math.floor(n / 2))
      expect(new Set(picked).size).toBe(picked.length)
      for (const id of picked) expect(id).toBeLessThan(n)
    }
  })

  it("is random: two rolls do not pick the same half", () => {
    const ids = Array.from({ length: 20 }, (_, i) => i)
    const a = chooseSnapped(ids, seeded(1)).sort((x, y) => x - y)
    const b = chooseSnapped(ids, seeded(2)).sort((x, y) => x - y)
    expect(a).not.toEqual(b)
  })
})

describe("snap dissolve timeline", () => {
  it("fades each character out and finishes once everyone is gone", () => {
    const dissolve = createSnapDissolve(targets(3), seeded(1))
    const first = dissolve.advance(STEP)
    expect(first.done).toBe(false)
    expect(first.chars[0]!.alpha).toBeGreaterThan(0.9)
    let last = first
    for (let t = STEP; t < dissolve.totalMs + STEP; t += STEP) last = dissolve.advance(STEP)
    expect(last.done).toBe(true)
    for (const c of last.chars) {
      expect(c.alpha).toBe(0)
      expect(c.gone).toBe(true)
    }
  })

  it("staggers the characters so they do not all vanish together", () => {
    const dissolve = createSnapDissolve(targets(3), seeded(1))
    let frame = dissolve.advance(0)
    for (let t = 0; t < DISSOLVE.staggerMs * 1.5; t += STEP) frame = dissolve.advance(STEP)
    expect(frame.chars[0]!.alpha).toBeLessThan(frame.chars[2]!.alpha)
  })

  it("lifts a fading character off the floor", () => {
    const dissolve = createSnapDissolve(targets(1), seeded(1))
    let frame = dissolve.advance(0)
    for (let t = 0; t < DISSOLVE.charMs * 0.6; t += STEP) frame = dissolve.advance(STEP)
    expect(frame.chars[0]!.lift).toBeGreaterThan(0)
    expect(frame.chars[0]!.alpha).toBeLessThan(1)
    expect(frame.chars[0]!.gone).toBe(false)
  })

  it("blows dust off each character that rises, then fades away", () => {
    const dissolve = createSnapDissolve(targets(2), seeded(3))
    let frame = dissolve.advance(0)
    for (let t = 0; t < DISSOLVE.charMs * 0.5; t += STEP) frame = dissolve.advance(STEP)
    expect(frame.dust.length).toBeGreaterThan(0)
    expect(frame.dust.length).toBeLessThanOrEqual(dissolve.dustCapacity)
    const heights = frame.dust.map((d) => d.y)
    expect(Math.max(...heights)).toBeGreaterThan(1)
    for (const d of frame.dust) {
      expect(d.alpha).toBeGreaterThan(0)
      expect(d.alpha).toBeLessThanOrEqual(1)
    }
    for (let t = 0; t < dissolve.totalMs; t += STEP) frame = dissolve.advance(STEP)
    expect(frame.dust).toHaveLength(0)
  })

  it("is over immediately with nobody to snap", () => {
    const dissolve = createSnapDissolve([], seeded(1))
    expect(dissolve.advance(STEP).done).toBe(true)
  })
})
