import type { SheetFormat } from "../gameRoom/spriteIndex"
import { SPRITE_CELL_H, SPRITE_CELL_W } from "~/lib/sprite-gen"

// How the room turns a sheet cell into world units, and everything that has to
// move when that changes. The offsets below used to be literals (1.26, -1.24,
// 3.05 …) all silently derived from a 2.5-unit-tall character; deriving them
// here means resizing the cast keeps feet on the floor and name tags overhead.

/** A character stood 2.5 world units tall at the room's original art scale. */
const BASE_CHARACTER_HEIGHT = 2.5

/** How much taller characters stand than that original art scale. */
export const CHARACTER_SCALE = 1.5

/**
 * How tall a standing character is, in world units — FIXED, and deliberately
 * NOT derived from the cell's pixel height.
 *
 * This used to be pixels × a constant, which quietly tied the cast's on-screen
 * size to the sheet format. When cells went 32×32 → 32×48 the whole room grew
 * by half again, because taller art was being read as a taller PERSON rather
 * than as more detail in the same person. Pinning the height and deriving the
 * width from the cell's aspect keeps the art undistorted and makes the next
 * cell-size change a no-op for the room's composition.
 */
export const CHARACTER_WORLD_HEIGHT = BASE_CHARACTER_HEIGHT * CHARACTER_SCALE

/** Keeps a sprite plane's bottom edge off the floor rather than z-fighting it. */
const FLOOR_CLEARANCE = 0.01

/** How far under the feet the contact-shadow blob sits. */
const SHADOW_CLEARANCE = 0.02

type CellSize = Pick<SheetFormat, "cellW" | "cellH">

/**
 * The plane a sheet's cell is drawn on: a fixed standing height, with the
 * width following the cell's aspect ratio so the art is never stretched.
 * Every sheet therefore stands the same height regardless of its cell size.
 */
export function characterPlaneSize(format: CellSize): { width: number; height: number } {
  // Guard the divisor: a texture that failed to decode reports a 0-size cell,
  // and an Infinity-wide plane is a much worse failure than a wrong-looking one.
  const unitsPerPx = CHARACTER_WORLD_HEIGHT / Math.max(1, format.cellH)
  return {
    width: format.cellW * unitsPerPx,
    height: CHARACTER_WORLD_HEIGHT,
  }
}

/** Centre height of a standing character — the plane is centred on its origin. */
export function characterGroundY(format: CellSize): number {
  return characterPlaneSize(format).height / 2 + FLOOR_CLEARANCE
}

/** World height of the top of a standing character's head. */
export function characterTopY(format: CellSize): number {
  return characterPlaneSize(format).height + FLOOR_CLEARANCE
}

/** Height of the contact shadow in the character mesh's own local space. */
export function characterShadowLocalY(format: CellSize): number {
  return -(characterGroundY(format) - SHADOW_CLEARANCE)
}

/** The cell every shipped and generated sheet uses. */
const NOMINAL_CELL: CellSize = { cellW: SPRITE_CELL_W, cellH: SPRITE_CELL_H }

/**
 * Head height of a typical character. Scenery that has to clear the cast (the
 * floating team labels, which are depth-tested and so are occluded by anyone
 * standing in front of them) hangs off this rather than off any one character.
 */
export const NOMINAL_CHARACTER_TOP_Y = characterTopY(NOMINAL_CELL)

/**
 * How much room one character takes up. What anything ARRANGING characters
 * should space them by — a layout that spaces them in bare world units goes
 * stale the moment CHARACTER_SCALE moves, which is how the arrivals lobby
 * ended up packing 3.75-unit-wide students 1.5 units apart.
 */
export const NOMINAL_CHARACTER_SIZE = characterPlaneSize(NOMINAL_CELL)
