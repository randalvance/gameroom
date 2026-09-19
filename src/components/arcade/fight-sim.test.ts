import { describe, expect, it } from "vitest"
import { characterById, type CharacterId } from "./characters"
import {
  createFight,
  EMPTY_INPUT,
  INTRO_MS,
  KO_MS,
  ROUND_SECONDS,
  STAGE_WIDTH,
  stepFight,
  timerSeconds,
  type FightEvent,
  type FightInput,
  type FightState,
} from "./fight-sim"

const STEP = 1000 / 60
const press = (keys: Partial<FightInput>): FightInput => ({ ...EMPTY_INPUT, ...keys })

/** Step for `ms`, holding `p1`/`p2` every step, collecting every event. */
function run(state: FightState, ms: number, p1: FightInput = EMPTY_INPUT, p2: FightInput = EMPTY_INPUT): FightEvent[] {
  const events: FightEvent[] = []
  for (let t = 0; t < ms; t += STEP) {
    stepFight(state, [p1, p2], STEP)
    events.push(...state.events)
  }
  return events
}

/** Attack buttons are edges: press for one step, then hold nothing. */
function tap(state: FightState, p1: FightInput, ms: number, p2: FightInput = EMPTY_INPUT): FightEvent[] {
  stepFight(state, [p1, p2], STEP)
  const events = [...state.events]
  events.push(...run(state, ms - STEP))
  return events
}

function readyFight(p1: CharacterId = "bull", p2: CharacterId = "bear", options?: Parameters<typeof createFight>[2]): FightState {
  const state = createFight(p1, p2, options)
  run(state, INTRO_MS + STEP)
  expect(state.phase).toBe("fight")
  state.fighters[0].energy = 100
  state.fighters[1].energy = 100
  return state
}

/** Walk the fighters into contact. */
function closeIn(state: FightState) {
  run(state, 4000, press({ right: true }), press({ left: true }))
}

describe("phases", () => {
  it("trades attacks active on the same frame without favoring player one", () => {
    const state = readyFight("bull", "bull")
    closeIn(state)
    const events = tap(state, press({ lp: true }), 200, press({ lp: true }))
    expect(events.filter(e => e.type === "hit").map(e => e.player).sort()).toEqual([0, 1])
    expect(state.fighters.map(f => f.health)).toEqual([105, 105])
  })

  it("gives equal meter to low-health fighters trading the same attack", () => {
    const state = readyFight("bull", "bull")
    closeIn(state)
    state.fighters.forEach(f => { f.health = 40; f.energy = 0 })
    tap(state, press({ lp: true }), 200, press({ lp: true }))
    expect(state.fighters[0].energy).toBeCloseTo(state.fighters[1].energy)
  })

  it("awards simultaneous lethal attacks as a double KO", () => {
    const state = readyFight("bull", "bull")
    closeIn(state)
    state.fighters.forEach(f => { f.health = 1 })
    const events = tap(state, press({ lp: true }), 200, press({ lp: true }))
    expect(state.fighters.map(f => f.state)).toEqual(["ko", "ko"])
    expect(state.roundWinner).toBeNull()
    expect(events.filter(e => e.type === "ko")).toHaveLength(1)
    run(state, KO_MS)
    expect(state.wins).toEqual([1, 1])
  })

  it("still interrupts a slower attack before it becomes active", () => {
    const state = readyFight("bull", "bull")
    closeIn(state)
    const events = tap(state, press({ hp: true }), 400, press({ lp: true }))
    expect(events.filter(e => e.type === "hit").map(e => e.player)).toEqual([1])
    expect(state.fighters.map(f => f.health)).toEqual([105, 110])
  })

  it("starts with ROUND / FIGHT and ignores the stick until FIGHT!", () => {
    const state = createFight("bull", "bear")
    const startX = state.fighters[0].x
    const events = run(state, INTRO_MS - STEP, press({ right: true }))
    expect(state.phase).toBe("intro")
    expect(state.fighters[0].x).toBe(startX)
    expect(events.find((e) => e.type === "fight")).toBeUndefined()
    const more = run(state, STEP * 2, press({ right: true }))
    expect(state.phase).toBe("fight")
    expect(more.some((e) => e.type === "fight")).toBe(true)
  })

  it("calls the round card once per round, and every swing is an event", () => {
    const state = createFight("bull", "bear")
    const intro = run(state, STEP * 3)
    expect(intro.filter((e) => e.type === "intro")).toHaveLength(1)
    run(state, INTRO_MS)
    closeIn(state)
    const light = tap(state, press({ lp: true }), 400)
    expect(light.filter((e) => e.type === "attack")).toEqual([{ type: "attack", player: 0, heavy: false }])
    const heavy = tap(state, press({ hp: true }), 700)
    expect(heavy.some((e) => e.type === "attack" && e.heavy)).toBe(true)
    // A second round gets its own card.
    state.fighters[1].health = 1
    state.timerMs = 20
    const next = run(state, 800 + KO_MS + STEP * 3)
    expect(state.round).toBe(2)
    expect(next.filter((e) => e.type === "intro")).toHaveLength(1)
  })

  it("counts the round clock down from 99", () => {
    const state = readyFight()
    expect(timerSeconds(state)).toBe(ROUND_SECONDS)
    run(state, 3000)
    expect(timerSeconds(state)).toBe(ROUND_SECONDS - 3)
  })

  it("gives a timed-out round to whoever has more health, then starts round two", () => {
    const state = readyFight()
    state.fighters[1].health = 40
    state.timerMs = 50
    const events = run(state, 100)
    expect(state.phase).toBe("ko")
    expect(events.some((e) => e.type === "timeout" && e.player === 0)).toBe(true)
    run(state, KO_MS)
    expect(state.wins).toEqual([1, 0])
    expect(state.round).toBe(2)
    expect(state.phase).toBe("intro")
    expect(state.fighters[1].health).toBe(characterById("bear").maxHealth)
    expect(timerSeconds(state)).toBe(ROUND_SECONDS)
  })

  it("ends the match on the second round win", () => {
    const state = readyFight()
    state.wins = [1, 0]
    state.fighters[1].health = 1
    closeIn(state)
    tap(state, press({ lp: true }), 400)
    expect(state.phase).toBe("ko")
    expect(state.fighters[1].state).toBe("ko")
    const events = run(state, KO_MS + STEP)
    expect(state.phase).toBe("matchover")
    expect(state.matchWinner).toBe(0)
    expect(state.wins).toEqual([2, 0])
    expect(events.some((e) => e.type === "matchover")).toBe(true)
  })
})

