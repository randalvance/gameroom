import { describe, expect, it } from "vitest"
import {
  pickNearestToPoint,
  pinchZoom,
  TOUCH_INTERACT_MAX_DIST,
  TOUCH_PAN_REPEAT_MS,
  TOUCH_PINCH_MAX_ZOOM,
  TOUCH_PINCH_MIN_ZOOM,
  type TouchPickTargets,
} from "./touch-controls"

const TARGETS: TouchPickTargets = {
  chars: [
    { playerIdx: 0, x: 0, z: 0 },
    { playerIdx: 1, x: 10, z: 0 },
  ],
  tables: [
    { teamIdx: 0, x: 4, z: 0 },
    { teamIdx: 1, x: 20, z: 0 },
  ],
}

describe("touch interact pick", () => {
  it("selects the nearest character when one is within reach", () => {
    expect(pickNearestToPoint({ x: 1, z: 0 }, TARGETS)).toEqual({ type: "player", idx: 0 })
    expect(pickNearestToPoint({ x: 9, z: 1 }, TARGETS)).toEqual({ type: "player", idx: 1 })
  })

  it("selects the table when it is closer than any character", () => {
    expect(pickNearestToPoint({ x: 4.5, z: 0 }, TARGETS)).toEqual({ type: "team", idx: 0 })
  })

  it("prefers the character on an exact tie, since they are the smaller target", () => {
    // Midway between char 1 (x=10) and table 1 (x=20).
    expect(pickNearestToPoint({ x: 15, z: 0 }, TARGETS)).toEqual({ type: "player", idx: 1 })
  })

  it("selects nothing when everything is out of reach", () => {
    expect(
      pickNearestToPoint({ x: 0, z: TOUCH_INTERACT_MAX_DIST + 1 }, { chars: [{ playerIdx: 0, x: 0, z: 0 }], tables: [] }),
    ).toBeNull()
    expect(pickNearestToPoint({ x: 0, z: 0 }, { chars: [], tables: [] })).toBeNull()
  })

  it("measures reach as straight-line distance, not per-axis", () => {
    const diagonal = TOUCH_INTERACT_MAX_DIST / Math.SQRT2 + 0.1
    expect(
      pickNearestToPoint({ x: diagonal, z: diagonal }, { chars: [{ playerIdx: 0, x: 0, z: 0 }], tables: [] }),
    ).toBeNull()
  })

  it("scales zoom by how far the fingers spread from where they started", () => {
    expect(pinchZoom(1, 100, 200)).toBe(2)
    expect(pinchZoom(2, 100, 75)).toBe(1.5)
    // Re-derived from the gesture origin: the same spread always lands the
    // same zoom, however many moves happened in between.
    expect(pinchZoom(1.2, 100, 100)).toBe(1.2)
  })

  it("clamps a pinch to the same fit/max bounds as the wheel", () => {
    expect(pinchZoom(1, 100, 1000)).toBe(TOUCH_PINCH_MAX_ZOOM)
    expect(pinchZoom(2, 100, 10)).toBe(TOUCH_PINCH_MIN_ZOOM)
  })

  it("ignores a degenerate spread instead of dividing by it", () => {
    expect(pinchZoom(1.4, 0, 120)).toBe(1.4)
    expect(pinchZoom(1.4, 120, 0)).toBe(1.4)
    // ...and still clamps a starting zoom that was out of bounds.
    expect(pinchZoom(99, 0, 120)).toBe(TOUCH_PINCH_MAX_ZOOM)
  })

  it("repeats held pan presses fast enough to feel continuous", () => {
    // A held arrow should cross the room (2×MAX_PAN at 3 units/step) within a
    // few seconds; anything slower feels broken on a phone.
    expect(TOUCH_PAN_REPEAT_MS).toBeGreaterThanOrEqual(60)
    expect(TOUCH_PAN_REPEAT_MS).toBeLessThanOrEqual(250)
  })
})
