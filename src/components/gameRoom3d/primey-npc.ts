// Primey, standing in the room.
//
// The mascot who floats in the corner of the marketing pages is also a
// character here: a billboard you can walk up to and press interact on, which
// opens the SAME chat panel the site's launcher opens. Nothing about the
// conversation is multiplayer — the answers come from /api/primey/stream, one
// visitor at a time — so, like the wall screen, Primey's interact key is
// PRIVATE: the scene swallows it and opens local UI rather than posting it to
// the hub.
//
// That is also why Primey is not in lib/gameRoomNet/objects.ts with the
// plants. Everything in that list is hub-owned (shared say-counts, range
// checks, bubbles the whole room sees); Primey is none of those things, and
// putting it there would hand the hub an object it would answer with the
// plants' line.

import { CH, CW, TILE, WALL_Y } from "../gameRoom/constants"

/**
 * Primey's interact key. Clear of both the hub's object range
 * (OBJECT_IDX_BASE = 100_000 + index) and the wall screen (200_000), so a key
 * that somehow escaped the scene would be an unknown idx rather than someone
 * else's target.
 */
export const PRIMEY_IDX = 300_000

/**
 * How wide one carpet tile is, in plan px. makeCarpetTexture draws four tiles
 * across a 128px texture that repeats every 8 world units, so a tile is two
 * world units — derived here rather than written as 32 so the floor and the
 * things standing on it cannot drift apart.
 */
const CARPET_TILE_PX = 2 * TILE

/**
 * The last carpet row that is a WHOLE tile. The room is 21.75 tiles deep, so
 * the row against the south wall is a sliver; this is the full row in front of
 * it — the second-to-last row you actually see on the floor.
 */
const SECOND_TO_LAST_ROW = Math.floor((CH - WALL_Y) / CARPET_TILE_PX) - 1

/**
 * Which tile column Primey stands in.
 *
 * Dead centre would be column 12, and it looked right — but the room's
 * arrivals scatter (guestSpawnPoint) covers x 340–479 on this very row, so
 * visitors were materialising inside the billboard. Worse than the look: a
 * character standing on Primey also SHADOWS him in the interact probe, which
 * takes the nearest candidate — a press meant for the chat panel would talk to
 * whoever happened to spawn there. Four columns east clears the scatter by
 * three tiles and still reads as the middle of the open floor.
 *
 * Pinned by a test against the hub's own spawn box, so moving the arrivals
 * band trips rather than quietly re-buries this.
 */
const PRIMEY_TILE_COLUMN = Math.floor(CW / 2 / CARPET_TILE_PX) + 4

/**
 * Where Primey stands, in room-plan px — the same space characters move in.
 *
 * Middle of the second-to-last row of floor tiles, in the open southern band
 * where visitors arrive, so you walk in facing the room's help rather than
 * having to go looking for it.
 */
export const PRIMEY_POINT = {
  x: (PRIMEY_TILE_COLUMN + 0.5) * CARPET_TILE_PX,
  y: WALL_Y + (SECOND_TO_LAST_ROW + 0.5) * CARPET_TILE_PX,
} as const

/**
 * The idle strip, straight from PrimeySprite's table — one row of `frames`
 * square cells. Only idle is used in the room: the other states are reactions
 * to a conversation the 3D scene does not follow.
 */
export const PRIMEY_STRIP = {
  url: "/assets/primey/primey-idle.png",
  frames: 21,
  /** Per-frame pace, the same 112ms the DOM sprite steps at. */
  frameMs: 112,
} as const

// The art is a 256px square cell with Primey drawn inside it; these are the
// alpha bounds of the tallest frame. Deriving the plane from them keeps the
// robot's FEET on the floor rather than the frame's empty bottom edge.
const FRAME_PX = 256
const BODY_TOP_PX = 12
const BODY_BOTTOM_PX = 244

/** How tall Primey itself stands, world units — a knee-high desk robot, well
 * under a character's 3.75. */
export const PRIMEY_BODY_HEIGHT = 2.4

const BODY_FRACTION = (BODY_BOTTOM_PX - BODY_TOP_PX) / FRAME_PX

/** The billboard plane the strip's cell is drawn on (square art, square cell). */
export function primeyPlaneSize(): { width: number; height: number } {
  const height = PRIMEY_BODY_HEIGHT / BODY_FRACTION
  return { width: height, height }
}

/**
 * Centre height of the plane, so the drawn feet land on y=0. The cell has
 * BODY_BOTTOM_PX..FRAME_PX of empty art below the feet, which has to hang
 * below the floor rather than lifting Primey off it.
 */
export function primeyCenterY(): number {
  const { height } = primeyPlaneSize()
  return height / 2 - height * ((FRAME_PX - BODY_BOTTOM_PX) / FRAME_PX)
}

/** Which cell of the strip is showing at `elapsedMs`. Loops forever. */
export function primeyFrame(elapsedMs: number): number {
  const step = Math.floor(Math.max(0, elapsedMs) / PRIMEY_STRIP.frameMs)
  return step % PRIMEY_STRIP.frames
}

/** Texture offset along the strip for that frame (repeat.x = 1/frames). */
export function primeyFrameOffset(elapsedMs: number): number {
  return primeyFrame(elapsedMs) / PRIMEY_STRIP.frames
}
