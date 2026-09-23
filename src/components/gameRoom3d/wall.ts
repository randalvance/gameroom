// The wall screen: what it shows, and how the room finds it.
//
// The wall has one page and one interruption. The page is a BOARD the host
// supplies — a title and a few lines — and the interruption is a BULLETIN, a
// short text that takes the wall for a hold and then hands it back. Both are
// plain data; the scene paints them onto the screen's canvas.

import { CW } from "../gameRoom/constants"

/** The wall's resting page. */
export interface RoomBoard {
  /** The headline. Absent, the room's own title is used. */
  title?: string
  /** Up to three lines under it; anything past that is not drawn. */
  lines: readonly string[]
}

/** How many lines of the board the wall can carry legibly. */
export const BOARD_MAX_LINES = 3

/**
 * The screen's interact key. Deliberately clear of the hub's object range
 * (OBJECT_IDX_BASE + index into ROOM_OBJECTS): the scene swallows this key
 * instead of posting it, and if it ever did reach the hub it would be answered
 * as an unknown object rather than as a plant.
 */
export const BIG_SCREEN_IDX = 200_000

/**
 * Where the interact probe finds the screen, in room-plan px.
 *
 * The screen itself spans the whole front wall, but a target is a point, and
 * that point has to be one a player can stand under: dead centre under a
 * screen that is centred on the same line.
 */
export const BIG_SCREEN_POINT = {
  x: CW / 2,
  y: 90,
} as const
