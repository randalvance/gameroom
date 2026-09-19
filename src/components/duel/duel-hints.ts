// The coach: one line that says the next useful thing, from the board as it
// stands. Pure, so every situation is pinned by a test — out of mana, ready
// to attack, being attacked, picking a target — and the screen only draws
// the text and pulses whatever `nudge` points at.
import { spellTargeting, type Card } from "./cards"
import { canAttack, canBlock, castable, effectivePower, type Creature, type DuelState } from "./duel-sim"

export type Nudge = "hand" | "attackers" | "hand-and-attackers" | "blockers" | "primary" | null

export interface Hint {
  text: string
  /** What the screen should draw attention to. */
  nudge: Nudge
  /** "wait" while the house acts: nothing for the player to do. */
  tone: "act" | "wait"
}

export interface HintUi {
  /** The spell awaiting a target, if one is. */
  pendingCard?: Card
  chosenAttackers: number
  pendingBlocker: boolean
}

const mana = (n: number) => `${n} mana`

/** Castable AND sensible for a newcomer: a pump with none of your own
 * creatures to aim at is legal (the house's will do) but bad advice, so the
 * coach does not point at it. The card stays clickable. */
export function worthPlaying(state: DuelState, card: Card): boolean {
  if (!castable(state, "you", card)) return false
  if (card.kind === "spell" && card.effect.kind === "pump") return state.you.board.length > 0
  return true
}
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function duelHint(state: DuelState, ui: HintUi): Hint | null {
  if (state.phase === "over") return null
  const act = (text: string, nudge: Nudge): Hint => ({ text, nudge, tone: "act" })
  const wait = (text: string): Hint => ({ text, nudge: null, tone: "wait" })

  if (ui.pendingCard?.kind === "spell") {
    const reach = spellTargeting(ui.pendingCard.effect)
    const where = reach === "creature" ? "a glowing creature" : reach === "player" ? "a glowing life total" : "a glowing creature or life total"
    return act(`Pick ${where} for ${ui.pendingCard.name}. Esc cancels.`, null)
  }

  if (state.active === "house") {
    if (state.phase !== "blocks") return wait("The house is taking its turn…")
    const attackers = state.attackers.map((uid) => state.house.board.find((c) => c.uid === uid)).filter((c): c is Creature => !!c)
    const damage = attackers.reduce((n, c) => n + effectivePower(c), 0)
    const canDefend = state.you.board.some((b) => attackers.some((a) => canBlock(a, b)))
    const incoming = `The house attacks with ${attackers.length} for ${damage} damage.`
    if (!canDefend) return act(`${incoming} Nothing of yours can block, so press Confirm blocks.`, "primary")
    if (ui.pendingBlocker) return act("Now click the attacker it should block.", null)
    const flyer = attackers.some((a) => a.card.keyword === "flying") ? " Only flyers can block flyers." : ""
    return act(`${incoming} To block, click your creature, then the attacker. Press Confirm blocks when done.${flyer}`, "blockers")
  }

  if (state.phase === "blocks") return wait("The house is deciding how to block…")

  const affordable = state.you.hand.filter((c) => worthPlaying(state, c))
  const ready = state.you.board.filter((c) => canAttack(state, c))
  const resting = state.you.board.length - ready.length

  if (!state.attacked) {
    if (ui.chosenAttackers > 0) {
      return act(`Press Attack with ${ui.chosenAttackers} to send ${plural(ui.chosenAttackers, "it", "them")} in. The house may block.`, "primary")
    }
    if (ready.length > 0 && affordable.length > 0) {
      return act(`Play a card with your ${mana(state.you.mana)}, or click creatures to choose attackers.`, "hand-and-attackers")
    }
    if (ready.length > 0) {
      return act(`Ready to attack: click your creatures to choose attackers, then press Attack. Or press End turn to hold back.`, "attackers")
    }
    if (affordable.length > 0) {
      const wait = resting > 0 ? " New creatures attack from your next turn, unless they have Haste." : ""
      const first = state.turn === 1 ? " The number in a card's corner is its cost." : ""
      return act(`You have ${mana(state.you.mana)}. Click a card you can afford to play it.${first}${wait}`, "hand")
    }
  } else if (affordable.length > 0) {
    return act(`Combat's done. You can still play a card with ${mana(state.you.mana)}, or press End turn.`, "hand")
  }

  if (state.you.hand.some((c) => c.cost > state.you.mana)) {
    return act(`Not enough mana for the cards in your hand. Press End turn: you get another mana next turn.`, "primary")
  }
  if (state.you.hand.length > 0) {
    return act("Your spells need a creature to aim at, and there is none yet. Press End turn.", "primary")
  }
  return act("Nothing more to do this turn. Press End turn.", "primary")
}
