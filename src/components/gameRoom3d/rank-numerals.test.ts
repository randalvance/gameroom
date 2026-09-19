import { describe, expect, it } from "vitest"
import {
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  rankNumeralCells,
  rankNumeralColor,
  rankNumeralCssColor,
  hexColor,
  rankOrdinalSuffix,
  DIGIT_ROWS,
  LETTER_ROWS,
  RANK_COLORS,
  SUFFIX_SCALE,
} from "./rank-numerals"

describe("ordinal suffix", () => {
  // The suffix is the whole reason the numeral reads as a placing: a desk
  // labelled "TEAM 03" under a bare 3 reads as a repeat of its own name, and
  // no team is called "3RD".
  it("follows the ordinary English rules", () => {
    expect(rankOrdinalSuffix(1)).toBe("ST")
    expect(rankOrdinalSuffix(2)).toBe("ND")
    expect(rankOrdinalSuffix(3)).toBe("RD")
    expect(rankOrdinalSuffix(4)).toBe("TH")
    expect(rankOrdinalSuffix(9)).toBe("TH")
  })

  it("says ELEVENTH, not ELEVENST", () => {
    // The teens are the exception every ordinal helper gets wrong. The room
    // has ten desks today, but the standings are per team, not per desk.
    expect(rankOrdinalSuffix(11)).toBe("TH")
    expect(rankOrdinalSuffix(12)).toBe("TH")
    expect(rankOrdinalSuffix(13)).toBe("TH")
    expect(rankOrdinalSuffix(21)).toBe("ST")
    expect(rankOrdinalSuffix(22)).toBe("ND")
    expect(rankOrdinalSuffix(23)).toBe("RD")
  })
})

