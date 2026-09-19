// What the interact button resolves to in the game room.
//
// Characters and the corner plants are compared as POINTS against a probe
// point ahead of the player (collision.ts's interactTarget). A desk is 88×48 —
// one centre point is unreachable from the desk's own edges, so a desk has to
// be tested as a rectangle.
//
// Desks were first added as a strict FALLBACK tier — only consulted when the
// point probe came back empty — to stop a desk swallowing the characters
// standing around it. The geometry defeated that: a player's legal standing
// spot is TABLE_INFLATE (12) + PLAYER_RADIUS (5) = 17px off the desk rect, and
// the idle cast wanders an orbit WALK_PAD = 18px off the SAME rect. The two
// rings coincide, so at any populated desk a teammate won the point probe
// essentially always and the desk was unreachable.
//
// So people are a TIE-BREAK, not an absolute tier: a desk wins when the probe
// point lands INSIDE its rectangle and no point candidate is within
// TABLE_TIEBREAK_PX of that probe point. Characters cannot stand on a tabletop,
// so an inside-the-rect probe point is never "at" a person; and a teammate you
// are nose-to-nose with still wins. Plants are point candidates too and get
// exactly the same treatment as characters.
//
// The scene uses this one function both to fire the interaction and to draw the
// proximity outline, so the outline can never promise something the button does
// not deliver.

import { PARTICIPANT_TABLES } from "../../components/gameRoom/constants"
import type { WalkDir } from "../../components/gameRoom/spriteIndex"
import { tableHasTeam } from "../../components/gameRoom3d/team-tables"
import {
  DIR_VEC,
  INTERACT_PROBE_PX,
  INTERACT_RANGE_PX,
  type ProbeCandidate,
  interactTarget,
} from "./collision"

export type RoomInteractTarget =
  | { kind: "probe"; key: number }
  | { kind: "table"; tableIdx: number }

/** A point candidate this close to the probe point keeps the desk from winning. */
const TABLE_TIEBREAK_PX = 12

/** Squared distance from a point to a rectangle; zero inside it. */
function distSqToRect(
  px: number,
  py: number,
  r: { x: number; y: number; w: number; h: number },
): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w))
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h))
  return dx * dx + dy * dy
}

export function resolveRoomInteract(
  self: { x: number; y: number; dir: WalkDir },
  candidates: readonly ProbeCandidate[],
  teamCount: number,
): RoomInteractTarget | null {
  const hit = interactTarget(self, candidates)

  const [vx, vy] = DIR_VEC[self.dir]
  const px = self.x + vx * INTERACT_PROBE_PX
  const py = self.y + vy * INTERACT_PROBE_PX
  let bestIdx: number | null = null
  let bestDist = INTERACT_RANGE_PX * INTERACT_RANGE_PX
  PARTICIPANT_TABLES.forEach((tbl, tableIdx) => {
    if (!tableHasTeam(tableIdx, teamCount)) return
    const d = distSqToRect(px, py, tbl)
    if (d <= bestDist) {
      bestDist = d
      bestIdx = tableIdx
    }
  })

  // Probe point on the tabletop, and nobody crowding it: the desk wins.
  if (bestIdx !== null && bestDist === 0) {
    const hitDistSq = hit ? (hit.x - px) ** 2 + (hit.y - py) ** 2 : Infinity
    if (hitDistSq > TABLE_TIEBREAK_PX * TABLE_TIEBREAK_PX) {
      return { kind: "table", tableIdx: bestIdx }
    }
  }

  if (hit) return { kind: "probe", key: hit.key }
  return bestIdx === null ? null : { kind: "table", tableIdx: bestIdx }
}
