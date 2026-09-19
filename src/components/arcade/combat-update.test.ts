import { describe, expect, it } from "vitest"
import { CHARACTERS } from "./characters"
import { canAffordSpecial, createFight, EMPTY_INPUT, stepFight, type FightInput, type FightState } from "./fight-sim"
import { circleRadius } from "./special-motion"

const STEP = 1000 / 60
const input = (p: Partial<FightInput> = {}): FightInput => ({ ...EMPTY_INPUT, ...p })
function tick(s: FightState, ms: number, a = EMPTY_INPUT, b = EMPTY_INPUT) {
  for (let t = 0; t < ms; t += STEP) stepFight(s, [a, b], STEP)
}
function fight(a: Parameters<typeof createFight>[0], b: Parameters<typeof createFight>[1], seed = 1) {
  const s = createFight(a, b, { seed }); s.phase = "fight"; return s
}

describe("energy economy", () => {
  it.each(CHARACTERS)("starts $id at full energy and health", def => {
    const s = fight(def.id, def.id)
    for (const f of s.fighters) {
      expect(f.energy).toBe(def.id === "bernard" ? 500 : 100)
      expect(f.health).toBe(def.maxHealth)
      expect(canAffordSpecial(f, f.def.moves.special)).toBe(true)
    }
  })

  it("rejects unaffordable specials and pays once at cast", () => {
    const s = fight("bernard", "bear")
    const f = s.fighters[0], cost = f.def.moves.special.energyCost!
    f.energy = 0
    expect(canAffordSpecial(f, f.def.moves.special)).toBe(false)
    stepFight(s, [input({ sp: true }), EMPTY_INPUT], STEP)
    expect(f.move).toBeNull()
    expect(s.projectiles).toHaveLength(0)
    f.energy = cost
    stepFight(s, [input({ sp: true }), EMPTY_INPUT], STEP)
    expect(f.move?.kind).toBe("beam")
    expect(f.energy).toBe(0)
    tick(s, 1800)
    stepFight(s, [input({ sp: true }), EMPTY_INPUT], STEP)
    expect(f.energy).toBeLessThan(cost)
    expect(f.move).toBeNull()
  })

  it("builds meter only from landed hits and gives low-health fighters a larger gain", () => {
    const full = fight("bull", "bear"), low = fight("bull", "bear"), lowAttacker = fight("bull", "bear")
    for (const s of [full, low, lowAttacker]) {
      s.fighters[0].x = 400; s.fighters[1].x = 470
      s.fighters.forEach(f => { f.energy = 0 })
    }
    low.fighters[1].health = 30
    lowAttacker.fighters[0].health = 30
    stepFight(full, [input({ lp: true }), EMPTY_INPUT], STEP)
    stepFight(low, [input({ lp: true }), EMPTY_INPUT], STEP)
    stepFight(lowAttacker, [input({ lp: true }), EMPTY_INPUT], STEP)
    tick(full, 180); tick(low, 180); tick(lowAttacker, 180)
    expect(full.fighters[0].energy).toBeGreaterThan(0)
    expect(full.fighters[1].energy).toBeGreaterThan(0)
    expect(low.fighters[1].energy).toBeGreaterThan(full.fighters[1].energy)
    expect(lowAttacker.fighters[0].energy).toBeGreaterThan(full.fighters[0].energy)
    const whiff = fight("bull", "bear")
    whiff.fighters[0].energy = 0
    stepFight(whiff, [input({ lp: true }), EMPTY_INPUT], STEP); tick(whiff, 450)
    expect(whiff.fighters[0].energy).toBe(0)
  })

  it.each(["quant", "bernard"] as const)("refills meter and health and clears hazards each round against %s", opponent => {
    const s = fight("whale", opponent)
    s.fighters[0].energy = 80; s.fighters[1].energy = 90
    s.fighters[1].health = 20
    s.orbs.push({ owner: 0, x: 500, y: 110, radius: 90, remainingMs: 3000, captured: null })
    s.timerMs = 1
    tick(s, 10); tick(s, 2300)
    expect(s.round).toBe(2)
    expect(s.fighters.map(f => f.energy)).toEqual([100, opponent === "bernard" ? 500 : 100])
    expect(s.fighters[1].health).toBe(100)
    expect(s.orbs).toHaveLength(0)
  })

  it.each([0, 1] as const)("refills above 100 and caps each fighter independently with Bernard in slot %s", slot => {
    const s = slot === 0 ? fight("bernard", "bull") : fight("bull", "bernard")
    const bernard = s.fighters[slot], other = s.fighters[1 - slot]!
    s.fighters[0].x = 400; s.fighters[1].x = 470
    bernard.energy = 498; other.energy = 98
    stepFight(s, [input({ lp: true }), EMPTY_INPUT], STEP)
    tick(s, 180)
    expect(bernard.energy).toBe(500)
    expect(other.energy).toBe(100)
  })

  it("lets Bernard spend beyond the first bar without losing his reserves", () => {
    const s = fight("bernard", "bull")
    s.fighters[1].invulnMs = 10000
    for (let cast = 1; cast <= 5; cast++) {
      stepFight(s, [input({ up: true, sp: true }), EMPTY_INPUT], STEP)
      expect(s.fighters[0].move?.kind).toBe("rain")
      expect(s.fighters[0].energy).toBe(500 - 75 * cast)
      // Finish recovery before the next cast, keeping this an isolated meter check.
      tick(s, 1500)
    }
  })
})