describe("rank numeral cells", () => {
  it("draws the digit at full size and the suffix above it, smaller", () => {
    const { cells, height } = rankNumeralCells(4)
    expect(height).toBe(GLYPH_HEIGHT)
    const digitCells = cells.filter((cell) => cell.kind === "digit")
    const suffixCells = cells.filter((cell) => cell.kind === "suffix")
    expect(digitCells.length).toBeGreaterThan(0)
    expect(suffixCells.length).toBeGreaterThan(0)
    for (const cell of digitCells) expect(cell.size).toBe(1)
    for (const cell of suffixCells) expect(cell.size).toBeCloseTo(SUFFIX_SCALE)
    // Superscript: the suffix hangs off the top of the digit, never below it.
    const digitTop = Math.max(...digitCells.map((cell) => cell.y))
    const suffixBottom = Math.min(...suffixCells.map((cell) => cell.y))
    expect(suffixBottom).toBeGreaterThan(Math.min(...digitCells.map((cell) => cell.y)))
    expect(Math.max(...suffixCells.map((cell) => cell.y))).toBeLessThanOrEqual(digitTop + 0.5)
  })

  it("puts the suffix to the RIGHT of the digits, as an ordinal reads", () => {
    const { cells } = rankNumeralCells(10)
    const digitRight = Math.max(...cells.filter((c) => c.kind === "digit").map((c) => c.x))
    const suffixLeft = Math.min(...cells.filter((c) => c.kind === "suffix").map((c) => c.x))
    expect(suffixLeft).toBeGreaterThan(digitRight)
  })

  it("gives the podium no ornament the rest of the field lacks", () => {
    // 1st, 2nd and 3rd used to wear a crown. It came off: the medal colours
    // rankNumeralColor hands out already say who is on the podium, and the
    // crown was a second ornament over a desk that carries a name plate too.
    for (const rank of [1, 2, 3, 4, 10, 99]) {
      const kinds = new Set(rankNumeralCells(rank).cells.map((cell) => cell.kind))
      expect([...kinds].sort()).toEqual(["digit", "suffix"])
    }
  })

  it("gives every one-digit placing the same box, podium or not", () => {
    // The scene scales the mesh by this box and hangs it at one height, so a
    // 1ST that measured taller than a 4TH would float differently.
    const podium = rankNumeralCells(1)
    const field = rankNumeralCells(4)
    expect(podium.height).toBe(field.height)
    expect(podium.width).toBeCloseTo(field.width)
  })

  it("centres the numeral on the origin, so the mesh sits over the table centre", () => {
    for (const rank of [1, 3, 7, 12, 10]) {
      const { cells, width, height } = rankNumeralCells(rank)
      // Every cell, at its own size, stays inside the reported box.
      for (const cell of cells) {
        expect(cell.x - cell.size / 2).toBeGreaterThanOrEqual(-width / 2 - 1e-9)
        expect(cell.x + cell.size / 2).toBeLessThanOrEqual(width / 2 + 1e-9)
        expect(cell.y - cell.size / 2).toBeGreaterThanOrEqual(-height / 2 - 1e-9)
        expect(cell.y + cell.size / 2).toBeLessThanOrEqual(height / 2 + 1e-9)
      }
      // Horizontally the whole word straddles the origin: the desk centre is
      // the middle of "12TH", not the middle of the "12".
      const left = Math.min(...cells.map((cell) => cell.x - cell.size / 2))
      const right = Math.max(...cells.map((cell) => cell.x + cell.size / 2))
      expect(left + right).toBeCloseTo(0)
    }
  })

  it("widens for a two-digit rank rather than squeezing the digits", () => {
    const one = rankNumeralCells(9)
    const two = rankNumeralCells(10)
    expect(two.width).toBeGreaterThan(one.width)
    expect(two.height).toBe(one.height)
  })

  it("stays narrow enough to hang over a desk", () => {
    // The desktop is 5.5 world units wide and the scene scales this box by
    // RANK_CELL; the longest placing must not overhang the furniture it
    // belongs to. "10TH" is the worst case the room can produce.
    expect(rankNumeralCells(10).width).toBeLessThan(13)
  })

  it("has a well-formed pattern for every digit and suffix letter", () => {
    for (const rows of [...DIGIT_ROWS, ...Object.values(LETTER_ROWS)]) {
      expect(rows).toHaveLength(GLYPH_HEIGHT)
      for (const row of rows) {
        expect(row).toHaveLength(GLYPH_WIDTH)
        expect(row).toMatch(/^[01]+$/)
      }
    }
  })

  it("tells its digits apart, and its letters apart", () => {
    // Checked WITHIN each set, not across: at 3×5 an S and a 5 are the same
    // shape, as they are in most pixel fonts. It costs nothing here — the S
    // only ever appears in "1ST", where its neighbour is a T and its size is
    // half a digit's, so nobody is reading it as a number.
    for (const set of [DIGIT_ROWS, Object.values(LETTER_ROWS)]) {
      const keys = set.map((rows) => rows.join("|"))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it("knows a glyph for every letter its own suffixes use", () => {
    for (const rank of [1, 2, 3, 4, 11, 21]) {
      for (const letter of rankOrdinalSuffix(rank)) {
        expect(LETTER_ROWS[letter]).toBeDefined()
      }
    }
  })

  it("refuses a rank that is not a countable placing", () => {
    // A rank of zero, a negative, or a fraction is a bug upstream — better a
    // throw in a test than a nonsense numeral hovering over a desk all day.
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => rankNumeralCells(bad)).toThrow()
    }
  })

  it("never renders more than two digits — the room has ten desks", () => {
    expect(rankNumeralCells(99).width).toBe(rankNumeralCells(10).width)
    expect(() => rankNumeralCells(100)).toThrow()
  })
})

describe("rank numeral colour", () => {
  it("puts the podium in gold, silver and bronze", () => {
    expect(rankNumeralColor(1)).toBe(RANK_COLORS.gold)
    expect(rankNumeralColor(2)).toBe(RANK_COLORS.silver)
    expect(rankNumeralColor(3)).toBe(RANK_COLORS.bronze)
  })

  it("gives everyone else the room's own neon, not a fourth medal", () => {
    expect(rankNumeralColor(4)).toBe(RANK_COLORS.field)
    expect(rankNumeralColor(10)).toBe(RANK_COLORS.field)
  })
})

describe("rankNumeralCssColor", () => {
  it("is the same medal, written for a canvas", () => {
    // The wall screen paints its rank chips with these; the desks extrude
    // theirs from the numeric form. One source, so 2nd place cannot be
    // silver over the desk and something else on the wall.
    expect(rankNumeralCssColor(1)).toBe("#ffd24a")
    expect(rankNumeralCssColor(2)).toBe("#aec6e8")
    expect(rankNumeralCssColor(3)).toBe("#d08a46")
    expect(rankNumeralCssColor(4)).toBe("#54ffd8")
  })

  it("pads a colour whose leading byte is small", () => {
    // 0x0abcde must not be written "#abcde" — a five-digit hex is a different
    // colour, and canvas takes it without complaining.
    expect(hexColor(0x0abcde)).toBe("#0abcde")
  })
})
