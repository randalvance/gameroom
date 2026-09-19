// Press-and-hold to inspect a card: what to say about it (pure, tested) and
// the hold gesture itself (mouse, pen and touch alike, through pointer events).
//
// The gesture lives on a wrapper around each card rather than on the card's
// button, because a disabled button swallows pointer events in some browsers
// and a player should be able to read a card they cannot play yet.
import { useCallback, useEffect, useRef, useState } from "react"
import type { Card, Keyword, SpellEffect } from "./cards"
import { canAttack, effectivePower, effectiveToughness, type Creature, type DuelState, type Side } from "./duel-sim"

export const KEYWORD_LABEL: Record<Keyword, string> = { haste: "Haste", flying: "Flying", lifelink: "Lifelink", trample: "Trample" }

export const KEYWORD_RULE: Record<Keyword, string> = {
  haste: "Can attack the turn it is played.",
  flying: "Can only be blocked by creatures with Flying.",
  lifelink: "Damage it deals also heals its owner by the same amount.",
  trample: "When blocked, damage beyond what its blocker can take goes through to the player.",
}

/** The one-line rules text printed on a card face. */
export function effectText(e: SpellEffect): string {
  switch (e.kind) {
    case "damage": return `Deal ${e.amount} damage to ${e.target === "creature" ? "a creature" : e.target === "player" ? "a player" : "any target"}`
    case "destroy": return "Destroy a creature"
    case "pump": return `A creature gets +${e.power}/+${e.toughness} until end of turn${e.draw ? `. Draw ${e.draw}` : ""}`
    case "draw": return `Draw ${e.amount} cards`
    case "heal": return `Gain ${e.amount} life`
    case "ramp": return "Gain a permanent mana crystal"
    case "bounce": return "Return a creature to its owner's hand"
    case "drain": return `Opponent loses ${e.amount} life, you gain ${e.amount}`
  }
}

/** The longer explanation the inspect panel gives for a spell. */
function spellRule(e: SpellEffect): string {
  switch (e.kind) {
    case "damage":
      return e.target === "creature" ? `Deals ${e.amount} damage to a creature you choose. It is destroyed if that reaches its toughness.`
        : e.target === "player" ? `Deals ${e.amount} damage straight to a player's life.`
        : `Deals ${e.amount} damage to a creature or a player you choose.`
    case "destroy": return "Destroys a creature you choose, whatever its toughness."
    case "pump": return `A creature you choose gets +${e.power} power and +${e.toughness} toughness until the end of the turn.${e.draw ? ` Then you draw ${e.draw} card${e.draw === 1 ? "" : "s"}.` : ""}`
    case "draw": return `You draw ${e.amount} cards.`
    case "heal": return `You gain ${e.amount} life. There is no upper limit.`
    case "ramp": return "You gain one mana crystal for the rest of the game (up to 8), and it is ready to use this turn."
    case "bounce": return "A creature you choose goes back to its owner's hand. They can play it again later."
    case "drain": return `Your opponent loses ${e.amount} life and you gain ${e.amount}.`
  }
}

export interface InspectTarget {
  card: Card
  /** Present when the card is on the board. */
  creature?: Creature
  owner: Side
  where: "hand" | "board"
}

export interface InspectDetails {
  title: string
  typeLine: string
  /** Current power/toughness for a creature, e.g. "5/1". */
  stats: string | null
  lines: string[]
  flavor: string
}

export function inspectDetails(target: InspectTarget, state?: DuelState): InspectDetails {
  const { card, creature } = target
  const lines: string[] = []
  let stats: string | null = null
  if (card.kind === "creature") {
    if (creature) {
      const power = effectivePower(creature)
      const toughness = effectiveToughness(creature)
      stats = `${power}/${toughness - creature.damage}`
    } else {
      stats = `${card.power}/${card.toughness}`
    }
    lines.push(card.keyword ? `${KEYWORD_LABEL[card.keyword]}: ${KEYWORD_RULE[card.keyword]}` : "No special ability: it attacks and blocks.")
    if (creature) {
      if (creature.pumpP || creature.pumpT) lines.push(`Boosted +${creature.pumpP}/+${creature.pumpT} until end of turn (printed ${card.power}/${card.toughness}).`)
      if (creature.damage > 0) lines.push(`Has taken ${creature.damage} damage this turn; it heals at the end of the turn.`)
      if (state && !canAttack(state, creature) && state.active === target.owner) lines.push("Just arrived: it can attack from next turn.")
      if (state?.attackers.includes(creature.uid)) lines.push("Attacking right now.")
    }
  } else {
    lines.push(spellRule(card.effect))
  }
  if (target.where === "hand" && state && target.owner === "you") {
    const mana = state.you.mana
    if (card.cost > mana) lines.push(`Costs ${card.cost} mana; you have ${mana} this turn.`)
  }
  return {
    title: card.name,
    typeLine: `${card.kind === "creature" ? "Creature" : "Spell"} · ${card.cost} mana`,
    stats,
    lines,
    flavor: card.flavor,
  }
}

/** How long a press must last to count as a hold. */
export const HOLD_MS = 350
/** How far a pointer may drift and still be holding, in px. */
export const HOLD_SLOP = 10

/**
 * The hold gesture. `bind(target)` gives the props for a card's wrapper; the
 * inspected target is set while the press lasts past HOLD_MS and cleared on
 * release. The click that follows a hold is swallowed, so reading a card
 * never plays it.
 */
export function useCardInspect() {
  const [inspecting, setInspecting] = useState<InspectTarget | null>(null)
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const swallowClick = useRef(false)
  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null } }
  useEffect(() => clear, [])

  const release = useCallback(() => {
    clear()
    origin.current = null
    setInspecting((cur) => { if (cur) swallowClick.current = true; return null })
  }, [])

  const bind = useCallback((target: InspectTarget) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== undefined && e.button > 0) return
      swallowClick.current = false
      clear()
      origin.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 }
      timer.current = window.setTimeout(() => { timer.current = null; setInspecting(target) }, HOLD_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const o = origin.current
      if (!o || timer.current === null) return
      if (Math.hypot((e.clientX ?? 0) - o.x, (e.clientY ?? 0) - o.y) > HOLD_SLOP) { clear(); origin.current = null }
    },
    onPointerUp: release,
    onPointerCancel: release,
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType !== "touch") release() },
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      e.preventDefault()
      e.stopPropagation()
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }), [release])

  return { inspecting, setInspecting, bind, release }
}
