import { describe, expect, it } from "vitest"
import { seedWander, stepWander } from "./wander"

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
