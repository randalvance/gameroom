import { describe, expect, it } from "vitest"
import { PARTICIPANT_TABLES } from "../../components/gameRoom/constants"
import { walkPos } from "../../components/gameRoom3d/walk-path"
import { phaseForPos, seedWander, stepWander, wanderPos } from "./wander"

describe("seedWander + stepWander", () => {
  it("is deterministic: same seed, same steps, same state", () => {
    const a = seedWander(4, 2, 1)
    const b = seedWander(4, 2, 1)
    for (let i = 0; i < 5_000; i++) {
      stepWander(a)
      stepWander(b)
    }
    expect(a).toEqual(b)
  })

  it("different players diverge", () => {
    const a = seedWander(0, 0, 0)
    const b = seedWander(1, 0, 1)
    for (let i = 0; i < 600; i++) {
      stepWander(a)
      stepWander(b)
    }
    expect(a.phase).not.toBe(b.phase)
  })

  it("advances phase while unpaused and burns pauses one step at a time", () => {
    const w = { phase: 0, speed: 0.5, pauseLeft: 2, rng: 12345 }
    stepWander(w)
    expect(w).toMatchObject({ phase: 0, pauseLeft: 1 })
    stepWander(w)
    expect(w).toMatchObject({ phase: 0, pauseLeft: 0 })
    stepWander(w)
    expect(w.phase).toBe(0.5)
  })
})

describe("wanderPos", () => {
  it("walks the team's table orbit", () => {
    const w = seedWander(3, 2, 0)
    const pos = wanderPos(w, 2)!
    const expected = walkPos(w.phase, PARTICIPANT_TABLES[2]!, w.speed)
    expect(pos).toEqual(expected)
  })

  it("returns null for a table index that does not exist", () => {
    expect(wanderPos(seedWander(0, 0, 0), 99)).toBeNull()
  })
})

describe("phaseForPos", () => {
  it("round-trips a point already on the orbit", () => {
    const tbl = PARTICIPANT_TABLES[3]!
    for (const p of [0, 30, 77, 150, 260]) {
      const pos = walkPos(p, tbl)
      const back = walkPos(phaseForPos(pos.x, pos.y, 3), tbl)
      expect(back.x).toBeCloseTo(pos.x, 5)
      expect(back.y).toBeCloseTo(pos.y, 5)
    }
  })

  it("maps an off-orbit point to the nearest orbit point", () => {
    const tbl = PARTICIPANT_TABLES[0]!
    // Well below the table, roughly mid-width: nearest orbit point is on the
    // bottom edge at the same x.
    const x = tbl.x + tbl.w / 2
    const y = tbl.y + tbl.h + 80
    const pos = walkPos(phaseForPos(x, y, 0), tbl)
    expect(pos.y).toBeCloseTo(tbl.y + tbl.h + 18, 5)
    expect(pos.x).toBeCloseTo(x, 5)
  })
})
