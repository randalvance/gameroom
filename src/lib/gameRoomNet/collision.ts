// Static collision for player-controlled characters, in the 2D room plan's
// pixel space (the same space PARTICIPANT_TABLES and walk-path.ts use).
//
// The player is treated as a point; every collider is pre-inflated by the
// character's footprint radius, so the movement test is a plain
// point-in-rect. Colliders are inflated LESS than WALK_PAD (18 px, the orbit
// distance wanderers keep from their tables) so a controlled character can
// walk every lane the idle cast walks.
//
// Shared client/server: the scene integrates local movement against these for
// zero-latency controls, and the hub validates reported positions against the
// same rects — one geometry, no drift.

import { CW, CH, WALL_Y, PARTICIPANT_TABLES } from "../../components/gameRoom/constants"
import type { WalkDir } from "../../components/gameRoom/spriteIndex"

/** Half-width of a character's feet, px. Colliders are inflated by this. */
export const PLAYER_RADIUS = 5

/** Controlled walking pace, px per 60 Hz sim step (~105 px/s). */
export const PLAYER_SPEED_PX_PER_STEP = 1.75

/** How far ahead of the character's facing the interact probe reaches, px. */
export const INTERACT_PROBE_PX = 22
/** A character within this distance of the probe point is the target, px. */
export const INTERACT_RANGE_PX = 20

/** Keeps characters off the walls and inside the carpet. The outermost wander
 * orbit passes 22 px from the side walls (table 0 at x=40, WALK_PAD 18), so
 * the side margins must stay inside that. */
export const ROOM_BOUNDS = {
  minX: 6,
  maxX: CW - 6,
  minY: WALL_Y + 14,
  maxY: CH - 8,
} as const

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** How far outside its plan rect a participant table blocks movement. */
const TABLE_INFLATE = 12

function inflate(r: Rect, by: number): Rect {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by }
}

/** The static colliders, already inflated by the player's footprint radius. */
export function buildStaticColliders(): Rect[] {
  const rects: Rect[] = []
  for (const tbl of PARTICIPANT_TABLES) {
    rects.push(inflate(
      { x0: tbl.x, y0: tbl.y, x1: tbl.x + tbl.w, y1: tbl.y + tbl.h },
      TABLE_INFLATE + PLAYER_RADIUS,
    ))
  }
  return rects
}

export function pointBlocked(x: number, y: number, colliders: readonly Rect[]): boolean {
  if (x < ROOM_BOUNDS.minX || x > ROOM_BOUNDS.maxX) return true
  if (y < ROOM_BOUNDS.minY || y > ROOM_BOUNDS.maxY) return true
  for (const r of colliders) {
    if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true
  }
  return false
}

/**
 * The nearest spot to (x, y) a character can actually stand.
 *
 * Spawn points are written as plain coordinates while the furniture around
 * them moves. When the desk grid last changed, the visitors' spawn band came
 * to rest inside a table's collider, and everyone who walked in arrived
 * unable to move in any direction. Re-tuning the literal fixes it until the
 * next layout change; snapping to open floor fixes it for good.
 *
 * Rings outward from the wanted point and takes the first free sample, so a
 * spawn that is already clear is returned untouched and a blocked one lands
 * just outside whatever it was stuck in.
 */
export function nearestFreePoint(
  x: number,
  y: number,
  colliders: readonly Rect[],
): { x: number; y: number } {
  if (!pointBlocked(x, y, colliders)) return { x, y }
  const STEP = 8
  const SAMPLES = 16
  // Far enough to escape a table collider from dead centre, with room over.
  for (let ring = 1; ring <= 40; ring++) {
    for (let i = 0; i < SAMPLES; i++) {
      const angle = (i / SAMPLES) * Math.PI * 2
      const px = x + Math.cos(angle) * ring * STEP
      const py = y + Math.sin(angle) * ring * STEP
      if (!pointBlocked(px, py, colliders)) return { x: px, y: py }
    }
  }
  // A room with no standing room at all is a layout bug, not a spawn bug —
  // hand back what was asked for rather than a position from nowhere.
  return { x, y }
}

export interface MoveResult {
  x: number
  y: number
  moved: boolean
}

/**
 * One sim step of movement. Axis-separated so walking diagonally into a table
 * edge slides along it instead of sticking: each axis applies independently
 * and is simply cancelled if it would land inside a collider.
 */
export function movePlayer(
  x: number,
  y: number,
  dx: number,
  dy: number,
  colliders: readonly Rect[],
): MoveResult {
  let nx = x
  let ny = y
  if (dx !== 0 && !pointBlocked(nx + dx, ny, colliders)) nx += dx
  if (dy !== 0 && !pointBlocked(nx, ny + dy, colliders)) ny += dy
  return { x: nx, y: ny, moved: nx !== x || ny !== y }
}

/**
 * Facing for a movement input. Horizontal wins ties so strafing diagonals read
 * as the sideways rows (the sheets' side sprites carry the most motion).
 * `null` input (standing still) keeps the previous facing.
 */
export function facingForInput(dx: number, dy: number, previous: WalkDir): WalkDir {
  if (dx === 0 && dy === 0) return previous
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 1 : 3
  return dy > 0 ? 2 : 0
}

/** Unit facing vector per walk direction. Shared so every consumer of the
 * interact probe computes the SAME probe point. */
export const DIR_VEC: Record<WalkDir, readonly [number, number]> = {
  0: [0, -1],
  1: [1, 0],
  2: [0, 1],
  3: [-1, 0],
}

export interface ProbeCandidate {
  /** Caller's own key for the character — playerIdx client-side, idx on the hub. */
  key: number
  x: number
  y: number
}

/**
 * Who an interact press lands on: the character nearest the point one probe
 * length ahead of the facing, if any is within range. Later this grows object
 * candidates too — anything with a key and a plan position can be a target.
 */
export function interactTarget(
  self: { x: number; y: number; dir: WalkDir },
  candidates: readonly ProbeCandidate[],
): ProbeCandidate | null {
  const [vx, vy] = DIR_VEC[self.dir]
  const px = self.x + vx * INTERACT_PROBE_PX
  const py = self.y + vy * INTERACT_PROBE_PX
  let best: ProbeCandidate | null = null
  let bestDist = INTERACT_RANGE_PX * INTERACT_RANGE_PX
  for (const c of candidates) {
    const d = (c.x - px) ** 2 + (c.y - py) ** 2
    if (d <= bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}
