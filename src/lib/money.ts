// Money crosses the exchange boundary as integer CENTS and is shown to people
// as DOLLARS. Both conversions live here and nowhere else: `150.10 * 100` is
// 15010.000000000002 in JavaScript, so every dollars-to-cents conversion has to
// go through d2c rather than a hand-written multiplication.
export const c2d = (cents: number): number => cents / 100
export const d2c = (dollars: number): number => Math.round(dollars * 100)
