import { describe, expect, it } from "vitest"
import { characterById, type MoveDef } from "./characters"
import { createFight, type Fighter } from "./fight-sim"
import { pickSpriteFrame } from "./sprite-frames"
import { FIGHTER_ATLASES, PORTRAIT_ORDER } from "./fighter-atlases"

function fighter(over: Partial<Fighter> = {}): Fighter {
  const base = createFight("bull", "bear").fighters[0]
  return { ...base, ...over }
}

describe("sprite frame selection", () => {
  it("idles through four frames and uses a dedicated walk cycle on the fighter motion clock", () => {
    const seen = new Set<number>()
    for (let t = 0; t < 800; t += 60) seen.add(pickSpriteFrame(fighter({ animationMs: t }), t).index)
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
    for (const id of PORTRAIT_ORDER) {
      const f = createFight(id, "bear").fighters[0]
      f.state = "walk"
      for (let i = 0; i < 4; i++) {
        f.animationMs = i * 110
        expect(pickSpriteFrame(f, 99999)).toMatchObject({pose:"walk", index:i})
      }
    }
  })

  it("gives Bernard's rain its own four casting poses", () => {
    const f = createFight("bernard", "bear").fighters[0]
    f.state = "attack"; f.move = f.def.moves.specialUp!
    const m = f.move
    ;[0, m.startup * 0.6, m.startup + 1, m.startup + m.active + 1].forEach((time, index) => {
      f.moveMs = time
      expect(pickSpriteFrame(f, time)).toMatchObject({pose:"specialUp", index})
    })
  })

  it.each([
    ["bernard-special", "beam", "specialScan"],
    ["bernard-dash", "dash", "specialCharge"],
    ["bernard-ice", "iceSlam", "specialIce"],
    ["bernard-circle", "circle", "specialCircle"],
    ["bernard-orb", "orb", "specialOrb"],
  ] as const)("uses Bernard's dedicated %s sequence", (id, kind, pose) => {
    const f = createFight("bernard", "bull").fighters[0]
    f.state = "attack"
    f.move = { ...f.def.moves.special, id, kind, startup: 800, active: 1000, recovery: 300 }
    f.special = { originX: f.x, targetX: f.x + 200, targetLocked: true, landed: false }
    const times = kind === "iceSlam" ? [0, 300, 801, 1801] : [0, 480, 801, 1801]
    times.forEach((moveMs, index) => {
      f.moveMs = moveMs
      expect(pickSpriteFrame(f, 0)).toMatchObject({ pose, index })
    })
  })

  it("holds the ultimate overhead until release, then throws and recovers", () => {
    const f = createFight("bernard", "bull").fighters[0]
    f.state = "attack"
    f.move = { ...f.def.moves.special, id: "bernard-breaking-news", kind: "breakingNews", startup: 3800, active: 900, recovery: 500 } as MoveDef
    for (const [moveMs, index] of [[0, 0], [600, 1], [3000, 1], [3799, 1], [3800, 2], [4700, 3]]) {
      f.moveMs = moveMs!
      expect(pickSpriteFrame(f, 0)).toMatchObject({ pose: "specialBreaking", index })
    }
  })

  it("walks a punch through prep, windup, extension and recovery", () => {
    const move = characterById("bull").moves.hp
    const at = (moveMs: number) => pickSpriteFrame(fighter({ state: "attack", move, moveMs }), 0)
    expect(at(0)).toMatchObject({ pose: "punchHigh", index: 0 })
    expect(at(move.startup * 0.6)).toMatchObject({ pose: "punchHigh", index: 1 })
    expect(at(move.startup + 10)).toMatchObject({ pose: "punchHigh", index: 2 })
    expect(at(move.startup + move.active + 10)).toMatchObject({ pose: "punchHigh", index: 3 })
  })

  it("uses the low sheets for crouching attacks and the ranged sheet for a projectile", () => {
    const bull = characterById("bull")
    expect(pickSpriteFrame(fighter({ state: "attack", move: bull.moves.sweep, moveMs: bull.moves.sweep.startup + 5 }), 0)).toMatchObject({ pose: "kickLow", index: 2 })
    expect(pickSpriteFrame(fighter({ state: "attack", move: bull.moves.lp, moveMs: 0, crouching: true }), 0)).toMatchObject({ pose: "punchLow", index: 0 })
    const quant = characterById("quant")
    expect(pickSpriteFrame(fighter({ state: "attack", move: quant.moves.special, moveMs: quant.moves.special.startup + 5 }), 0)).toMatchObject({ pose: "ranged", index: 2 })
  })

  it("reads the jump off the velocity: rising, apex, landing", () => {
    expect(pickSpriteFrame(fighter({ state: "jump", y: 40, vy: 500 }), 0)).toMatchObject({ pose: "jump", index: 1 })
    expect(pickSpriteFrame(fighter({ state: "jump", y: 120, vy: 20 }), 0)).toMatchObject({ pose: "jump", index: 2 })
    expect(pickSpriteFrame(fighter({ state: "jump", y: 10, vy: -400 }), 0)).toMatchObject({ pose: "jump", index: 3 })
  })

  it("lies flat when down and flashes on a fresh hit", () => {
    expect(pickSpriteFrame(fighter({ state: "knockdown", y: 0 }), 0)).toMatchObject({ pose: "down", lying: false })
    expect(pickSpriteFrame(fighter({ state: "ko", y: 0 }), 0)).toMatchObject({ pose: "down", lying: false })
    expect(pickSpriteFrame(fighter({ state: "hitstun", stateMs: 20 }), 0)).toMatchObject({ hit: true, lying: false })
    expect(pickSpriteFrame(fighter({ state: "hitstun", stateMs: 400 }), 0)).toMatchObject({ hit: false })
  })
})

