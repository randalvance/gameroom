// Which house sits at which white desk. This is all the ROOM needs to know
// about the duel before anyone sits down, so it carries no card data: the
// decks themselves, the art, the sound and the game arrive with the lazily
// loaded chunk (load-duel.ts) and not before. Guarded by duel-lazy.test.ts,
// which is also why the house desks' indexes are handed in rather than
// imported: this file imports nothing but a type.
import type { DeckId } from "./cards"

export const DECK_IDS: readonly DeckId[] = ["bulls", "bears", "quants", "whales"]

/** Which house desk this is, in room order; -1 if this desk is not one. */
export function houseDeskOrdinal(houseTableIdxs: readonly number[], tableIdx: number): number {
  return houseTableIdxs.indexOf(tableIdx)
}

/** The k-th house desk always plays the same deck. */
export function houseDeckForDesk(ordinal: number): DeckId {
  return DECK_IDS[((ordinal % DECK_IDS.length) + DECK_IDS.length) % DECK_IDS.length]!
}

const HOUSE_NAMES = ["THE HOUSE", "THE BACK ROOM", "THE ANNEX", "THE VAULT"] as const

/** What the house at a desk is called, for the duel's title card. */
export function houseNameForDesk(ordinal: number): string {
  return HOUSE_NAMES[((ordinal % HOUSE_NAMES.length) + HOUSE_NAMES.length) % HOUSE_NAMES.length]!
}
