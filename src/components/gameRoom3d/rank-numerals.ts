// The floating rank numeral over a team's desk, as pure geometry.
//
// Real extruded 3D digits, not a billboarded label — which means the shape has
// to come from somewhere. three ships FontLoader but no font: `three/examples/
// fonts/*.typeface.json` is not in the published package, so a TextGeometry
// numeral would mean carrying a typeface file into the bundle for a handful of
// glyphs.
//
// Instead the glyphs are a 3×5 pixel font, and each lit pixel becomes one
// extruded block. That is a few dozen boxes per numeral, needs no asset, and
// the blocky result is the room's own pixel-art idiom in three dimensions.
//
// IT IS AN ORDINAL, NOT A NUMBER. A bare "3" floating over a desk whose plate
// reads "TEAM 03" is indistinguishable from the team's own name — the first
// version of this had exactly that problem. "3RD" cannot be read as anything
// but a placing, so the suffix rides above the digits as a superscript.
//
// This module is deliberately three-free: it hands out cell centres on a unit
// grid, already centred on the origin, so the scene only has to extrude them.

/** Lit pixels per digit, top row first. Read them and you can see the shapes. */
export const DIGIT_ROWS: readonly (readonly string[])[] = [
  ["111", "101", "101", "101", "111"], // 0
  ["010", "110", "010", "010", "111"], // 1
  ["111", "001", "111", "100", "111"], // 2
  ["111", "001", "111", "001", "111"], // 3
  ["101", "101", "111", "001", "001"], // 4
  ["111", "100", "111", "001", "111"], // 5
  ["111", "100", "111", "101", "111"], // 6
  ["111", "001", "010", "010", "010"], // 7
  ["111", "101", "111", "101", "111"], // 8
  ["111", "101", "111", "001", "111"], // 9
]

/** The letters the ordinal suffixes need, and no others. */
export const LETTER_ROWS: Readonly<Record<string, readonly string[]>> = {
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
  N: ["101", "111", "111", "111", "101"],
  D: ["110", "101", "101", "101", "110"],
  R: ["111", "101", "111", "110", "101"],
  H: ["101", "101", "111", "101", "101"],
}

/** One glyph's box, in grid cells. */
export const GLYPH_WIDTH = 3
export const GLYPH_HEIGHT = 5
/** Blank cells between two glyphs, so "10" does not read as one wide glyph. */
const GLYPH_GAP = 1
/** How much smaller the suffix is than the digits — a true superscript. */
export const SUFFIX_SCALE = 0.55
/** Breathing room between the last digit and the suffix, in full-size cells. */
const SUFFIX_GAP = 0.7

/**
 * Podium colours, then one colour for the rest of the field. A fourth medal
 * shade would imply a distinction the standings do not make.
 */
export const RANK_COLORS = {
  gold: 0xffd24a,
  silver: 0xaec6e8,
  bronze: 0xd08a46,
  field: 0x54ffd8,
} as const

/** Which part of the numeral a block belongs to. */
export type RankCellKind = "digit" | "suffix"

/** A lit pixel: its centre and its edge length, both in grid cells. */
export interface RankNumeralCell {
  x: number
  y: number
  /** 1 for a digit, SUFFIX_SCALE for the suffix. */
  size: number
  kind: RankCellKind
}

export interface RankNumeralLayout {
  cells: RankNumeralCell[]
  /** The numeral's full extent in grid cells — the scene scales by these. */
  width: number
  height: number
}

/** ST, ND, RD or TH — with the teens, which every ordinal helper gets wrong. */
export function rankOrdinalSuffix(rank: number): string {
  // 11TH, 12TH, 13TH: the teens take TH whatever their last digit says.
  if (rank % 100 >= 11 && rank % 100 <= 13) return "TH"
  switch (rank % 10) {
    case 1:
      return "ST"
    case 2:
      return "ND"
    case 3:
      return "RD"
    default:
      return "TH"
  }
}