describe("generated atlas metadata", () => {
  it("has every pose, four frames each, with anchors inside the frame, for every fighter", () => {
    const poses = ["idle", "crouch", "punchHigh", "punchLow", "kickHigh", "kickLow", "jump", "ranged", "down", "walk"] as const
    for (const id of PORTRAIT_ORDER) {
      const atlas = FIGHTER_ATLASES[id]!
      expect(atlas.url).toBe(`/assets/arcade/fighter-${id}-${id === "bernard" ? "v8" : id === "bear" ? "v6" : "v5"}.png`)
      for (const pose of poses) {
        const frames = atlas.poses[pose]
        expect(frames, `${id}/${pose}`).toHaveLength(4)
        for (const fr of frames!) {
          expect(fr.w).toBeGreaterThan(40)
          expect(fr.h).toBeGreaterThan(pose === "down" ? 20 : 60)
          expect(fr.ax).toBeGreaterThanOrEqual(0)
          expect(fr.ax).toBeLessThanOrEqual(fr.w)
          expect(fr.ay).toBe(fr.h)
        }
      }
      // Specials have their own effects; no old fireball is embedded.
      expect(atlas.projectile).toBeUndefined()
    }
  })

  it("includes four distinct full-body frames for each expanded Bernard power", () => {
    const atlas = FIGHTER_ATLASES.bernard!
    for (const pose of ["specialCharge", "specialIce", "specialCircle", "specialOrb", "specialScan", "specialBreaking"] as const) {
      const frames = atlas.poses[pose]
      expect(frames, pose).toHaveLength(4)
      expect(new Set(frames!.map(frame => `${frame.x},${frame.y}`)).size).toBe(4)
      for (const frame of frames!) {
        expect(frame.h).toBeGreaterThan(60)
        expect(frame.ax).toBeGreaterThanOrEqual(0)
        expect(frame.ax).toBeLessThanOrEqual(frame.w)
        expect(frame.ay).toBe(frame.h)
      }
    }
  })
})
