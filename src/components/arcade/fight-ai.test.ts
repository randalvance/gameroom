import { describe, expect, it } from "vitest"
import { createCpu, DECIDE_MS } from "./fight-ai"
import { createFight, EMPTY_INPUT, INTRO_MS, stepFight, type FightInput } from "./fight-sim"

const STEP = 1000 / 60

/** A tiny seeded generator so a run is repeatable. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe("cpu opponent", () => {
  it("uses Primey's normals up close and saves the low-damage beam for range", () => {
    const state = createFight("primey", "quant")
    state.phase = "fight"
    state.fighters[0].energy = 100
    state.fighters[0].x = 400; state.fighters[1].x = 480
    const action = createCpu(0, () => 0.55).next(state, STEP)
    expect(action.sp).toBe(false)
    expect(action.hp).toBe(true)
    state.fighters[1].x = 800
    expect(createCpu(0, () => 0.1).next(state, STEP).sp).toBe(true)
  })

  it("stays still through the intro, then closes the distance from far away", () => {
    const state = createFight("bull", "bear")
    const cpu = createCpu(1, () => 0.5)
    for (let t = 0; t < INTRO_MS - STEP; t += STEP) {
      expect(cpu.next(state, STEP)).toEqual(EMPTY_INPUT)
      stepFight(state, [EMPTY_INPUT, EMPTY_INPUT], STEP)
    }
    const start = state.fighters[1].x
    for (let t = 0; t < 1500; t += STEP) stepFight(state, [EMPTY_INPUT, cpu.next(state, STEP)], STEP)
    expect(state.fighters[1].x).toBeLessThan(start - 50)
  })

  it("holds a decision between ticks and only fires buttons on the tick", () => {
    const state = createFight("primey", "primey")
    state.phase = "fight"
    state.fighters[1].energy = 100
    // roll 0.1 at long range: a laser fighter fires.
    const cpu = createCpu(1, () => 0.1)
    const first = cpu.next(state, STEP)
    expect(first.sp).toBe(true)
    let pressed = 0
    for (let t = STEP; t < DECIDE_MS - STEP; t += STEP) {
      const input: FightInput = cpu.next(state, STEP)
      if (input.sp) pressed += 1
    }
    expect(pressed).toBe(0)
  })

  it("blocks by holding away while the opponent swings in range", () => {
    const state = createFight("bull", "bear")
    state.phase = "fight"
    const [bull, bear] = state.fighters
    bull.x = 400
    bear.x = 480
    bull.facing = 1
    bear.facing = -1
    bull.state = "attack"
    bull.move = bull.def.moves.hp
    bull.moveMs = 0
    const cpu = createCpu(1, () => 0.5)
    const input = cpu.next(state, STEP)
    expect(input.right).toBe(true)
    expect(input.left).toBe(false)
  })

  it("casts Bernard's affordable rain at a distant target", () => {
    const state = createFight("bear", "bernard")
    state.phase = "fight"
    state.fighters[1].energy = 375
    const cpu = createCpu(1, () => 0.1)
    const action = cpu.next(state, STEP)
    expect(action.up).toBe(true)
    expect(action.sp).toBe(true)
  })

  it("uses Quant's funded circle within its 400px reach", () => {
    const state = createFight("bear", "quant")
    state.phase = "fight"
    state.fighters[0].x = 300; state.fighters[1].x = 680
    state.fighters[1].energy = 45
    const cpu = createCpu(1, () => 0.1)
    expect(cpu.next(state, STEP).sp).toBe(true)
  })

  it("plays a whole match against an idle opponent and wins it", () => {
    const state = createFight("bear", "quant")
    const cpu = createCpu(1, seeded(7))
    for (let t = 0; t < 120_000 && state.phase !== "matchover"; t += STEP) {
      stepFight(state, [EMPTY_INPUT, cpu.next(state, STEP)], STEP)
    }
    expect(state.phase).toBe("matchover")
    expect(state.matchWinner).toBe(1)
  })

  it("backs away from enemy orbs and does not issue input while trapped", () => {
    const state = createFight("whale", "bull"); state.phase = "fight"
    state.fighters[1].x = 550
    state.orbs = [{owner:0,x:380,y:110,radius:90,remainingMs:2500,captured:null}]
    const cpu = createCpu(1, () => 0.4)
    expect(cpu.next(state, STEP).right).toBe(true)
    state.fighters[1].state = "trapped"
    expect(cpu.next(state, STEP)).toEqual(EMPTY_INPUT)
  })

  it("casts Whale's orb within placement range, but respects its three-orb cap", () => {
    const state = createFight("bull", "whale"); state.phase = "fight"
    state.fighters[0].x = 400; state.fighters[1].x = 650; state.fighters[1].energy = 100
    expect(createCpu(1, () => 0.1).next(state, STEP).sp).toBe(true)
    state.orbs = [500,600,700].map(x=>({owner:1,x,y:110,radius:90,remainingMs:2500,captured:null}))
    expect(createCpu(1, () => 0.1).next(state, STEP).sp).toBe(false)
  })
})


describe("Bernard low-health CPU ultimate", () => {
  it.each([50, 37])("casts once at %s HP, and resets the allowance next round", health => {
    const state = createFight("bull", "bernard"); state.phase = "fight"
    const f = state.fighters[1], cpu = createCpu(1, () => 0.99)
    f.health = 51
    expect(cpu.next(state, 200).specialId).not.toBe("bernard-breaking-news")
    f.health = health; f.state = "hitstun"; f.stunMs = 500
    expect(cpu.next(state, 200).specialId).not.toBe("bernard-breaking-news")
    f.state = "idle"
    const action = cpu.next(state, 200)
    expect(action.specialId).toBe("bernard-breaking-news")
    // A hitstop frame must not consume the once-per-round allowance.
    state.hitstop = 100; stepFight(state, [EMPTY_INPUT, action], 10)
    expect(cpu.next(state, 200).specialId).toBe("bernard-breaking-news")
    state.hitstop = 0; stepFight(state, [EMPTY_INPUT, action], 10)
    cpu.next(state, 10)
    f.move = null; f.special = null; f.state = "idle"; f.y = 0; f.energy = 500
    expect(cpu.next(state, 200).specialId).not.toBe("bernard-breaking-news")
    state.round++; f.health = 50
    expect(cpu.next(state, 200).specialId).toBe("bernard-breaking-news")
  })
  it("reserves the three bars needed for the low-health attack", () => {
    const state = createFight("bull", "bernard"); state.phase = "fight"
    state.fighters[1].energy = 300
    for(let i=0;i<100;i++) expect(createCpu(1, () => i/100).next(state, 200).sp).toBe(false)
  })
})


it("does not accidentally cast Breaking News from a previous crouch before laser rain", () => {
  const state = createFight("bull", "bernard"); state.phase = "fight"
  const f = state.fighters[1]
  f.motion = [{dir:"down",at:state.clock}]
  const action = createCpu(1, () => 0.1).next(state, 200)
  stepFight(state, [EMPTY_INPUT, action], 10)
  expect(f.move?.id).toBe("bernard-special-up")
})

it("does not automatically cast Breaking News for a human at low health", () => {
  const state = createFight("bernard", "bull"); state.phase = "fight"
  state.fighters[0].health = 40
  for(let t=0;t<500;t+=10) stepFight(state, [EMPTY_INPUT,EMPTY_INPUT], 10)
  expect(state.fighters[0].move).toBeNull()
  expect(state.fighters[0].energy).toBe(500)
})
