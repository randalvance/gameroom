// The room's dimensions in world units, and the px → world mapping. Layout
// comes from the shared 2D room plan: 1 unit = 1 tile = 16 px.

import { CW, CH, PARTICIPANT_TABLES, TILE, WALL_Y } from "../../gameRoom/constants"

export const ROOM_W = CW / TILE // 50 units wide
export const ROOM_D = (CH - WALL_Y) / TILE // ~52 units deep
export const WALL_H = 13
/**
 * The desk rows (px), north to south. Rugs run in the aisles between them and
 * the warm ceiling pools sit over them, so both follow the plan wherever the
 * rows move — the room plan is the one place the grid is written down.
 */
export const TABLE_ROWS = [...new Set(PARTICIPANT_TABLES.map((t) => t.y))]
    .sort((a, b) => a - b)
    .map((y) => {
        const h = PARTICIPANT_TABLES.find((t) => t.y === y)!.h
        return { top: y, bottom: y + h, center: y + h / 2 }
    })

/** The desk columns' centres (px), west to east — one ceiling pool each. */
export const TABLE_COL_CENTERS = [
    ...new Set(PARTICIPANT_TABLES.map((t) => t.x + t.w / 2)),
].sort((a, b) => a - b)
/**
 * How far north of the front wall the tower's floor slab runs.
 *
 * Nothing is built out there any more — the front wall is solid screen from
 * the floor up, so a room behind it was polygons nobody could see. The apron
 * stays because it is what the skyline rings stand off from: shrinking it
 * would walk the city several units closer to the glass.
 */
export const NORTH_APRON = 7.9
export const toX = (px: number) => px / TILE - ROOM_W / 2
export const toZ = (py: number) => (py - WALL_Y) / TILE