describe("movement", () => {
  it("walks toward the opponent, faces them, and never leaves the stage", () => {
    const state = readyFight()
    const [p1, p2] = state.fighters
    const before = p1.x
    run(state, 500, press({ right: true }))
    expect(p1.x).toBeGreaterThan(before)
    expect(p1.facing).toBe(1)
    expect(p2.facing).toBe(-1)
    run(state, 20000, press({ left: true }), press({ right: true }))
    expect(p1.x).toBe(p1.def.width / 2)
    expect(p2.x).toBe(STAGE_WIDTH - p2.def.width / 2)
  })

  it("never lets the fighters overlap", () => {
    const state = readyFight()
    closeIn(state)
    const [p1, p2] = state.fighters
    expect(p2.x - p1.x).toBeGreaterThanOrEqual((p1.def.width + p2.def.width) / 2 - 0.01)
  })

  it("jumps and lands", () => {
    const state = readyFight()
    const events = run(state, STEP, press({ up: true }))
    expect(state.fighters[0].state).toBe("jump")
    expect(events.some((e) => e.type === "jump")).toBe(true)
    const later = run(state, 1500)
    expect(state.fighters[0].y).toBe(0)
    expect(state.fighters[0].state).toBe("idle")
    expect(later.some((e) => e.type === "land")).toBe(true)
  })

  it("crouches while down is held", () => {
    const state = readyFight()
    run(state, STEP * 2, press({ down: true }))
    expect(state.fighters[0].state).toBe("crouch")
    expect(state.fighters[0].crouching).toBe(true)
    run(state, STEP * 2)
    expect(state.fighters[0].crouching).toBe(false)
  })
})

