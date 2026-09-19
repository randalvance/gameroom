import { describe, expect, it } from "vitest"
import type { WalkDir } from "../gameRoom/spriteIndex"
import { opposite, WALK_PAD, walkPos, type WalkStep } from "./walk-path"

const TABLE = { x: 100, y: 60, w: 96, h: 64 }
const PERIMETER = 2 * (TABLE.w + 2 * WALK_PAD + (TABLE.h + 2 * WALK_PAD))

/** Which way a character actually moved, read off two consecutive positions. */
function facingFromMovement(a: WalkStep, b: WalkStep): WalkDir {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 1 : 3
  return dy > 0 ? 2 : 0
}

/**
 * Which side of the loop a phase falls on. Two samples on different sides
 * straddle a corner, where the character is mid-turn and either facing is
 * defensible — so the facing check skips them.
 */
function edgeOf(phase: number): number {
  const dw = TABLE.w + 2 * WALK_PAD
  const dh = TABLE.h + 2 * WALK_PAD
  const p = ((phase % PERIMETER) + PERIMETER) % PERIMETER
  if (p < dw) return 0
  if (p < dw + dh) return 1
  if (p < 2 * dw + dh) return 2
  return 3
}

describe("walk path", () => {
  it("faces the way it is travelling, the whole way round, in both directions", () => {
    // The moonwalk: facing came from which EDGE the character stood on, which
    // is only the direction of travel when walking the loop forwards.
    for (const travel of [1, -1]) {
      let checked = 0
      for (let phase = 0; phase < PERIMETER; phase += 1) {
        const nextPhase = phase + 0.5 * travel
        if (edgeOf(phase) !== edgeOf(nextPhase)) continue
        const here = walkPos(phase, TABLE, travel)
        const next = walkPos(nextPhase, TABLE, travel)
        expect(here.dir).toBe(facingFromMovement(here, next))
        checked++
      }
      expect(checked).toBeGreaterThan(PERIMETER - 8)
    }
  })

  it("walks an anticlockwise lap facing exactly opposite a clockwise one", () => {
    for (let phase = 0; phase < PERIMETER; phase += 7) {
      const forward = walkPos(phase, TABLE, 1)
      const backward = walkPos(phase, TABLE, -1)
      expect(backward.dir).toBe(opposite(forward.dir))
      // Same loop, same spot — only the facing differs.
      expect(backward.x).toBe(forward.x)
      expect(backward.y).toBe(forward.y)
    }
  })

  it("defaults to walking forwards", () => {
    expect(walkPos(5, TABLE)).toEqual(walkPos(5, TABLE, 1))
  })

  it("keeps the loop clear of the table by the orbit padding", () => {
    for (let phase = 0; phase < PERIMETER; phase += 3) {
      const { x, y } = walkPos(phase, TABLE)
      const outsideX = x <= TABLE.x - WALK_PAD || x >= TABLE.x + TABLE.w + WALK_PAD
      const outsideY = y <= TABLE.y - WALK_PAD || y >= TABLE.y + TABLE.h + WALK_PAD
      expect(outsideX || outsideY).toBe(true)
    }
  })

  it("wraps a phase that has run past the loop, or gone negative", () => {
    expect(walkPos(PERIMETER + 12, TABLE)).toEqual(walkPos(12, TABLE))
    expect(walkPos(-12, TABLE)).toEqual(walkPos(PERIMETER - 12, TABLE))
  })
})
