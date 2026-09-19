// The duel's rules, as pure functions over a plain state object. Nothing in
// here knows about React, the room, or the house policy: every legal action
// is a function (state) → state, and an illegal one returns the state with a
// log line, so the UI can never put the game somewhere the rules did not.
import { spellTargeting, type Card, type CreatureCard, type DeckId, type SpellCard } from "./cards"
import { buildDeck } from "./decks"
import { createRng } from "./rng"

export type Side = "you" | "house"
export const other = (s: Side): Side => (s === "you" ? "house" : "you")

export interface Creature {
  uid: number
  card: CreatureCard
  /** Damage marked this turn; wears off at end of turn. */
  damage: number
  pumpP: number
  pumpT: number
  /** The turn number it came in, for summoning sickness. */
  enteredTurn: number
}

export interface PlayerState {
  deck: DeckId
  life: number
  crystals: number
  mana: number
  library: Card[]
  hand: Card[]
  board: Creature[]
}

export type Phase = "main" | "attack" | "blocks" | "over"

export interface DuelState {
  turn: number
  active: Side
  phase: Phase
  /** Attacks already declared this turn (post-combat main). */
  attacked: boolean
  you: PlayerState
  house: PlayerState
  attackers: number[]
  blocks: Record<number, number>
  winner: Side | null
  reason: "life" | "deck" | null
  log: string[]
  nextUid: number
  events: DuelEvent[]
}

export type Target = { kind: "creature"; uid: number } | { kind: "player"; side: Side }

/**
 * What the last action did, for the screen to animate. Cleared at the start
 * of every action, so a render only ever sees the newest batch.
 */
export type DuelEvent =
  | { kind: "cast"; side: Side; card: SpellCard; target?: Target }
  | { kind: "summon"; side: Side; uid: number }
  | { kind: "attack"; side: Side; attackers: Array<{ uid: number; blockerUid: number | null }> }
  | { kind: "damage"; target: Target; amount: number }
  | { kind: "heal"; side: Side; amount: number }
  | { kind: "pump"; uid: number; power: number; toughness: number }
  | { kind: "destroyed"; side: Side; uid: number; index: number; card: CreatureCard }
  | { kind: "bounce"; side: Side; uid: number; index: number; card: CreatureCard }

export const LIFE = 20
export const HAND = 5
export const MAX_CRYSTALS = 8
export const DECK_SIZE = 20

const SIDE_NAME: Record<Side, string> = { you: "You", house: "The house" }

function newPlayer(deck: DeckId, seed: number): PlayerState {
  const library = buildDeck(deck, createRng(seed))
  return { deck, life: LIFE, crystals: 0, mana: 0, library: library.slice(HAND), hand: library.slice(0, HAND), board: [] }
}

export function createDuel(you: DeckId, house: DeckId, seed: number): DuelState {
  return {
    turn: 1, active: "you", phase: "main", attacked: false,
    you: { ...newPlayer(you, seed), crystals: 1, mana: 1 },
    house: newPlayer(house, (seed ^ 0x9e3779b9) >>> 0),
    attackers: [], blocks: {}, winner: null, reason: null, log: ["The duel begins."], nextUid: 1, events: [],
  }
}

const log = (state: DuelState, line: string): DuelState => ({ ...state, log: [...state.log, line] })
const emit = (state: DuelState, event: DuelEvent): DuelState => ({ ...state, events: [...state.events, event] })
/** Every action starts here: last action's events are not this one's. */
const begin = (state: DuelState): DuelState => ({ ...state, events: [] })

function withPlayer(state: DuelState, side: Side, player: PlayerState): DuelState {
  return { ...state, [side]: player }
}

export function effectivePower(c: Creature): number { return Math.max(0, c.card.power + c.pumpP) }
export function effectiveToughness(c: Creature): number { return c.card.toughness + c.pumpT }

export function canAttack(state: DuelState, c: Creature): boolean {
  return c.card.keyword === "haste" || c.enteredTurn < state.turn
}

/** Draw one; an empty library is the game. */
function draw(state: DuelState, side: Side): DuelState {
  const p = state[side]
  if (p.library.length === 0) {
    return { ...log(state, `${SIDE_NAME[side]} cannot draw — the library is empty.`), phase: "over", winner: other(side), reason: "deck" }
  }
  const [card, ...rest] = p.library
  return withPlayer(state, side, { ...p, library: rest, hand: [...p.hand, card!] })
}