/** The lit pixels of one glyph, as offsets from its own top-left corner. */
function glyphCells(rows: readonly string[]): Array<{ col: number; row: number }> {
  const cells: Array<{ col: number; row: number }> = []
  rows.forEach((row, rowIdx) => {
    for (let col = 0; col < row.length; col++) {
      if (row[col] === "1") cells.push({ col, row: rowIdx })
    }
  })
  return cells
}

/**
 * Where to put the blocks for a placing, as "1ST" / "10TH". Ranks are 1-based
 * and two digits at most — anything outside 1..99 is a bug worth hearing about
 * rather than a numeral to draw badly.
 *
 * The podium wears nothing extra: 1st, 2nd and 3rd are the same shape as 4th,
 * in the medal colours `rankNumeralColor` gives them. A crown used to ride
 * above the digits and it was one ornament too many over a desk that already
 * carries a name plate — the colour already says who is on the podium.
 *
 * Laid out from an arbitrary corner and re-centred at the end, so the reported
 * box is the true one whatever the suffix does to it.
 */
export function rankNumeralCells(rank: number): RankNumeralLayout {
  if (!Number.isInteger(rank) || rank < 1 || rank > 99) {
    throw new Error(`rankNumeralCells: ${rank} is not a placing between 1 and 99`)
  }
  const digits = String(rank).split("").map(Number)
  const suffix = rankOrdinalSuffix(rank)
  const digitsWidth = digits.length * GLYPH_WIDTH + (digits.length - 1) * GLYPH_GAP
  const top = GLYPH_HEIGHT

  const cells: RankNumeralCell[] = []
  digits.forEach((digit, index) => {
    const originX = index * (GLYPH_WIDTH + GLYPH_GAP)
    for (const { col, row } of glyphCells(DIGIT_ROWS[digit]!)) {
      cells.push({
        x: originX + col + 0.5,
        // Row 0 is the TOP row, so y counts down from the cap height.
        y: top - (row + 0.5),
        size: 1,
        kind: "digit",
      })
    }
  })

  const suffixLeft = digitsWidth + SUFFIX_GAP
  suffix.split("").forEach((letter, index) => {
    const rows = LETTER_ROWS[letter]
    if (!rows) throw new Error(`rankNumeralCells: no glyph for "${letter}"`)
    const originX = suffixLeft + index * (GLYPH_WIDTH + GLYPH_GAP) * SUFFIX_SCALE
    for (const { col, row } of glyphCells(rows)) {
      cells.push({
        x: originX + (col + 0.5) * SUFFIX_SCALE,
        // Superscript: hung from the digits' cap height, so the suffix sits
        // over the top half of the numeral the way ordinals are set in print.
        y: top - (row + 0.5) * SUFFIX_SCALE,
        size: SUFFIX_SCALE,
        kind: "suffix",
      })
    }
  })

  // Re-centre on the true bounding box, block edges included.
  const left = Math.min(...cells.map((cell) => cell.x - cell.size / 2))
  const right = Math.max(...cells.map((cell) => cell.x + cell.size / 2))
  const bottom = Math.min(...cells.map((cell) => cell.y - cell.size / 2))
  const ceiling = Math.max(...cells.map((cell) => cell.y + cell.size / 2))
  const midX = (left + right) / 2
  const midY = (bottom + ceiling) / 2
  for (const cell of cells) {
    cell.x -= midX
    cell.y -= midY
  }

  return { cells, width: right - left, height: ceiling - bottom }
}

/** What colour a placing glows. */
export function rankNumeralColor(rank: number): number {
  switch (rank) {
    case 1:
      return RANK_COLORS.gold
    case 2:
      return RANK_COLORS.silver
    case 3:
      return RANK_COLORS.bronze
    default:
      return RANK_COLORS.field
  }
}

/** `0x54ffd8` → `"#54ffd8"`, keeping every one of the six digits. */
export function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`
}

/**
 * The same placing colour, for the 2D surfaces that cannot take a three
 * colour — today the wall screen's leaderboard cards, drawn on a canvas.
 * Derived from `rankNumeralColor` rather than written out again, so the desk
 * and the wall can never disagree about what second place looks like.
 */
export function rankNumeralCssColor(rank: number): string {
  return hexColor(rankNumeralColor(rank))
}
