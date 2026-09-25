// One team, one colour, everywhere it appears.
//
// This started life inside HighScoreTable as the swatch beside a team's name
// on /results. It lives here now because the game room wants the same answer:
// a team that is amber on the projector has to be amber on the room's wall
// screen and in the menu too, or the colour is decoration rather than an
// identity anyone can follow across the two screens.
//
// The assignment is FIXED to the team's code, never to its position. Colouring
// by rank would repaint the whole room every time a ranking moved, which
// is the one thing a team colour must not do.

// The first ten were validated with the dataviz palette checker against the
// --color-ink surface: lightness band, chroma floor, CVD separation, and
// contrast all PASS. The eleventh and twelfth (#513) were placed in OKLCH at
// the same lightness (L≈0.64) and chroma (C≥0.11) in the two widest hue gaps
// the ten left — a cyan between teal and blue, a rose between magenta and red
// — so every pair in the twelve is ≥20° of hue apart and each reads at ≥5:1
// against the ink. Twelve, not ten: the field is ten competing teams plus the
// two exhibition entries, and before this TEAM_11/12 wore TEAM_01/02's colours.
//
// The thirteenth goes with the room's thirteenth desk. Twelve hues had already
// used the circle up — every remaining gap is ~35°, so splitting one cannot
// keep the ≥20° rule, and the second axis has to do the work instead. It sits
// at H≈314, between purple and magenta, and buys its separation with chroma
// (C≈0.23, against 0.11–0.18 for the rest) rather than hue: ΔE 10.2 from its
// nearest neighbour, where the palette's own closest pair is already 5.9. So
// it is not the set's weakest link on any check the checker runs — lightness
// band, chroma floor and 5.6:1 contrast all still PASS for all thirteen, and
// the worst CVD and normal-vision pairs are the ones the twelve already had.
//
// Green was the wider gap and the method's first answer; it is not this one.
// The scoreboards print gains in --color-neon in the column beside the swatch,
// so a vivid green team would read as "up" rather than as a team.
export const TEAM_COLORS = [
  "#B98E12", "#4390D1", "#E15554", "#35A167", "#D163B6",
  "#10A294", "#D0782F", "#9A6FD0", "#7F9615", "#6272E0",
  "#059CBB", "#D56188", "#C659F5",
] as const

export type TeamColor = (typeof TEAM_COLORS)[number]

/** Non-negative modulo — `-1 % 13` is `-1` in JS, which indexes nothing. */
function wrap(n: number): number {
  return ((n % TEAM_COLORS.length) + TEAM_COLORS.length) % TEAM_COLORS.length
}

function hash(label: string): number {
  return Math.abs([...label].reduce((a, c) => a * 31 + c.charCodeAt(0), 7))
}

/**
 * The colour for a team's display label.
 *
 * TEAM_01 → the first swatch … TEAM_13 → the thirteenth, so the event's
 * teams take the palette in order. Anything else — a bot, an unlinked
 * account, a team that named itself — hashes into the same thirteen, because a
 * label with no colour at all would read as "not a team" on a board where
 * every other row has one.
 */
export function teamColor(label: string): string {
  const m = /[_ ](-?\d+)$/.exec(label)
  const idx = m ? wrap(parseInt(m[1]!, 10) - 1) : wrap(hash(label))
  return TEAM_COLORS[idx]!
}