const clearMarks = (board: Creature[]): Creature[] => board.map((c) => ({ ...c, damage: 0, pumpP: 0, pumpT: 0 }))

export function endTurn(state: DuelState): DuelState {
  if (state.phase === "over") return state
  const next = other(state.active)
  let s: DuelState = {
    ...begin(state),
    you: { ...state.you, board: clearMarks(state.you.board) },
    house: { ...state.house, board: clearMarks(state.house.board) },
    attackers: [], blocks: {}, attacked: false,
    active: next, turn: state.turn + 1, phase: "main",
  }
  const p = s[next]
  const crystals = Math.min(MAX_CRYSTALS, p.crystals + 1)
  s = withPlayer(s, next, { ...p, crystals, mana: crystals })
  s = log(s, `Turn ${s.turn}: ${SIDE_NAME[next]} ${next === "you" ? "have" : "has"} ${crystals} mana.`)
  return draw(s, next)
}

// ------------------------------------------------------------- playing cards

function findCreature(state: DuelState, uid: number): { side: Side; index: number; creature: Creature } | null {
  for (const side of ["you", "house"] as const) {
    const index = state[side].board.findIndex((c) => c.uid === uid)
    if (index >= 0) return { side, index, creature: state[side].board[index]! }
  }
  return null
}

/** Ends the game if either life total has hit zero. Both at once: the active player loses. */
export function checkLife(state: DuelState): DuelState {
  if (state.phase === "over") return state
  const youDead = state.you.life <= 0, houseDead = state.house.life <= 0
  if (!youDead && !houseDead) return state
  const winner: Side = youDead && houseDead ? other(state.active) : youDead ? "house" : "you"
  return { ...log(state, `${SIDE_NAME[winner]} win${winner === "house" ? "s" : ""} the duel.`), phase: "over", winner, reason: "life" }
}

/** Removes creatures whose marked damage has reached their toughness. */
function reap(state: DuelState): DuelState {
  let s = state
  for (const side of ["you", "house"] as const) {
    const board = s[side].board
    const dead = board.filter((c) => c.damage >= effectiveToughness(c))
    if (dead.length === 0) continue
    s = withPlayer(s, side, { ...s[side], board: board.filter((c) => !dead.includes(c)) })
    for (const c of dead) {
      s = emit(log(s, `${c.card.name} is destroyed.`), { kind: "destroyed", side, uid: c.uid, index: board.indexOf(c), card: c.card })
    }
  }
  return s
}

function damageCreature(state: DuelState, uid: number, amount: number): DuelState {
  const hit = findCreature(state, uid)
  if (!hit) return state
  const board = state[hit.side].board.map((c) => (c.uid === uid ? { ...c, damage: c.damage + amount } : c))
  return reap(emit(withPlayer(state, hit.side, { ...state[hit.side], board }), { kind: "damage", target: { kind: "creature", uid }, amount }))
}

function damagePlayer(state: DuelState, side: Side, amount: number): DuelState {
  const s = emit(state, { kind: "damage", target: { kind: "player", side }, amount })
  return checkLife(withPlayer(s, side, { ...s[side], life: s[side].life - amount }))
}

function drawN(state: DuelState, side: Side, n: number): DuelState {
  let s = state
  for (let i = 0; i < n && s.phase !== "over"; i++) s = draw(s, side)
  return s
}

export function legalTargets(state: DuelState, side: Side, card: SpellCard): Target[] {
  const creatures: Target[] = [...state[other(side)].board, ...state[side].board].map((c) => ({ kind: "creature", uid: c.uid }))
  const players: Target[] = [{ kind: "player", side: other(side) }, { kind: "player", side }]
  switch (spellTargeting(card.effect)) {
    case "none": return []
    case "creature": return creatures
    case "player": return players
    case "any": return [...creatures, ...players]
  }
}

const sameTarget = (a: Target, b: Target): boolean =>
  a.kind === "creature" ? b.kind === "creature" && a.uid === b.uid : b.kind === "player" && a.side === b.side

function isLegalTarget(state: DuelState, side: Side, card: SpellCard, target: Target | undefined): boolean {
  if (spellTargeting(card.effect) === "none") return target === undefined
  if (!target) return false
  return legalTargets(state, side, card).some((t) => sameTarget(t, target))
}

