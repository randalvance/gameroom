import { describe, expect, it } from "vitest"
import { createFight, EMPTY_INPUT, stepFight, type FightInput, type FightState } from "./fight-sim"
const STEP = 1000 / 60
const input = (p: Partial<FightInput> = {}) => ({ ...EMPTY_INPUT, ...p })
function fight(mirror = false) { const s = createFight("whale", mirror ? "whale" : "bull"); s.phase = "fight"; s.fighters[0].x = 200; s.fighters[1].x = 800; s.fighters[0].energy = 100; return s }
function tick(s: FightState, ms: number, a = EMPTY_INPUT, b = EMPTY_INPUT) { for (let t = 0; t < ms; t += STEP) stepFight(s, [a, b], STEP) }
function cast(s: FightState) { stepFight(s, [input({ sp: true }), EMPTY_INPUT], STEP); tick(s, s.fighters[0].def.moves.special.startup + STEP) }
function catchEnemy(s: FightState) { const orb = s.orbs[0]!; s.fighters[1].x = orb.x; stepFight(s, [EMPTY_INPUT, EMPTY_INPUT], STEP); return orb }

describe("Whale water orbs", () => {
  it("casts a stationary floating orb after startup, pays 35 and expires at three seconds", () => {
    const s = fight(); stepFight(s, [input({ sp: true }), EMPTY_INPUT], STEP)
    expect(s.fighters[0].move?.kind).toBe("orb"); expect(s.fighters[0].energy).toBe(65)
    tick(s, 250); expect(s.orbs).toHaveLength(0)
    tick(s, 300); expect(s.orbs).toHaveLength(1)
    const orb = s.orbs[0]!, position = [orb.x, orb.y]
    expect(orb.y).toBeGreaterThan(orb.radius); expect(orb.remainingMs).toBeLessThanOrEqual(3000)
    tick(s, 700, input({ left: true })); expect([orb.x, orb.y]).toEqual(position)
    tick(s, orb.remainingMs + STEP); expect(s.orbs).toHaveLength(0)
  })
  it("can place three orbs and rejects a fourth without spending energy", () => {
    const s = fight()
    for (let i = 0; i < 3; i++) { s.fighters[0].energy = 100; cast(s); tick(s, 450) }
    expect(s.orbs).toHaveLength(3)
    s.fighters[0].energy = 100
    stepFight(s, [input({ sp: true }), EMPTY_INPUT], STEP)
    expect(s.orbs).toHaveLength(3); expect(s.fighters[0].energy).toBe(100); expect(s.fighters[0].move).toBeNull()
  })
  it("traps contact without damage and prevents movement, jumps and attacks until expiry", () => {
    const s = fight(); cast(s); const hp = s.fighters[1].health, orb = catchEnemy(s), f = s.fighters[1]
    expect(f.state).toBe("trapped"); expect(orb.captured).toBe(1); expect(f.health).toBe(hp)
    const pos = [f.x, f.y]; tick(s, 400, EMPTY_INPUT, input({ right: true, up: true, hp: true, sp: true }))
    expect([f.x, f.y]).toEqual(pos); expect(f.move).toBeNull()
    tick(s, orb.remainingMs + STEP); expect(f.state).not.toBe("trapped"); expect(s.orbs).toHaveLength(0)
    tick(s, 700); const x = f.x; tick(s, 100, EMPTY_INPUT, input({ right: true })); expect(f.x).toBeGreaterThan(x)
  })
  it("does not slow anyone outside the orb and cannot capture its owner", () => {
    const s = fight(); cast(s); const orb = s.orbs[0]!, f = s.fighters[0]
    tick(s, 400); f.x = orb.x; const x = f.x
    tick(s, 100, input({ right: true }))
    expect(f.state).toBe("walk"); expect(f.x - x).toBeCloseTo(f.def.walkSpeed * STEP / 1000 * 6, 3)
    expect(orb.captured).toBeNull(); expect(s.fighters[1].state).toBe("idle")
  })
  it("can trap an opposing Whale and airborne enemies, but not invulnerable or downed fighters", () => {
    const mirror = fight(true); cast(mirror); catchEnemy(mirror); expect(mirror.fighters[1].state).toBe("trapped")
    for (const safe of ["invulnerable", "knockdown"] as const) {
      const s = fight(); cast(s); const f = s.fighters[1]; f.x = s.orbs[0]!.x
      if (safe === "invulnerable") f.invulnMs = 500; else { f.state = "knockdown"; f.stunMs = 700 }
      stepFight(s, [EMPTY_INPUT, EMPTY_INPUT], STEP); expect(f.state).not.toBe("trapped")
    }
    const air = fight(); cast(air); air.fighters[1].state = "jump"; air.fighters[1].y = 60; air.fighters[1].vy = 100
    catchEnemy(air); expect(air.fighters[1].state).toBe("trapped")
  })
  it("a follow-up hit pops the occupied orb and grants brief protection from adjacent orbs", () => {
    const s = fight(); cast(s); tick(s, 450); cast(s); const orb = catchEnemy(s), f = s.fighters[1]
    const hp = f.health; s.fighters[0].x = f.x - 80; tick(s, 450)
    stepFight(s, [input({ lp: true }), EMPTY_INPUT], STEP); tick(s, 160)
    expect(f.health).toBeLessThan(hp); expect(s.orbs).not.toContain(orb); expect(f.state).not.toBe("trapped")
    expect(f.orbImmuneUntil).toBeGreaterThan(s.clock)
  })
  it("preserves the orb position when the caster walks into a trapped enemy", () => {
    const s = fight(); cast(s); const orb = catchEnemy(s), f = s.fighters[1], x = f.x
    tick(s, 400); s.fighters[0].x = f.x - 65; tick(s, 300, input({ right: true }))
    expect(f.x).toBe(x); expect(orb.x).toBe(x)
  })
  it("mirrors placement and keeps the complete orb inside either stage edge", () => {
    const s = fight(); s.fighters[0].x = 850; s.fighters[1].x = 200; cast(s)
    expect(s.orbs[0]!.x).toBeLessThan(850)
    for (const x of [45, 915]) { const edge = fight(); edge.fighters[0].x = x; edge.fighters[1].x = x === 45 ? 40 : 920; cast(edge); const o = edge.orbs[0]!; expect(o.x - o.radius).toBeGreaterThanOrEqual(0); expect(o.x + o.radius).toBeLessThanOrEqual(960) }
  })
  it("uses circular contact, allowing fighters above or outside the sphere to avoid it", () => {
    const s = fight(); cast(s); const orb = s.orbs[0]!, f = s.fighters[1]
    f.x = orb.x; f.y = orb.y + orb.radius + 20; f.state = "jump"; f.vy = 0
    stepFight(s, [EMPTY_INPUT, EMPTY_INPUT], STEP); expect(f.state).toBe("jump")
  })
  it("clears traps on timeout and resets their immunity in the next round", () => {
    const s = fight(); cast(s); catchEnemy(s); s.timerMs = 1
    stepFight(s, [EMPTY_INPUT, EMPTY_INPUT], STEP); expect(s.orbs).toHaveLength(0); expect(s.fighters[1].state).not.toBe("trapped")
    tick(s, 2300); expect(s.round).toBe(2); expect(s.fighters[1].orbImmuneUntil).toBe(0)
  })
  it("ends the old combo on natural release after capturing a stunned fighter", () => {
    const s = fight(); cast(s); s.fighters[0].combo = 2
    s.fighters[1].state = "hitstun"; s.fighters[1].stateMs = 0; s.fighters[1].stunMs = 500
    const orb = catchEnemy(s)
    tick(s, orb.remainingMs + 500)
    expect(s.fighters[1].state).toBe("idle")
    expect(s.fighters[0].combo).toBe(0)
  })
})


it.each([false, true])("pops a water orb on a grounded back guard (crouch %s)", down => {
  const s = fight(); cast(s); const orb = s.orbs[0]!, victim = s.fighters[1]
  victim.x = orb.x
  stepFight(s, [EMPTY_INPUT, input({right:true, down})], STEP)
  expect(victim.state).not.toBe("trapped")
  expect(s.orbs).not.toContain(orb)
  expect(victim.health).toBe(victim.def.maxHealth)
  expect(s.events.some(event => event.type === "block")).toBe(true)
})

it.each([false, true])("blocks Bear's ice slam with back guard (crouch %s)", down => {
  const s = createFight("bear", "bull"); s.phase = "fight"
  const [bear, victim] = s.fighters; bear.x=400; victim.x=470
  bear.state="attack"; bear.move=bear.def.moves.special; bear.moveMs=bear.move.startup; bear.spawned=true
  const hp=victim.health
  stepFight(s, [EMPTY_INPUT,input({right:true,down})], STEP)
  expect(s.events.some(event => event.type === "block")).toBe(true)
  expect(hp-victim.health).toBe(bear.def.moves.special.chip)
  expect(victim.state).toBe("blockstun")
})
