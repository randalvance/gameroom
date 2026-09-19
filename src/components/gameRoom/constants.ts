export const CW = 800
export const CH = 778
export const WALL_Y = 82
export const TILE = 16

const TBL_W = 88, TBL_H = 48
// Five desks per row, evenly margined across the room's width. The pitch is
// tighter than the old four-across grid but still leaves a walking lane
// between neighbouring desks' chairs.
const COL_XS = [40, 198, 356, 514, 672]
// Three rows of desks, sitting a tile further south than they used to so the
// floor above the first row and the open floor below the last are the same
// depth. That clear southern band is not spare room — it is where visitors
// arrive and mingle, so nobody spawns on top of a desk.
const ROW_YS = [206, 406, 606]

/**
 * How many desks the room lays out: thirteen, filled row-major, so the last
 * row is short of the grid's five. The room's furniture does not follow the
 * roster — an event with fewer teams simply leaves the tail desks empty (see
 * `tableHasTeam`) — so this is a room-plan decision, not a headcount.
 */
const TABLE_COUNT = 13

export const PARTICIPANT_TABLES = ROW_YS.flatMap((y) =>
  COL_XS.map((x) => ({ x, y, w: TBL_W, h: TBL_H })),
).slice(0, TABLE_COUNT)