function resolveSpell(state: DuelState, side: Side, card: SpellCard, target: Target | undefined): DuelState {
  const e = card.effect
  switch (e.kind) {
    case "damage":
      if (target?.kind === "creature") return damageCreature(state, target.uid, e.amount)
      if (target?.kind === "player") return damagePlayer(state, target.side, e.amount)
      return state
    case "destroy": {
      if (target?.kind !== "creature") return state
      const hit = findCreature(state, target.uid)
      if (!hit) return state
      const owner = state[hit.side]
      const s = withPlayer(state, hit.side, { ...owner, board: owner.board.filter((c) => c.uid !== target.uid) })
      return emit(log(s, `${hit.creature.card.name} is destroyed.`), { kind: "destroyed", side: hit.side, uid: target.uid, index: hit.index, card: hit.creature.card })
    }
    case "pump": {
      if (target?.kind !== "creature") return state
      const hit = findCreature(state, target.uid)
      if (!hit) return state
      const board = state[hit.side].board.map((c) => (c.uid === target.uid ? { ...c, pumpP: c.pumpP + e.power, pumpT: c.pumpT + e.toughness } : c))
      const s = emit(withPlayer(state, hit.side, { ...state[hit.side], board }), { kind: "pump", uid: target.uid, power: e.power, toughness: e.toughness })
      return drawN(s, side, e.draw ?? 0)
    }
    case "draw": return drawN(state, side, e.amount)
    case "heal": return emit(withPlayer(state, side, { ...state[side], life: state[side].life + e.amount }), { kind: "heal", side, amount: e.amount })
    case "ramp": {
      const p = state[side]
      const crystals = Math.min(MAX_CRYSTALS, p.crystals + 1)
      return withPlayer(state, side, { ...p, crystals, mana: p.mana + (crystals - p.crystals) })
    }
    case "bounce": {
      if (target?.kind !== "creature") return state
      const hit = findCreature(state, target.uid)
      if (!hit) return state
      const owner = state[hit.side]
      const s = withPlayer(state, hit.side, { ...owner, board: owner.board.filter((c) => c.uid !== target.uid), hand: [...owner.hand, hit.creature.card] })
      return emit(s, { kind: "bounce", side: hit.side, uid: target.uid, index: hit.index, card: hit.creature.card })
    }
    case "drain": {
      const s = emit(withPlayer(state, side, { ...state[side], life: state[side].life + e.amount }), { kind: "heal", side, amount: e.amount })
      return damagePlayer(s, other(side), e.amount)
    }
  }
}

/** Whether a card in hand could be played right now: its turn, its phase,
 * enough mana, and — for a targeted spell — something legal to aim at. */
export function castable(state: DuelState, side: Side, card: Card): boolean {
  if (state.phase !== "main" || state.active !== side || card.cost > state[side].mana) return false
  if (card.kind === "creature" || spellTargeting(card.effect) === "none") return true
  return legalTargets(state, side, card).length > 0
}

export function playCard(state0: DuelState, side: Side, handIdx: number, target?: Target): DuelState {
  const state = begin(state0)
  if (state.phase !== "main" || state.active !== side) return log(state, "Not the moment to play a card.")
  const p = state[side]
  const card = p.hand[handIdx]
  if (!card) return log(state, "No such card in hand.")
  if (card.cost > p.mana) return log(state, `${card.name} costs ${card.cost} mana; ${p.mana} left.`)
  if (card.kind === "spell" && !isLegalTarget(state, side, card, target)) return log(state, `${card.name} needs a legal target.`)
  const hand = p.hand.filter((_, i) => i !== handIdx)
  let s = withPlayer(state, side, { ...p, hand, mana: p.mana - card.cost })
  s = log(s, `${SIDE_NAME[side]} play${side === "house" ? "s" : ""} ${card.name}.`)
  if (card.kind === "creature") {
    const creature: Creature = { uid: s.nextUid, card, damage: 0, pumpP: 0, pumpT: 0, enteredTurn: s.turn }
    s = { ...withPlayer(s, side, { ...s[side], board: [...s[side].board, creature] }), nextUid: s.nextUid + 1 }
    return emit(s, { kind: "summon", side, uid: creature.uid })
  }
  return resolveSpell(emit(s, { kind: "cast", side, card, target }), side, card, target)
}

// -------------------------------------------------------------------- combat

