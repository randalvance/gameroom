// The loop a character walks around its team's table, in the 2D room plan's
// pixel space (the caller maps it into world units).
//
// Facing follows the direction of TRAVEL, not merely which edge of the loop the
// character stands on. Half the cast orbits anticlockwise — `speed` is negative
// for every third player, and any character can reverse at random — and reading
// the facing off the edge alone pointed those sprites the way they had come:
// they moonwalked their whole lap.

import type { WalkDir } from "../gameRoom/spriteIndex"

/** px, orbit distance around each table. */
export const WALK_PAD = 18

export interface TableBounds {
  x: number
  y: number
  w: number
  h: number
}

export interface WalkStep {
  x: number
  y: number
  dir: WalkDir
}

/** Turn a facing around: 0 up, 1 right, 2 down, 3 left. */
export function opposite(dir: WalkDir): WalkDir {
  return ((dir + 2) % 4) as WalkDir
}

/**
 * The facing that shows a character's FRONT. The camera sits at greater z and
 * looks back down the room, so "down" the room plan is towards the viewer —
 * both sheet layouts draw their front-facing row for it. Anyone standing
 * around rather than walking a lap should use this; the default 0 is the
 * back of the head.
 */
export const FACING_CAMERA: WalkDir = 2

/**
 * Where a character stands at `phase` px along its table's loop, and which way
 * it faces getting there. `travel` is the sign of its speed: negative walks the
 * same loop the other way round.
 */
export function walkPos(phase: number, tbl: TableBounds, travel = 1): WalkStep {
  const x0 = tbl.x - WALK_PAD, y0 = tbl.y - WALK_PAD
  const x1 = tbl.x + tbl.w + WALK_PAD, y1 = tbl.y + tbl.h + WALK_PAD
  const dw = x1 - x0, dh = y1 - y0, perim = 2 * (dw + dh)
  const p = ((phase % perim) + perim) % perim
  const step = ((): WalkStep => {
    if (p < dw) return { x: x0 + p, y: y0, dir: 1 }
    if (p < dw + dh) return { x: x1, y: y0 + (p - dw), dir: 2 }
    if (p < 2 * dw + dh) return { x: x1 - (p - dw - dh), y: y1, dir: 3 }
    return { x: x0, y: y1 - (p - 2 * dw - dh), dir: 0 }
  })()
  return travel < 0 ? { ...step, dir: opposite(step.dir) } : step
}