describe("hits and blocks", () => {
  it("lets Primey land a close poke against a slim opponent at 110 units", () => {
    const state = readyFight("primey", "quant")
    state.fighters[0].x = 400
    state.fighters[1].x = 510
    const events = tap(state, press({ lp: true }), 200)
    expect(events.some(e => e.type === "hit" && e.player === 0)).toBe(true)
  })
  it("gives Bernard a red eye-beam special", () => {
    const bernard = characterById("bernard")
    expect(bernard.specialName).toBe("REDLINE VISION")
    expect(bernard.moves.special.label).toBe("REDLINE VISION")
    expect(bernard.moves.special.kind).toBe("beam")
  })

  it("gives final-boss Bernard 100 HP and normal incoming and outgoing damage", () => {
    const againstBoss = readyFight("bull", "bernard", { bossSlot: 1 })
    closeIn(againstBoss)
    const bernardHealth = againstBoss.fighters[1].health
    tap(againstBoss, press({ hp: true }), 700)
    expect(bernardHealth).toBe(100)
    expect(bernardHealth - againstBoss.fighters[1].health).toBe(14)

    const bossAttacks = readyFight("bull", "bernard", { bossSlot: 1 })
    closeIn(bossAttacks)
    const bullHealth = bossAttacks.fighters[0].health
    tap(bossAttacks, EMPTY_INPUT, 700, press({ hp: true }))
    expect(bullHealth - bossAttacks.fighters[0].health).toBe(13)
  })

  it("a jab in range takes its damage off the opponent", () => {
    const state = readyFight()
    closeIn(state)
    const bear = characterById("bear")
    const events = tap(state, press({ lp: true }), 300)
    expect(state.fighters[1].health).toBe(bear.maxHealth - characterById("bull").moves.lp.damage)
    expect(events.filter((e) => e.type === "hit" && e.player === 0)).toHaveLength(1)
    expect(state.fighters[1].state === "hitstun" || state.fighters[1].state === "idle").toBe(true)
  })

  it("a jab out of range whiffs", () => {
    const state = readyFight()
    const events = tap(state, press({ lp: true }), 400)
    expect(state.fighters[1].health).toBe(characterById("bear").maxHealth)
    expect(events.some((e) => e.type === "whiff")).toBe(true)
  })

  it("holding back blocks a high attack: no damage, block stun", () => {
    const state = readyFight()
    closeIn(state)
    // Bear is on the right facing left, so "back" is right.
    stepFight(state, [press({ hp: true }), press({ right: true })], STEP)
    const events = run(state, 500, EMPTY_INPUT, press({ right: true }))
    expect(state.fighters[1].health).toBe(characterById("bear").maxHealth)
    expect(events.some((e) => e.type === "block")).toBe(true)
    expect(events.some((e) => e.type === "hit")).toBe(false)
  })

  it("a sweep goes under a standing block but not a crouching one", () => {
    const standing = readyFight()
    closeIn(standing)
    stepFight(standing, [press({ down: true, hk: true }), press({ right: true })], STEP)
    run(standing, 600, EMPTY_INPUT, press({ right: true }))
    expect(standing.fighters[1].health).toBeLessThan(characterById("bear").maxHealth)
    expect(standing.fighters[1].state).toBe("knockdown")

    const crouching = readyFight()
    closeIn(crouching)
    stepFight(crouching, [press({ down: true, hk: true }), press({ right: true, down: true })], STEP)
    const events = run(crouching, 600, EMPTY_INPUT, press({ right: true, down: true }))
    expect(crouching.fighters[1].health).toBe(characterById("bear").maxHealth)
    expect(events.some((e) => e.type === "block")).toBe(true)
  })

  it("a fighter mid-attack cannot block", () => {
    const state = readyFight()
    closeIn(state)
    // Bear starts a slow heavy; Bull's jab lands during its startup even though bear holds back.
    stepFight(state, [EMPTY_INPUT, press({ hp: true, right: true })], STEP)
    stepFight(state, [press({ lp: true }), press({ right: true })], STEP)
    run(state, 300, EMPTY_INPUT, press({ right: true }))
    expect(state.fighters[1].health).toBeLessThan(characterById("bear").maxHealth)
  })

  it("nothing connects with a fighter who is down", () => {
    const state = readyFight("whale", "quant")
    closeIn(state)
    tap(state, press({ down: true, hk: true }), 500)
    expect(state.fighters[1].state).toBe("knockdown")
    const floored = state.fighters[1].health
    tap(state, press({ lp: true }), 250)
    expect(state.fighters[1].health).toBe(floored)
  })

  it("a cornered victim pushes the attacker back instead, so a jab cannot chain forever", () => {
    const state = readyFight("quant", "bear")
    // Walk the bear into the right corner with the quant on top of him.
    run(state, 8000, press({ right: true }), press({ right: true }))
    expect(state.fighters[1].x).toBe(STAGE_WIDTH - state.fighters[1].def.width / 2)
    let hits = 0
    for (let i = 0; i < 12; i++) {
      const events = tap(state, press({ lp: true }), 215)
      hits += events.filter((e) => e.type === "hit").length
    }
    expect(hits).toBeGreaterThan(0)
    expect(hits).toBeLessThan(6)
    expect(state.fighters[1].health).toBeGreaterThan(0)
  })

  it("a launched victim cannot be juggled forever — they fall out after a few air hits", () => {
    const state = readyFight("bull", "bear")
    // Put the bull in the right corner under the whale.
    run(state, 8000, press({ right: true }), press({ right: true }))
    const start = state.fighters[1].health
    let hits = 0
    // Launch, then mash jabs for a long while.
    tap(state, press({ sp: true }), 200)
    for (let i = 0; i < 30; i++) {
      const events = tap(state, press({ lp: true }), 170)
      hits += events.filter((e) => e.type === "hit").length
    }
    expect(hits).toBeGreaterThan(0)
    expect(hits).toBeLessThanOrEqual(5)
    expect(start - state.fighters[1].health).toBeLessThan(45)
  })

  it("the combo counter resets once the victim recovers, and scales damage while it runs", () => {
    const state = readyFight("quant", "bear")
    closeIn(state)
    tap(state, press({ lp: true }), 300)
    expect(state.fighters[0].combo).toBe(1)
    run(state, 800)
    expect(state.fighters[1].state).toBe("idle")
    expect(state.fighters[0].combo).toBe(0)

    // Deep into a combo, a jab does a fraction of its listed damage.
    const scaled = readyFight("quant", "bear")
    closeIn(scaled)
    scaled.fighters[0].combo = 4
    const before = scaled.fighters[1].health
    tap(scaled, press({ lp: true }), 300)
    const quant = characterById("quant")
    expect(before - scaled.fighters[1].health).toBe(Math.round(quant.moves.lp.damage * (1 - 4 * 0.12)))
    expect(scaled.fighters[0].combo).toBe(5)
  })

  it("one active hitbox lands once, even if it stays overlapping", () => {
    const state = readyFight("whale", "bear")
    closeIn(state)
    const before = state.fighters[1].health
    tap(state, press({ hk: true }), 900)
    expect(before - state.fighters[1].health).toBe(characterById("whale").moves.hk.damage)
  })
})

