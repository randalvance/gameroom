// The ambient wander every uncontrolled character runs — extracted from
// gameRoom3d/scene.ts so the multiplayer hub can run the SAME simulation
// server-side. One implementation, two homes: the scene keeps it for rooms
// with no live session (the admin assignment view, a dropped stream), and the
// hub runs it for `/game-room` so every connected client sees the identical
// idle cast.
//
// Pure and DOM-free on purpose: state in, state out, deterministic for a given
// seed and step count.

import { PARTICIPANT_TABLES } from "../../components/gameRoom/constants"
import { WALK_PAD, walkPos, type WalkStep } from "../../components/gameRoom3d/walk-path"

/**
 * Overall pace of the wandering cast — 1 is the original gait. Scales the walk
 * cycle and the distance covered TOGETHER, so a slower room still lands one
 * stride per animation frame instead of moonwalking.
 */
export const WALK_SPEED = 0.8

export interface WanderState {
  phase: number
  speed: number
  pauseLeft: number
  rng: number
}

/** The seeds the scene has always used, so the cast keeps its personality. */
export function seedWander(playerIdx: number, teamIdx: number, seatIdx: number): WanderState {
  return {
    phase: seatIdx * 30 + teamIdx * 7,
    speed: (0.28 + (playerIdx % 7) * 0.02) * WALK_SPEED * (playerIdx % 3 === 0 ? -1 : 1),
    pauseLeft: (playerIdx * 7) % 25,
    rng: (playerIdx * 1664525 + 1013904223) & 0x7fffffff,
  }
}

/**
 * One 60 Hz step of a character's aimless orbit of its table. Mutates the
 * state. The pause lengths and roll odds are tuned against the fixed clock —
 * see gameRoom3d/sim-clock.ts.
 */
export function stepWander(w: WanderState): void {
  if (w.pauseLeft > 0) {
    w.pauseLeft--
    return
  }
  w.phase += w.speed
  w.rng = (w.rng * 1664525 + 1013904223) & 0x7fffffff
  if ((w.rng & 0xff) < 1) w.pauseLeft = 30 + ((w.rng >> 8) & 0x3f)
  if ((w.rng & 0x3ff) < 1) w.speed = -w.speed
}

/** Where the wanderer stands right now, in room-plan px space. */
export function wanderPos(w: WanderState, teamIdx: number): WalkStep | null {
  const tbl = PARTICIPANT_TABLES[teamIdx]
  if (!tbl) return null
  return walkPos(w.phase, tbl, w.speed)
}

/**
 * The orbit phase whose position is closest to `(x, y)` — how a character
 * whose player disconnects re-enters the lap from wherever they wandered off
 * to, instead of teleporting back to where they left it.
 */
export function phaseForPos(x: number, y: number, teamIdx: number): number {
  const tbl = PARTICIPANT_TABLES[teamIdx]
  if (!tbl) return 0
  const x0 = tbl.x - WALK_PAD, y0 = tbl.y - WALK_PAD
  const x1 = tbl.x + tbl.w + WALK_PAD, y1 = tbl.y + tbl.h + WALK_PAD
  const dw = x1 - x0, dh = y1 - y0
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  // Candidate phases: the projection of the point onto each of the four edges,
  // in the same parameterisation walkPos uses (top → right → bottom → left).
  const candidates: Array<{ p: number; px: number; py: number }> = [
    { p: clamp(x - x0, 0, dw), px: clamp(x, x0, x1), py: y0 },
    { p: dw + clamp(y - y0, 0, dh), px: x1, py: clamp(y, y0, y1) },
    { p: dw + dh + clamp(x1 - x, 0, dw), px: clamp(x, x0, x1), py: y1 },
    { p: 2 * dw + dh + clamp(y1 - y, 0, dh), px: x0, py: clamp(y, y0, y1) },
  ]
  let best = candidates[0]!
  let bestDist = Infinity
  for (const c of candidates) {
    const d = (c.px - x) ** 2 + (c.py - y) ** 2
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best.p
}
