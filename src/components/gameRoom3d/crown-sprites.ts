// The crowns, drawn.
//
// Seven small sprites: three egg tiers that share a shape and differ in metal,
// and four role markers that deliberately do NOT share it — a pair of scales
// must never be mistaken for "found everything", and a pointed crown must
// never be mistaken for "runs the event".
//
// Drawn into a canvas rather than loaded, so the room gains all seven without
// an asset, and every one is outlined in the same dark line so they read as
// one family from across the room.

import type { CrownKind } from "./crowns"

export const CROWN_KINDS: readonly CrownKind[] = [
  "bronze",
  "silver",
  "gold",
  "jewel",
  "scales",
  "compass",
  "eye",
]

export const CROWN_SPRITE_PX = 16

export interface CrownPalette {
  body: string
  shade: string
  trim: string
  outline: string
}

const OUTLINE = "#241703"

const PALETTES: Record<CrownKind, CrownPalette> = {
  // The egg tiers: one shape, three metals.
  bronze: { body: "#CE7B3C", shade: "#A0562A", trim: "#F0A868", outline: OUTLINE },
  silver: { body: "#D8DEE9", shade: "#A7B0C0", trim: "#FFFFFF", outline: OUTLINE },
  gold: { body: "#FFD23F", shade: "#E0A81F", trim: "#FF7BAC", outline: OUTLINE },
  // The roles: each its own silhouette.
  jewel: { body: "#FF4D6A", shade: "#B3183A", trim: "#FFFFFF", outline: OUTLINE },
  scales: { body: "#E8D27A", shade: "#B2913B", trim: "#FFF3C4", outline: OUTLINE },
  compass: { body: "#4C5BC4", shade: "#33409A", trim: "#F2E8CE", outline: OUTLINE },
  eye: { body: "#FFFFFF", shade: "#7BD4FF", trim: "#2A3460", outline: OUTLINE },
}

export function crownPalette(kind: CrownKind): CrownPalette {
  return PALETTES[kind]
}

type Ctx = CanvasRenderingContext2D

/** Draw one crown into a 16x16 canvas. */
export function drawCrown(ctx: Ctx, kind: CrownKind): void {
  const paint = crownPalette(kind)
  const box = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill
    ctx.fillRect(x, y, w, h)
  }
  switch (kind) {
    case "bronze": return drawTierCrown(box, paint, 2, false)
    case "silver": return drawTierCrown(box, paint, 3, false)
    case "gold": return drawTierCrown(box, paint, 3, true)
    case "jewel": return drawJewel(box, paint)
    case "scales": return drawScales(box, paint)
    case "compass": return drawCompass(box, paint)
    case "eye": return drawEye(box, paint)
  }
}

type Box = (x: number, y: number, w: number, h: number, fill: string) => void

/**
 * The egg crown: a band with `points` spikes, and a jewel on the middle one
 * for the full set. Points are how the tier reads at a distance — metal alone
 * blurs into metal, and a colour-blind viewer gets nothing from it.
 */
function drawTierCrown(box: Box, paint: CrownPalette, points: number, jewel: boolean) {
  box(2, 7, 12, 6, paint.outline)
  box(3, 8, 10, 4, paint.body)
  box(3, 11, 10, 1, paint.shade)
  // Spread so the points stay separate: touching spikes read as one block and
  // the tier stops being countable, which is the whole job of the shape.
  const xs = points === 2 ? [3, 10] : [2, 6, 11]
  for (const x of xs) {
    box(x, 3, 3, 5, paint.outline)
    box(x + 1, 4, 1, 4, paint.body)
  }
  if (jewel) box(7, 8, 2, 2, paint.trim)
}

/**
 * Admin: a cut jewel, floating.
 *
 * Grand, which is the point — the people running the event should be findable
 * across a crowded room — without borrowing the crown silhouette, which here
 * means "found the eggs" and must not be muddled with "runs the place".
 * Ruby rather than the admin's gold halo, so it cannot be mistaken for the gold
 * crown either — and red carries furthest against the room's dark blue.
 */