describe("specials", () => {
  it("fires Primey's low-damage laser before a slow heavy attack completes startup", () => {
    const state = readyFight("primey", "bear")
    state.fighters[0].x = 200
    state.fighters[1].x = 800
    const events = tap(state, press({ sp: true }), 210, press({ hp: true }))
    expect(events.some(e => e.type === "hit" && e.player === 0)).toBe(true)
    expect(state.fighters[1].def.maxHealth - state.fighters[1].health).toBe(5)
  })
  it.each(["bull", "bear", "quant", "whale", "bernard", "primey"] as const)("Bernard's eye laser hits standing %s and can be ducked", target => {
    for (const slot of [0, 1] as const) {
      for (const crouch of [false, true]) {
        const state = slot === 0 ? readyFight("bernard", target) : readyFight(target, "bernard")
        state.fighters[0].x = 200
        state.fighters[1].x = 650
        const victim = state.fighters[slot === 0 ? 1 : 0]
        const inputs: [FightInput, FightInput] = [EMPTY_INPUT, EMPTY_INPUT]
        inputs[slot] = press({ sp: true })
        inputs[slot === 0 ? 1 : 0] = press({ down: crouch })
        run(state, 700, ...inputs)
        expect(victim.def.maxHealth - victim.health).toBe(crouch ? 0 : state.fighters[slot].def.moves.special.damage)
      }
    }
  })

  it("↓ ↘ → + punch fires Bernard's eye scan, which holds its firing pose and hits", () => {
    const state = readyFight("bernard", "bear")
    run(state, STEP * 4, press({ down: true }))
    run(state, STEP * 2, press({ down: true, right: true }))
    run(state, STEP * 2, press({ right: true }))
    const events = tap(state, press({ lp: true }), 300)
    expect(events.some((e) => e.type === "special" && e.player === 0)).toBe(true)
    expect(state.fighters[0].move?.kind).toBe("beam")
    const later = run(state, 2000)
    expect(later.some((e) => e.type === "hit" && e.player === 0)).toBe(true)
    expect(state.fighters[1].health).toBe(characterById("bear").maxHealth - characterById("bernard").moves.special.damage)
    expect(state.projectiles).toHaveLength(0)
  })

  it("the dedicated special button works without the motion", () => {
    const state = readyFight("bernard", "bear")
    tap(state, press({ sp: true }), 300)
    expect(state.fighters[0].move?.kind).toBe("beam")
  })

  it("blocking a special still costs chip damage", () => {
    const state = readyFight("bernard", "bear")
    stepFight(state, [press({ sp: true }), press({ right: true })], STEP)
    run(state, 2500, EMPTY_INPUT, press({ right: true }))
    const bernard = characterById("bernard")
    expect(state.fighters[1].health).toBe(characterById("bear").maxHealth - (bernard.moves.special.chip ?? 0))
  })

  it("BULL's horn charge carries him across the stage into the opponent", () => {
    const state = readyFight("bull", "bear")
    const before = state.fighters[0].x
    const events = tap(state, press({ sp: true }), 1200)
    expect(state.fighters[0].x).toBeGreaterThan(before + 100)
    expect(events.some((e) => e.type === "hit" && e.player === 0)).toBe(true)
    expect(["hitstun", "knockdown", "idle"]).toContain(state.fighters[1].state)
  })

  it("Whale places an orb after startup and expires after three seconds", () => {
    const state = readyFight("whale", "quant")
    tap(state, press({ sp: true }), 600)
    expect(state.orbs).toHaveLength(1)
    expect(state.orbs[0]?.owner).toBe(0)
    run(state, 3100)
    expect(state.orbs).toHaveLength(0)
  })
})
