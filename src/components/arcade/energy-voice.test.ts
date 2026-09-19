import { describe, expect, it } from "vitest"
import { CHARACTERS } from "./characters"
import { AUDIO } from "./audio-atlas.generated"
import { cuesForEvent } from "./audio-cues"
import { createFight, EMPTY_INPUT, stepFight, type FightInput } from "./fight-sim"

const STEP = 1000 / 60
const input = (over: Partial<FightInput> = {}): FightInput => ({ ...EMPTY_INPUT, ...over })
const ctx = { mode: "cpu" as const, takes: () => 1, random: () => 0 }

describe("out-of-energy dialogue", () => {
  it.each(CHARACTERS)("voices $id when a special costs more than the remaining energy", def => {
    const state = createFight("bull", def.id)
    state.phase = "fight"
    state.fighters[1].energy = def.moves.special.energyCost! - 1
    stepFight(state, [EMPTY_INPUT, input({ sp: true })], STEP)
    expect(state.fighters[1].move).toBeNull()
    expect(state.events).toContainEqual({ type: "outOfEnergy", player: 1 })
    expect(state.events.flatMap(event => cuesForEvent(event, state, ctx)))
      .toEqual([{ kind: "voice", fighter: def.id, line: "outOfEnergy", take: 0 }])
    expect(AUDIO.voices[def.id]).toHaveProperty("outOfEnergy", [`/assets/arcade/audio/voice/${def.id}/outOfEnergy_1-${def.id === "bernard" ? "v3" : "v2"}.mp3`])
  })

  it("limits repeated failed casts independently for each fighter and resets the warning next round", () => {
    const state = createFight("bull", "bear")
    state.phase = "fight"
    state.fighters.forEach(f => { f.energy = 0 })
    const special = input({ sp: true })
    stepFight(state, [special, EMPTY_INPUT], STEP)
    expect(state.events.filter(e => e.type === "outOfEnergy")).toHaveLength(1)
    stepFight(state, [special, special], STEP)
    expect(state.events.filter(e => e.type === "outOfEnergy")).toEqual([{ type: "outOfEnergy", player: 1 }])
    for (let i = 0; i < 170; i++) {
      stepFight(state, [special, special], STEP)
      expect(state.events.some(e => e.type === "outOfEnergy")).toBe(false)
    }
    for (let i = 0; i < 20; i++) stepFight(state, [EMPTY_INPUT, EMPTY_INPUT], STEP)
    stepFight(state, [special, EMPTY_INPUT], STEP)
    expect(state.events).toContainEqual({ type: "outOfEnergy", player: 0 })
    state.timerMs = 1
    for (let i = 0; i < 140; i++) stepFight(state, [EMPTY_INPUT, EMPTY_INPUT], STEP)
    expect(state.round).toBe(2)
    state.phase = "fight"
    state.fighters[0].energy = 0
    stepFight(state, [special, EMPTY_INPUT], STEP)
    expect(state.events).toContainEqual({ type: "outOfEnergy", player: 0 })
  })

  it.each([false, true])("uses the rain cost for Bernard's Up+Special (jump cancel: %s)", jumpFirst => {
    const state = createFight("bernard", "bull")
    state.phase = "fight"
    state.fighters[0].energy = 50 // Enough for eye laser, insufficient for rain.
    if (jumpFirst) stepFight(state, [input({ up: true }), EMPTY_INPUT], STEP)
    stepFight(state, [input({ up: true, sp: true }), EMPTY_INPUT], STEP)
    expect(state.events).toContainEqual({ type: "outOfEnergy", player: 0 })
    expect(state.fighters[0].move).toBeNull()
    expect(state.fighters[0].energy).toBe(50)
    expect(state.fighters[0].state).toBe("jump")
  })

  it("also voices quarter-circle special attempts", () => {
    const state = createFight("bull", "bear")
    state.phase = "fight"; state.fighters[0].energy = 0
    for (const buttons of [{ down: true }, { right: true }, { lp: true }]) {
      stepFight(state, [input(buttons), EMPTY_INPUT], STEP)
    }
    expect(state.events).toContainEqual({ type: "outOfEnergy", player: 0 })
    expect(state.fighters[0].move).toBeNull()
  })

  it("does not warn on affordable specials, free air attacks, or Whale's orb cap", () => {
    const state = createFight("whale", "bull")
    state.phase = "fight"
    state.orbs = [200, 400, 600].map(x => ({ owner: 0, x, y: 400, radius: 90, remainingMs: 3000, captured: null }))
    stepFight(state, [input({ sp: true }), input({ sp: true })], STEP)
    expect(state.events.some(e => e.type === "outOfEnergy")).toBe(false)
    expect(state.fighters[0].energy).toBe(100)
    expect(state.fighters[1].move).not.toBeNull()
    state.fighters[0].energy = 0
    stepFight(state, [input({ up: true }), EMPTY_INPUT], STEP)
    stepFight(state, [input({ sp: true }), EMPTY_INPUT], STEP)
    expect(state.events.some(e => e.type === "outOfEnergy")).toBe(false)
    expect(state.fighters[0].move?.kind).toBe("normal")
  })
})
