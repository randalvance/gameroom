// Character sheet METRICS are not constants any more — a sheet's cell size,
// frame count and direction rows are read from the image itself, because the
// shipped char_N.png sheets and the AI-generated ones are different layouts.
// See sheetFormatFor() in ./spriteIndex.

export const CHAR_COUNT = 132

/**
 * The sheet file a stock character index renders from. Every char_N.png is
 * expected to be the 192×192 layout in lib/sprite-gen; one that has not been
 * converted yet renders garbled rather than being detected and special-cased,
 * which is how you spot the ones still to do.
 */
export function characterSheetUrl(index: number): string {
  return `/assets/room/characters/char_${index}.png`
}
