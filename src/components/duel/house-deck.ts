// Which house sits at which white desk. This is all the ROOM needs to know
// about the duel before anyone sits down, so it carries no card data: the
// decks themselves, the art, the sound and the game arrive with the lazily
// loaded chunk (load-duel.ts) and not before. Guarded by duel-lazy.test.ts.
import type { DeckId } from "./cards"

export const DECK_IDS: readonly DeckId[] = ["bulls", "bears", "quants", "whales"]

/** How many exhibition desks come before this one in room order; -1 if this desk is not exhibition. */
export function exhibitionOrdinal(teamCompeting: readonly boolean[], tableIdx: number): number {
  if (teamCompeting[tableIdx] !== false) return -1
  let n = 0
  for (let i = 0; i < tableIdx; i++) if (teamCompeting[i] === false) n++
  return n
}

/** The k-th exhibition desk always plays the same deck. */
export function houseDeckForDesk(exhibitionOrdinal: number): DeckId {
  return DECK_IDS[((exhibitionOrdinal % DECK_IDS.length) + DECK_IDS.length) % DECK_IDS.length]!
}
