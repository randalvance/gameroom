import { describe, expect, it } from "vitest"
import { CHARACTERS, type CharacterId } from "./characters"
import { createFight, EMPTY_INPUT, STAGE_WIDTH, stepFight, type FightState } from "./fight-sim"
import { pickSpriteFrame } from "./sprite-frames"

const STEP = 1000 / 60
function ready(id: CharacterId, distance: number, mirrored = false) {
  const state = createFight(id, "bernard")
  state.phase = "fight"
  state.fighters[0].x = mirrored ? 900 : 60
  state.fighters[1].x = state.fighters[0].x + (mirrored ? -distance : distance)
  stepFight(state, [EMPTY_INPUT, EMPTY_INPUT], STEP)
  state.fighters[0].energy = 100
  return state
}
function tick(state: FightState, ms: number, dodge = false) {
  for (let t = 0; t < ms; t += STEP) {
    stepFight(state, [EMPTY_INPUT, { ...EMPTY_INPUT, right: dodge }], STEP)
  }
}
function special(state: FightState) {
  stepFight(state, [{ ...EMPTY_INPUT, sp: true }, EMPTY_INPUT], STEP)
}

describe("redesigned specials", () => {
  it.each([false, true])("Bull rushes three quarters of the stage and launches with his horns (mirrored=%s)", mirrored => {
    const state = ready("bull", STAGE_WIDTH * 0.7, mirrored)
    special(state)
    let launched = false
    for (let t = 0; t < 1200; t += STEP) {
      tick(state, STEP)
      launched ||= state.fighters[1].vy > 300
    }
    expect(launched).toBe(true)
    expect(state.fighters[1].health).toBeLessThan(state.fighters[1].def.maxHealth)
    const miss = ready("bull", 840, mirrored)
    const start = miss.fighters[0].x
    special(miss); tick(miss, 1600)
    expect(Math.abs(miss.fighters[0].x - start)).toBeLessThanOrEqual(STAGE_WIDTH * 0.75 + 1)
    expect(miss.fighters[1].health).toBe(miss.fighters[1].def.maxHealth)
  })

  it("Bear jumps forward and only damages the opponent when the ice slam lands", () => {
    const state = ready("bear", 430)
    special(state); tick(state, 450)
    expect(state.fighters[0].y).toBeGreaterThan(80)
    expect(state.fighters[0].x).toBeGreaterThan(120)
    expect(state.fighters[1].health).toBe(state.fighters[1].def.maxHealth)
    tick(state, 650)
    expect(state.fighters[0].y).toBe(0)
    expect(state.fighters[1].health).toBeLessThan(state.fighters[1].def.maxHealth)
    const miss = ready("bear", 650)
    special(miss); tick(miss, 1800)
    expect(miss.fighters[1].health).toBe(miss.fighters[1].def.maxHealth)
  })

  it.each([false, true])("Quant's circle grows around her and hits once at short range (mirrored=%s)", mirrored => {
    const state = ready("quant", 130, mirrored)
    special(state); tick(state, 260)
    expect(state.fighters[1].health).toBe(state.fighters[1].def.maxHealth)
    tick(state, 1000)
    expect(state.fighters[1].def.maxHealth - state.fighters[1].health).toBe(state.fighters[0].def.moves.special.damage)
    expect(state.projectiles).toHaveLength(0)
    const miss = ready("quant", 500, mirrored)
    special(miss); tick(miss, 1500)
    expect(miss.fighters[1].health).toBe(miss.fighters[1].def.maxHealth)
  })

  it("Whale places a three-second stationary trap", () => {
    const state = ready("whale", 420)
    special(state); tick(state, 600)
    expect(state.orbs).toHaveLength(1)
    expect(state.orbs[0]?.remainingMs).toBeLessThan(3000)
    tick(state, 3200)
    expect(state.orbs).toHaveLength(0)
  })

  it("Primey's chest laser reaches the far edge for only five damage", () => {
    const state = ready("primey", 840)
    special(state); tick(state, 900)
    expect(state.fighters[1].def.maxHealth - state.fighters[1].health).toBe(5)
    expect(state.projectiles).toHaveLength(0)
    expect(state.fighters[0].def.moves.special.hitbox.y).toBeGreaterThan(35)
    expect(state.fighters[0].def.moves.special.hitbox.y).toBeLessThan(85)
  })

  it("interrupting Whale before startup cancels its orb", () => {
    const state = ready("whale", 72)
    special(state)
    state.projectiles.push({ owner: 1, x: state.fighters[0].x, y: 100, vx: 0, w: 100, h: 100,
      ttl: 1000, move: state.fighters[1].def.moves.special })
    tick(state, STEP)
    expect(state.fighters[0].move).toBeNull()
    tick(state, 500)
    expect(state.orbs).toHaveLength(0)
  })
})

describe("down / KO artwork", () => {
  it.each(CHARACTERS.map(c => c.id))("%s lands and stays in a KO pose after a finishing hit", id => {
    const state = createFight("bernard", id)
    state.phase = "fight"
    state.fighters[0].x = 300; state.fighters[1].x = 380
    state.fighters[1].health = 1
    stepFight(state, [{ ...EMPTY_INPUT, hp: true }, EMPTY_INPUT], STEP)
    tick(state, 1500)
    expect(state.fighters[1].state).toBe("ko")
    expect(state.fighters[1].y).toBe(0)
    expect(pickSpriteFrame(state.fighters[1], state.clock)).toMatchObject({ pose: "down", index: 3 })
  })
  it.each(CHARACTERS.map(c => c.id))("%s uses actual down frames on the ground for knockdowns and KOs", id => {
    const f = createFight(id, "bear").fighters[0]
    for (const state of ["knockdown", "ko"] as const) {
      f.state = state; f.y = 0; f.stateMs = 300
      expect(pickSpriteFrame(f, 500)).toMatchObject({ pose: "down", index: 3, lying: false })
      f.y = 80; f.vy = -200
      expect(pickSpriteFrame(f, 500)).toMatchObject({ pose: "down", index: 1 })
    }
  })
})
