// Touch-screen controls for the 3D game room.
//
// Phones have no WASD, no scroll wheel and no hover, so the room gets a game
// console overlay instead: a D-pad (lower left) and an interact button (lower
// right). While the local player controls a character the pad walks them and
// the button talks, exactly like WASD and Space; for a spectator the pad pans
// the camera and the button selects what the view is centred on. The pick
// logic lives here, apart from the scene, so it can be tested without
// three.js.

import type { RoomSelection } from "./selection"

/** Cadence of a held D-pad button while panning. One press = one ROOM_CAMERA_PAN_STEP. */
export const TOUCH_PAN_REPEAT_MS = 120

/**
 * How far (in world units) the interact button reaches from the centre of the
 * view. Tables sit roughly 12 units apart, so this grabs the one you panned
 * to without ever grabbing its neighbour.
 */
export const TOUCH_INTERACT_MAX_DIST = 6

/** The camera's zoom bounds — the same fit/max the wheel and +/− keys clamp to. */
export const TOUCH_PINCH_MIN_ZOOM = 1
export const TOUCH_PINCH_MAX_ZOOM = 2.4

/**
 * Where a pinch lands the camera zoom: the spread between the two fingers,
 * relative to where the gesture started, scales the zoom the gesture started
 * at. Re-derived from the gesture's origin on every move (like the pan drag)
 * so per-frame rounding cannot accumulate.
 */
export function pinchZoom(
  zoomAtStart: number,
  startDist: number,
  currentDist: number,
): number {
  const clamp = (zoom: number) =>
    Math.min(TOUCH_PINCH_MAX_ZOOM, Math.max(TOUCH_PINCH_MIN_ZOOM, zoom))
  // A degenerate spread (fingers stacked on one point) scales nothing.
  if (startDist <= 0 || currentDist <= 0) return clamp(zoomAtStart)
  return clamp(zoomAtStart * (currentDist / startDist))
}

export interface TouchPickTargets {
  chars: { selection: RoomSelection; x: number; z: number }[]
  tables: { tableIdx: number; x: number; z: number }[]
}

/**
 * What the spectator's interact button lands on: whatever is nearest the
 * given floor point, character or table, within TOUCH_INTERACT_MAX_DIST. A
 * character wins a tie because it is the smaller target — if the two read as
 * equally close, the player was aiming at the person.
 */
export function pickNearestToPoint(
  point: { x: number; z: number },
  targets: TouchPickTargets,
  maxDist: number = TOUCH_INTERACT_MAX_DIST,
): RoomSelection {
  let best: RoomSelection = null
  let bestDist = maxDist
  for (const table of targets.tables) {
    const dist = Math.hypot(table.x - point.x, table.z - point.z)
    if (dist <= bestDist) {
      best = { type: "desk", idx: table.tableIdx }
      bestDist = dist
    }
  }
  for (const char of targets.chars) {
    const dist = Math.hypot(char.x - point.x, char.z - point.z)
    if (dist <= bestDist) {
      best = char.selection
      bestDist = dist
    }
  }
  return best
}