export function declareAttackers(state0: DuelState, side: Side, uids: number[]): DuelState {
  const state = begin(state0)
  if (state.phase !== "main" || state.active !== side || state.attacked) return log(state, "Not the moment to attack.")
  const board = state[side].board
  const chosen = uids.map((uid) => board.find((c) => c.uid === uid))
  if (chosen.some((c) => !c || !canAttack(state, c))) return log(state, "A creature that just arrived cannot attack yet.")
  if (uids.length === 0) return { ...log(state, `${SIDE_NAME[side]} ${side === "you" ? "hold" : "holds"} back.`), attacked: true }
  const names = chosen.map((c) => c!.card.name).join(", ")
  return { ...log(state, `${SIDE_NAME[side]} attack${side === "house" ? "s" : ""} with ${names}.`), phase: "blocks", attackers: [...new Set(uids)] }
}

/** Flying is blockable only by flying. */
export function canBlock(attacker: Creature, blocker: Creature): boolean {
  return attacker.card.keyword !== "flying" || blocker.card.keyword === "flying"
}

export function declareBlocks(state0: DuelState, side: Side, blocks: Record<number, number>): DuelState {
  const state = begin(state0)
  const attackerSide = state.active
  if (state.phase !== "blocks" || side !== other(attackerSide)) return log(state, "Not the moment to block.")
  const defenders = state[side].board
  const used = new Set<number>()
  for (const [aKey, bUid] of Object.entries(blocks)) {
    const aUid = Number(aKey)
    const a = state[attackerSide].board.find((c) => c.uid === aUid)
    const b = defenders.find((c) => c.uid === bUid)
    if (!a || !state.attackers.includes(aUid) || !b) return log(state, "That block is not possible.")
    if (used.has(bUid)) return log(state, "A creature can block only one attacker.")
    if (!canBlock(a, b)) return log(state, `${b.card.name} cannot reach ${a.card.name} in the air.`)
    used.add(bUid)
  }
  return resolveCombat({ ...state, blocks }, attackerSide, side)
}

/** Simultaneous combat damage, then the reaping, then the life check. */
function resolveCombat(state: DuelState, attackerSide: Side, defenderSide: Side): DuelState {
  const marks = new Map<number, number>()
  let toDefender = 0
  const gained: Record<Side, number> = { you: 0, house: 0 }
  const dealt = (from: Creature, side: Side, amount: number) => { if (from.card.keyword === "lifelink") gained[side] += amount }
  for (const aUid of state.attackers) {
    const a = state[attackerSide].board.find((c) => c.uid === aUid)
    if (!a) continue
    const bUid = state.blocks[aUid]
    const b = bUid === undefined ? undefined : state[defenderSide].board.find((c) => c.uid === bUid)
    const power = effectivePower(a)
    if (!b) { toDefender += power; dealt(a, attackerSide, power); continue }
    const room = Math.max(0, effectiveToughness(b) - b.damage - (marks.get(b.uid) ?? 0))
    const toBlocker = a.card.keyword === "trample" ? Math.min(power, room) : power
    marks.set(b.uid, (marks.get(b.uid) ?? 0) + toBlocker)
    if (a.card.keyword === "trample") toDefender += power - toBlocker
    dealt(a, attackerSide, power)
    const bPower = effectivePower(b)
    marks.set(a.uid, (marks.get(a.uid) ?? 0) + bPower)
    dealt(b, defenderSide, bPower)
  }
  const mark = (board: Creature[]) => board.map((c) => (marks.has(c.uid) ? { ...c, damage: c.damage + marks.get(c.uid)! } : c))
  let s: DuelState = {
    ...state,
    you: { ...state.you, board: mark(state.you.board), life: state.you.life + gained.you },
    house: { ...state.house, board: mark(state.house.board), life: state.house.life + gained.house },
    phase: "main", attacked: true, attackers: [], blocks: {},
  }
  s = emit(s, { kind: "attack", side: attackerSide, attackers: state.attackers.map((uid) => ({ uid, blockerUid: state.blocks[uid] ?? null })) })
  for (const [uid, amount] of marks) if (amount > 0) s = emit(s, { kind: "damage", target: { kind: "creature", uid }, amount })
  for (const side of ["you", "house"] as const) if (gained[side] > 0) s = emit(s, { kind: "heal", side, amount: gained[side] })
  s = withPlayer(s, defenderSide, { ...s[defenderSide], life: s[defenderSide].life - toDefender })
  if (toDefender > 0) {
    s = emit(log(s, `${SIDE_NAME[defenderSide]} take${defenderSide === "house" ? "s" : ""} ${toDefender}.`), { kind: "damage", target: { kind: "player", side: defenderSide }, amount: toDefender })
  }
  return checkLife(reap(s))
}
