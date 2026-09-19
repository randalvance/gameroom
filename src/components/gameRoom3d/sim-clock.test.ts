import { describe, expect, it } from "vitest"
import { advanceSimClock, MAX_STEPS_PER_FRAME, SIM_HZ, SIM_STEP_MS } from "./sim-clock"

/** Run a display at `hz` for a second and count the simulation steps it yields. */
function stepsInOneSecond(hz: number): number {
  const frameMs = 1000 / hz
  let carryMs = 0
  let steps = 0
  for (let i = 0; i < hz; i++) {
    const advance = advanceSimClock(carryMs, frameMs)
    carryMs = advance.carryMs
    steps += advance.steps
  }
  return steps
}

/**
 * A second of frames is worth a second of simulation. The slack is one step —
 * floating-point accumulation can leave the last one of a second pending, which
 * is 1/60 s and invisible; a broken clock is out by a whole multiple, not a step.
 */
function expectOneSecondOfMotion(hz: number): void {
  const steps = stepsInOneSecond(hz)
  expect(steps).toBeLessThanOrEqual(SIM_HZ)
  expect(steps).toBeGreaterThanOrEqual(SIM_HZ - 1)
}

describe("sim clock", () => {
  it("runs at the same speed on 60, 120 and 144 Hz displays", () => {
    // The bug this replaced: motion counted rAF ticks, so a 120 Hz screen
    // walked the whole room at double speed — 120 steps a second, not 60.
    expectOneSecondOfMotion(60)
    expectOneSecondOfMotion(120)
    expectOneSecondOfMotion(144)
  })

  it("carries the remainder so a rate that divides unevenly does not drift slow", () => {
    // 90 Hz frames are 11.1ms — two thirds of a step, so dropping the remainder
    // instead of banking it would lose every frame's worth of motion.
    expectOneSecondOfMotion(90)
    expectOneSecondOfMotion(75)
  })

  it("advances nothing until a whole step is due", () => {
    const advance = advanceSimClock(0, SIM_STEP_MS / 2)
    expect(advance.steps).toBe(0)
    expect(advance.carryMs).toBeCloseTo(SIM_STEP_MS / 2)
  })

  it("resumes rather than teleports after a backgrounded tab", () => {
    const advance = advanceSimClock(0, 30_000)
    expect(advance.steps).toBe(MAX_STEPS_PER_FRAME)
    // The skipped time is dropped, not banked into the next frames.
    expect(advance.carryMs).toBe(0)
  })

  it("ignores a clock that goes backwards", () => {
    const advance = advanceSimClock(0, -5)
    expect(advance.steps).toBe(0)
    expect(advance.carryMs).toBe(0)
  })
})
