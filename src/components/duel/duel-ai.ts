// The house's play. Deterministic given the state — no dice — so a test can
// say exactly what it will do, and so a student who loses can work out why.
// Called one action at a time so the UI can animate each step.
import type { Card, SpellCard } from "./cards"
import {
  canAttack, canBlock, effectivePower, effectiveToughness, other,
  type Creature, type DuelState, type Side, type Target,
} from "./duel-sim"

export type HouseAction =
  | { kind: "play"; handIdx: number; target?: Target; name: string }
  | { kind: "attack"; uids: number[] }
  | { kind: "end" }

const HOUSE: Side = "house"
/** Heal when at or below this. */
const HEAL_AT = 10
/** Throw a creature in the way when a hit would leave the house at or below this. */
const CHUMP_AT = 6

const remaining = (c: Creature) => effectiveToughness(c) - c.damage
const byPowerDesc = (a: Creature, b: Creature) => effectivePower(b) - effectivePower(a)

/** Which house creatures can attack this turn. */
const ableAttackers = (state: DuelState): Creature[] => state.house.board.filter((c) => canAttack(state, c))

/**
 * Attack with what is safe, what trades up while ahead, or everything when the
 * total is lethal and the defender is short of blockers.
 */
export function houseAttackers(state: DuelState): number[] {
  const able = ableAttackers(state)
  const blockers = state.you.board
  const total = able.reduce((n, c) => n + effectivePower(c), 0)
  if (able.length > 0 && total >= state.you.life && blockers.length < able.length) return able.map((c) => c.uid)
  const ahead = state.house.life >= state.you.life
  return able.filter((a) => {
    const killers = blockers.filter((b) => canBlock(a, b) && effectivePower(b) >= remaining(a))
    if (killers.length === 0) return true
    return ahead && killers.every((b) => effectivePower(a) >= remaining(b))
  }).map((c) => c.uid)
}

interface Option<C extends Card = Card> { handIdx: number; card: C }

const affordable = (state: DuelState): Option[] =>
  state.house.hand.map((card, handIdx) => ({ handIdx, card })).filter(({ card }) => card.cost <= state.house.mana)

function spellAction(state: DuelState, o: Option<SpellCard>, attacking: Creature[]): HouseAction | null {
  const e = o.card.effect
  const enemies = [...state.you.board].sort(byPowerDesc)
  const act = (target?: Target): HouseAction => ({ kind: "play", handIdx: o.handIdx, target, name: o.card.name })
  switch (e.kind) {
    case "ramp": case "draw": case "drain": return act()
    case "destroy": return enemies[0] ? act({ kind: "creature", uid: enemies[0].uid }) : null
    case "damage": {
      if (e.target !== "creature" && e.amount >= state.you.life) return act({ kind: "player", side: "you" })
      if (e.target === "player") return null
      const victim = enemies.find((c) => e.amount >= remaining(c))
      return victim ? act({ kind: "creature", uid: victim.uid }) : null
    }
    case "bounce": {
      const priciest = [...state.you.board].sort((a, b) => b.card.cost - a.card.cost)[0]
      return priciest ? act({ kind: "creature", uid: priciest.uid }) : null
    }
    case "heal": return state.house.life <= HEAL_AT ? act() : null
    case "pump": {
      const best = [...attacking].sort(byPowerDesc)[0]
      return best ? act({ kind: "creature", uid: best.uid }) : null
    }
  }
}

/** Spell kinds in the order the house reaches for them once its creatures are down. */
const LATE_SPELLS: readonly string[][] = [["destroy", "damage"], ["bounce"], ["drain"], ["heal"], ["pump"]]

/** The next thing the house does in its own main phase. */
export function houseNextMainAction(state: DuelState): HouseAction {
  if (state.phase !== "main" || state.active !== HOUSE) return { kind: "end" }
  const options = affordable(state)
  const creatures = options.filter((o) => o.card.kind === "creature").sort((a, b) => b.card.cost - a.card.cost)
  if (state.attacked) {
    const c = creatures[0]
    return c ? { kind: "play", handIdx: c.handIdx, name: c.card.name } : { kind: "end" }
  }
  const spells = options.filter((o): o is Option<SpellCard> => o.card.kind === "spell")
  const plannedUids = houseAttackers(state)
  const willAttack = ableAttackers(state).filter((c) => plannedUids.includes(c.uid))

  for (const kind of ["ramp", "draw"]) {
    const o = spells.find((o) => o.card.effect.kind === kind)
    const a = o && spellAction(state, o, willAttack)
    if (a) return a
  }
  if (creatures[0]) return { kind: "play", handIdx: creatures[0].handIdx, name: creatures[0].card.name }
  for (const kinds of LATE_SPELLS) {
    for (const o of spells.filter((o) => kinds.includes(o.card.effect.kind))) {
      const a = spellAction(state, o, willAttack)
      if (a) return a
    }
  }
  return { kind: "attack", uids: plannedUids }
}

/** How the house blocks your attack: kill and survive, else kill, else chump when it must. */
export function houseBlocks(state: DuelState): Record<number, number> {
  if (state.phase !== "blocks" || state.active !== other(HOUSE)) return {}
  const incoming = state.attackers
    .map((uid) => state.you.board.find((c) => c.uid === uid))
    .filter((c): c is Creature => !!c)
    .sort(byPowerDesc)
  const free = new Set(state.house.board.map((c) => c.uid))
  const blocks: Record<number, number> = {}
  let unblocked = 0
  for (const a of incoming) {
    const legal = state.house.board.filter((b) => free.has(b.uid) && canBlock(a, b))
    const kills = legal.filter((b) => effectivePower(b) >= remaining(a))
    const safeKill = kills.find((b) => effectivePower(a) < remaining(b))
    let pick = safeKill ?? kills[0]
    if (!pick && state.house.life - (unblocked + effectivePower(a)) <= CHUMP_AT) {
      pick = [...legal].sort((x, y) => effectivePower(x) - effectivePower(y))[0]
    }
    if (pick) { blocks[a.uid] = pick.uid; free.delete(pick.uid) }
    else unblocked += effectivePower(a)
  }
  return blocks
}
