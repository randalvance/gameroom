// Which sprite frame a fighter shows right now.
//
// The atlases carry nine four-frame poses per fighter (idle, crouch, high
// and low punch, high and low kick, jump, special, down). The sim knows nothing about
// art, so this is the one place that maps its state — the move in progress
// and how far through it is, the jump's velocity, a crouch, a stun — onto a
// pose and a frame index. Pure, so the mapping can be pinned by a test.

import type { MoveDef } from "./characters"
import type { Fighter } from "./fight-sim"
import type { SpritePose } from "./sprite-atlas.generated"
import { BEAR_WINDUP, BREAKING_NEWS_LEAP_MS } from "./special-motion"

export interface SpritePick {
  pose: SpritePose
  index: number
  /** Flat on the floor: knocked down or out. */
  lying: boolean
  /** Just took a hit: the renderer flashes the frame. */
  hit: boolean
}

/** Where an attack is in its swing: 0/1 through startup, 2 live, 3 recovering. */
function swingIndex(move: MoveDef, moveMs: number): number {
  if (moveMs < move.startup * 0.5) return 0
  if (moveMs < move.startup) return 1
  if (moveMs < move.startup + move.active) return 2
  return 3
}

type Family = "punch" | "kick" | "low" | "air" | "dash" | "projectile" | "uppercut" | "slam"

export function moveFamily(move: MoveDef): Family {
  if (move.kind === "dash") return "dash"
  if (move.kind === "projectile") return "projectile"
  if (move.kind === "uppercut") return "uppercut"
  if (move.id.endsWith("-special")) return "slam"
  if (move.id.endsWith("-air")) return "air"
  if (move.id.endsWith("-crlk") || move.id.endsWith("-sweep")) return "low"
  if (move.id.endsWith("-lk") || move.id.endsWith("-hk")) return "kick"
  return "punch"
}

export function pickSpriteFrame(f: Fighter, nowMs: number): SpritePick {
  const pick = (pose: SpritePose, index: number, extra: Partial<SpritePick> = {}): SpritePick => ({
    pose, index, lying: false, hit: false, ...extra,
  })
  switch (f.state) {
    case "ko":
    case "knockdown":
      // Falling through the air on the way down, then flat once landed.
      return f.y > 0 ? pick("down", f.vy > 0 ? 0 : 1) : pick("down", f.stateMs < 160 ? 2 : 3)
    case "hitstun":
      return f.y > 0 ? pick("down", f.vy > 0 ? 0 : 1, { hit: f.stateMs < 120 }) : pick("crouch", 0, { hit: f.stateMs < 120 })
    case "blockstun":
      return f.crouching ? pick("crouch", 2) : pick("idle", 0)
    case "trapped":
      return pick("idle", 0)
    case "jump": {
      if (f.y < 25 && f.vy < 0) return pick("jump", 3)
      if (f.vy > 150) return pick("jump", 1)
      return pick("jump", 2)
    }
    case "crouch":
      if (f.stateMs < 90) return pick("crouch", 0)
      return pick("crouch", 1 + (Math.floor(nowMs / 520) % 2))
    case "walk":
      return pick("walk", Math.floor(f.animationMs / 110) % 4)
    case "attack": {
      const move = f.move
      if (!move) return pick("idle", 0)
      // Bernard owns dedicated art for every borrowed power. Select by ID
      // so the original fighters retain their existing animation cadence.
      if (f.id === "bernard") {
        const i = swingIndex(move, f.moveMs)
        switch (move.id) {
          case "bernard-special": return pick("specialScan", i)
          case "bernard-dash": return pick("specialCharge", i)
          case "bernard-ice": return pick("specialIce", f.moveMs < BEAR_WINDUP ? 0 : f.moveMs < move.startup ? 1 : i)
          case "bernard-circle": return pick("specialCircle", i)
          case "bernard-orb": return pick("specialOrb", i)
          case "bernard-breaking-news":
            return pick("specialBreaking", f.moveMs < BREAKING_NEWS_LEAP_MS ? 0 : f.moveMs < move.startup ? 1 : i)
        }
      }
      if (move.kind === "iceSlam") return pick("ranged", f.moveMs < BEAR_WINDUP ? 0 : f.moveMs < move.startup ? 1 : f.moveMs < move.startup + move.active ? 2 : 3)
      if (move.kind === "rain") return pick("specialUp", swingIndex(move, f.moveMs))
      if (move.kind === "orb") return pick("ranged", f.moveMs < move.startup ? 0 : 3)
      if (move.kind === "dash") {
        const rushing = !f.hitDone && f.special && Math.abs(f.x - f.special.originX) < (move.range ?? 720)
        return pick("ranged", f.moveMs < move.startup ? 0 : f.moveMs >= move.startup + move.active ? 3 : rushing ? 1 : 2)
      }
      const i = swingIndex(move, f.moveMs)
      if (move.kind === "circle" || move.kind === "beam") return pick("ranged", i)
      switch (moveFamily(move)) {
        case "punch": return pick(f.crouching ? "punchLow" : "punchHigh", i)
        case "kick": return pick("kickHigh", i)
        case "low": return pick("kickLow", i)
        case "air": return pick("kickHigh", i === 3 ? 2 : Math.max(1, i))
        case "dash": return pick("punchHigh", i === 0 ? 1 : i)
        case "projectile": return pick("ranged", i)
        case "uppercut": return f.y > 0 ? pick("punchHigh", 2) : pick("punchHigh", Math.min(i, 1))
        case "slam": return pick("punchLow", i)
      }
    }
    // falls through
    default:
      return pick("idle", Math.floor(f.animationMs / 180) % 4)
  }
}
