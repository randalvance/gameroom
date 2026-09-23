// Where a visitor's character appears. Shared client/server: the hub places
// a connecting visitor here, and a room with no hub places its one local
// visitor the same way, so single-player and multiplayer start from the same
// spot.

import { PARTICIPANT_TABLES } from "../../components/gameRoom/constants"
import { buildStaticColliders, nearestFreePoint, type Rect } from "./collision"

/**
 * North edge of the band visitors arrive in: clear of the last row of desks
 * and of the margin their colliders add. Derived from the room plan so it
 * follows the desks instead of having to be re-tuned behind them.
 */
const VISITOR_SPAWN_Y = Math.max(...PARTICIPANT_TABLES.map((tbl) => tbl.y + tbl.h)) + 48

/**
 * Where visitors appear: the open aisle at the south of the room, scattered
 * so simultaneous arrivals don't stack on one point. Plan px.
 *
 * That aisle is what a literal 440 used to mean, back when the room ended at
 * y=500. Deepening the room turned the same number into the middle of the
 * floor and then a row of desks grew over it, so visitors arrived inside a
 * table's collider, unable to walk out in any direction. The band now follows
 * the last row of desks, and is snapped to open floor regardless, so a future
 * layout change cannot wedge anyone again.
 */
export function visitorSpawnPoint(
  idx: number,
  colliders: readonly Rect[] = buildStaticColliders(),
): { x: number; y: number } {
  return nearestFreePoint(
    340 + ((idx * 53) % 140),
    VISITOR_SPAWN_Y + ((idx * 29) % 36),
    colliders,
  )
}