describe("special geometry and status", () => {
  it("uses small, middle and half-screen Quant circles", () => {
    const f = fight("quant", "bear").fighters[0]
    f.state = "attack"; f.move = f.def.moves.special
    const m = f.move
    for (const [progress, radius] of [[0.1, 80], [0.5, 220], [0.9, 400]] as const) {
      f.moveMs = m.startup + m.active * progress
      expect(circleRadius(f)).toBe(radius)
    }
  })

  it("keeps Bernard's scanning beam active for a full second", () => {
    const s = fight("bernard", "bear")
    stepFight(s, [input({ sp: true }), EMPTY_INPUT], STEP)
    tick(s, 800)
    expect(s.fighters[0].move?.kind).toBe("beam")
    expect(s.projectiles).toHaveLength(0)
  })
})

describe("Bernard redline rain", () => {
  function cast(seed = 3) {
    const s = fight("bernard", "bear", seed)
    s.fighters[0].energy = 100
    stepFight(s, [input({ up: true, sp: true }), EMPTY_INPUT], STEP)
    return s
  }
  it("selects up+special before jumping, pays its high cost, and seeds three distinct warning lanes", () => {
    const a = cast(), b = cast(), c = cast(4)
    expect(a.fighters[0].move?.kind).toBe("rain")
    expect(a.fighters[0].state).toBe("attack")
    expect(a.fighters[0].energy).toBe(25)
    expect(a.events.find(event => event.type === "special")).toMatchObject({ moveId: "bernard-special-up" })
    tick(a, 400); tick(b, 400); tick(c, 400)
    expect(a.rain).toHaveLength(3)
    expect(a.rain.map(l => l.x)).toEqual(b.rain.map(l => l.x))
    expect(a.rain.map(l => l.x)).not.toEqual(c.rain.map(l => l.x))
    expect(a.rain.every(l => l.warningMs >= 500)).toBe(true)
  })

  it("accepts Up then Special on consecutive ticks during Bernard's jump start", () => {
    const s = fight("bernard", "bear")
    s.fighters[0].energy = 100
    stepFight(s, [input({ up: true }), EMPTY_INPUT], STEP)
    expect(s.fighters[0].state).toBe("jump")
    stepFight(s, [input({ up: true, sp: true }), EMPTY_INPUT], STEP)
    expect(s.fighters[0].move?.kind).toBe("rain")
    expect(s.fighters[0].state).toBe("attack")
    expect(s.fighters[0].y).toBe(0)
    expect(s.fighters[0].vx).toBe(0)
    expect(s.fighters[0].vy).toBe(0)
    expect(s.fighters[0].energy).toBe(25)
  })

  it("does not turn unaffordable Up then Special into a free air attack", () => {
    const s = fight("bernard", "bear")
    s.fighters[0].energy = 0
    stepFight(s, [input({ up: true }), EMPTY_INPUT], STEP)
    stepFight(s, [input({ up: true, sp: true }), EMPTY_INPUT], STEP)
    expect(s.fighters[0].move).toBeNull()
    expect(s.fighters[0].state).toBe("jump")
    expect(s.fighters[0].energy).toBe(0)
  })

  it("lets Bernard release Up before pressing Special within the cancel grace", () => {
    const s = fight("bernard", "bear")
    s.fighters[0].energy = 75
    stepFight(s, [input({ up: true }), EMPTY_INPUT], STEP)
    stepFight(s, [input({ sp: true }), EMPTY_INPUT], STEP)
    expect(s.fighters[0].move?.kind).toBe("rain")
    expect(s.fighters[0].energy).toBe(0)
  })

  it("warns before damage, allows a dodge, and caps one cast at three hits", () => {
    const hit = cast(8), dodge = cast(8)
    tick(hit, 400); tick(dodge, 400)
    const before = hit.fighters[1].health
    tick(hit, 450); tick(dodge, 450, EMPTY_INPUT, input({ right: true }))
    expect(hit.fighters[1].health).toBe(before)
    tick(hit, 1400); tick(dodge, 1400, EMPTY_INPUT, input({ right: true }))
    expect(hit.fighters[1].health).toBeLessThan(before)
    expect(dodge.fighters[1].health).toBeGreaterThanOrEqual(hit.fighters[1].health)
    expect(before - hit.fighters[1].health).toBeLessThanOrEqual(30)
    expect(hit.rain).toHaveLength(0)
  })

  it("stops resolving lethal lanes as soon as one fighter wins the round", () => {
    const s = fight("bernard", "bernard")
    const move = s.fighters[0].def.moves.specialUp!
    s.fighters[0].health = 1; s.fighters[1].health = 1
    s.rain.push(
      { owner: 0, x: s.fighters[1].x, ageMs: 590, warningMs: 600, activeMs: 120, hit: false, move },
      { owner: 1, x: s.fighters[0].x, ageMs: 590, warningMs: 600, activeMs: 120, hit: false, move },
    )
    stepFight(s, [EMPTY_INPUT, EMPTY_INPUT], STEP)
    expect(s.phase).toBe("ko")
    expect(s.roundWinner).toBe(0)
    expect(s.events.filter(e => e.type === "ko")).toHaveLength(1)
    expect(s.rain).toHaveLength(0)
  })

  it("clears orbs and rain immediately on a clock timeout", () => {
    const s = fight("whale", "bernard")
    s.orbs.push({ owner: 0, x: 500, y: 110, radius: 90, remainingMs: 3000, captured: null })
    s.rain.push({ owner: 1, x: s.fighters[0].x, ageMs: 0, warningMs: 600, activeMs: 120,
      hit: false, move: s.fighters[1].def.moves.specialUp! })
    s.timerMs = 1
    stepFight(s, [EMPTY_INPUT, EMPTY_INPUT], STEP)
    expect(s.phase).toBe("ko")
    expect(s.orbs).toHaveLength(0)
    expect(s.rain).toHaveLength(0)
  })
})