function drawJewel(box: Box, paint: CrownPalette) {
  /** Half a diamond, top down: [y, x, width], mirrored below the widest row. */
  const upper: Array<[number, number, number]> = [
    [3, 7, 2], [4, 6, 4], [5, 5, 6], [6, 4, 8], [7, 3, 10],
  ]
  const lower: Array<[number, number, number]> = [
    [8, 3, 10], [9, 4, 8], [10, 5, 6], [11, 6, 4], [12, 7, 2],
  ]
  for (const [y, x, w] of [...upper, ...lower]) {
    box(x - 1, y, w + 2, 1, paint.outline)
    box(x, y, w, 1, paint.body)
    // The right half is the shaded face, which is what makes it look cut.
    box(x + Math.ceil(w / 2), y, Math.floor(w / 2), 1, paint.shade)
  }
  // The table facet across the top, and a catchlight on the near face.
  box(5, 6, 6, 1, paint.trim)
  box(5, 8, 1, 2, paint.trim)
  // A twinkle off the top corner.
  box(12, 2, 1, 1, paint.trim)
  box(11, 1, 1, 1, paint.trim)
  box(13, 1, 1, 1, paint.trim)
  box(12, 0, 1, 1, paint.trim)
}

/**
 * A 16x16 row table, one character a pixel, painted through `legend`. Art this
 * detailed is unreadable as a list of rectangles — the shape has to be visible
 * in the source, or nobody can adjust a pixel of it later.
 */
function paintRows(box: Box, rows: readonly string[], legend: Record<string, string>) {
  rows.forEach((row, y) => {
    for (const [x, ch] of [...row].entries()) {
      const fill = legend[ch]
      if (fill) box(x, y, 1, 1, fill)
    }
  })
}

/**
 * Judge: a pair of balance scales.
 *
 * Symmetric to the pixel, which is the whole idea — a balance that hangs
 * heavier on one side reads as a verdict already reached. The post is solid
 * from beam to foot so the silhouette holds together at a distance, where the
 * trays are only a few pixels each.
 */
function drawScales(box: Box, paint: CrownPalette) {
  paintRows(box, [
    "................",
    "......oooo......",
    "......oppo......",
    ".oooooooooooooo.",
    ".occcccccccccco.",
    "..o...occo...o..",
    "occco.occo.occco",
    ".ooo..occo..ooo.",
    "......occo......",
    "......occo......",
    "......occo......",
    "......occo......",
    "......occo......",
    ".....occcco.....",
    "...occcccccco...",
    "...oooooooooo...",
  ], { o: paint.outline, c: paint.body, s: paint.shade, p: paint.trim })
}

/**
 * Mentor: a compass, lid open, needle settled.
 *
 * A guide's instrument rather than a scholar's — the mentors here point a team
 * at a direction, they do not mark it. The cream face carries the whole
 * silhouette at a distance; the needle is only legible up close, which is the
 * right way round for a marker worn above a head.
 */
function drawCompass(box: Box, paint: CrownPalette) {
  paintRows(box, [
    "......occo......",
    "....oooccooo....",
    "...ooccccccoo...",
    "..oocccppcccoo..",
    ".ooccppppppccoo.",
    ".occppppppppcco.",
    ".occpppppsppcco.",
    ".ocppppssppppco.",
    ".ocpppsssppppco.",
    ".occpsspppppcco.",
    ".occpsppppppcco.",
    ".ooccppppppccoo.",
    "..oocccppcccoo..",
    "...ooccccccoo...",
    "....oooooooo....",
    "................",
  ], { o: paint.outline, c: paint.body, s: paint.shade, p: paint.trim })
}

/**
 * Viewer: an open eye, for whoever is here to watch.
 *
 * Wide and horizontal, so it cannot be confused with anything else worn here —
 * the binoculars it replaces were two tall barrels side by side, which at this
 * size read as a pair of trousers.
 */
function drawEye(box: Box, paint: CrownPalette) {
  /** The almond, widening to the middle: [y, x, width]. */
  const lid: Array<[number, number, number]> = [
    [5, 5, 6], [6, 3, 10], [7, 2, 12], [8, 2, 12], [9, 3, 10], [10, 5, 6],
  ]
  for (const [y, x, w] of lid) box(x - 1, y, w + 2, 1, paint.outline)
  for (const [y, x, w] of lid) box(x, y, w, 1, paint.body)
  // The iris, with a dark pupil and a catchlight.
  box(6, 6, 4, 4, paint.shade)
  box(6, 7, 4, 2, paint.shade)
  box(7, 7, 2, 2, paint.trim)
  box(7, 6, 1, 1, paint.body)
  // A brow above it, which is what turns a shape into a face. Centred on the
  // eye rather than on the tile, or it sits a pixel to one side.
  box(4, 3, 8, 1, paint.outline)
  box(3, 4, 1, 1, paint.outline)
  box(12, 4, 1, 1, paint.outline)
}
