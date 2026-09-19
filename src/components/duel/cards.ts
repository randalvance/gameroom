// The vocabulary of the duel. Types only — the numbers live in decks.ts, the
// rules in duel-sim.ts — so any of the three can change without the others.

export type DeckId = "bulls" | "bears" | "quants" | "whales"

export type Keyword = "haste" | "flying" | "lifelink" | "trample"

export type SpellEffect =
  | { kind: "damage"; amount: number; target: "creature" | "any" | "player" }
  | { kind: "destroy" }
  | { kind: "pump"; power: number; toughness: number; draw?: number }
  | { kind: "draw"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "ramp" }
  | { kind: "bounce" }
  | { kind: "drain"; amount: number }

interface CardBase {
  /** Stable id, `<deck>/<slug>`; also the art key. */
  id: string
  deck: DeckId
  name: string
  cost: number
  /** One line of flavour shown under the art. */
  flavor: string
  /** The image prompt this card's art was generated from. */
  art: string
}

export interface CreatureCard extends CardBase {
  kind: "creature"
  power: number
  toughness: number
  keyword?: Keyword
}

export interface SpellCard extends CardBase {
  kind: "spell"
  effect: SpellEffect
}

export type Card = CreatureCard | SpellCard

export interface DeckDef {
  id: DeckId
  name: string
  /** MTG colour it is modelled on, for the deck-select pitch. */
  color: string
  pitch: string
  /** Exactly eight, in ascending cost. */
  cards: readonly Card[]
}

export type Targeting = "none" | "creature" | "any" | "player"

/** Which targets a spell asks for before it resolves. */
export function spellTargeting(effect: SpellEffect): Targeting {
  switch (effect.kind) {
    case "damage": return effect.target
    case "destroy": case "pump": case "bounce": return "creature"
    default: return "none"
  }
}
