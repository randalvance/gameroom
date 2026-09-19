import { describe, expect, it } from "vitest"
import { DECKS } from "./decks"
import type { Card, CreatureCard } from "./cards"
import {
  DECK_SIZE, HAND, LIFE, MAX_CRYSTALS, canAttack, canBlock, createDuel, declareAttackers, declareBlocks, endTurn, legalTargets, playCard,
  type DuelState, type Side,
} from "./duel-sim"

const card = (id: string): Card => {
  const found = DECKS.flatMap((d) => d.cards).find((c) => c.id === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const creature = (id: string): CreatureCard => { const c = card(id); if (c.kind !== "creature") throw new Error(id); return c }
const withHand = (s: DuelState, side: Side, cards: Card[]): DuelState => ({ ...s, [side]: { ...s[side], hand: cards } })
const withMana = (s: DuelState, side: Side, mana: number): DuelState => ({ ...s, [side]: { ...s[side], crystals: mana, mana } })
const withBoard = (s: DuelState, side: Side, cards: Array<{ card: CreatureCard; enteredTurn?: number }>): DuelState => {
  let uid = s.nextUid
  const board = cards.map(({ card, enteredTurn }) => ({ uid: uid++, card, damage: 0, pumpP: 0, pumpT: 0, enteredTurn: enteredTurn ?? 0 }))
  return { ...s, nextUid: uid, [side]: { ...s[side], board: [...s[side].board, ...board] } }
}
const base = () => withMana(createDuel("bulls", "bears", 1), "you", 8)

describe("createDuel", () => {
  it("deals five each from twenty and starts your turn one with one mana", () => {
    const s = createDuel("bulls", "bears", 1)
    expect(s.you.hand).toHaveLength(HAND)
    expect(s.house.hand).toHaveLength(HAND)
    expect(s.you.library).toHaveLength(DECK_SIZE - HAND)
    expect(s.you.life).toBe(LIFE)
    expect(s.house.life).toBe(LIFE)
    expect(s).toMatchObject({ turn: 1, active: "you", phase: "main", attacked: false, winner: null })
    expect(s.you).toMatchObject({ crystals: 1, mana: 1 })
    expect(s.house).toMatchObject({ crystals: 0, mana: 0 })
  })
  it("is deterministic for a seed and the two libraries differ", () => {
    const a = createDuel("quants", "quants", 9), b = createDuel("quants", "quants", 9)
    expect(a.you.hand.map((c) => c.id)).toEqual(b.you.hand.map((c) => c.id))
    expect(a.you.library.map((c) => c.id)).not.toEqual(a.house.library.map((c) => c.id))
  })
})

describe("endTurn", () => {
  it("passes the turn, grows and refills mana, and draws one", () => {
    const s1 = endTurn(createDuel("bulls", "bears", 1))
    expect(s1).toMatchObject({ turn: 2, active: "house", phase: "main" })
    expect(s1.house).toMatchObject({ crystals: 1, mana: 1 })
    expect(s1.house.hand).toHaveLength(HAND + 1)
    expect(s1.house.library).toHaveLength(DECK_SIZE - HAND - 1)
    const s2 = endTurn(s1)
    expect(s2.you).toMatchObject({ crystals: 2, mana: 2 })
    expect(s2.you.hand).toHaveLength(HAND + 1)
  })
  it("caps crystals at eight", () => {
    let s = createDuel("bulls", "bears", 1)
    for (let i = 0; i < 20; i++) { s = endTurn(s); if (s.phase === "over") break }
    expect(s.you.crystals).toBeLessThanOrEqual(MAX_CRYSTALS)
    expect(s.house.crystals).toBeLessThanOrEqual(MAX_CRYSTALS)
  })
  it("loses the game for a player who must draw from an empty library", () => {
    let s = createDuel("bulls", "bears", 1)
    while (s.phase !== "over") s = endTurn(s)
    expect(s.reason).toBe("deck")
    // The house draws first after the opening hands, so it runs dry first.
    expect(s.winner).toBe("you")
    expect(s.house.library).toHaveLength(0)
  })
})

describe("playCard", () => {
  it("puts a creature on the board and pays its cost", () => {
    const s = playCard(withHand(base(), "you", [card("bulls/raging-bull")]), "you", 0)
    expect(s.you.board.map((c) => c.card.id)).toEqual(["bulls/raging-bull"])
    expect(s.you.board[0]!.enteredTurn).toBe(1)
    expect(s.you.hand).toHaveLength(0)
    expect(s.you.mana).toBe(4)
  })
  it("refuses a card you cannot afford, out of phase, or off-turn, with a log line", () => {
    const s0 = withMana(withHand(base(), "you", [card("bulls/raging-bull")]), "you", 3)
    const s1 = playCard(s0, "you", 0)
    expect(s1.you.board).toHaveLength(0)
    expect(s1.log.at(-1)).toMatch(/mana/i)
    const s2 = playCard(withHand(base(), "house", [card("bears/grizzly")]), "house", 0)
    expect(s2.house.board).toHaveLength(0)
  })
  it("burns a creature or a player", () => {
    let s = withBoard(withHand(base(), "you", [card("bulls/short-squeeze"), card("bulls/short-squeeze")]), "house", [{ card: creature("bears/grizzly") }, { card: creature("bears/short-seller") }])
    const [grizzly, seller] = s.house.board
    s = playCard(s, "you", 0, { kind: "creature", uid: seller!.uid })
    expect(s.house.board.map((c) => c.uid)).toEqual([grizzly!.uid])
    s = playCard(s, "you", 0, { kind: "player", side: "house" })
    expect(s.house.life).toBe(17)
  })
  it("marks damage that only kills when it reaches toughness", () => {
    let s = withBoard(withHand(base(), "you", [card("bulls/short-squeeze"), card("bulls/short-squeeze")]), "house", [{ card: creature("bears/grizzly") }])
    const uid = s.house.board[0]!.uid
    s = playCard(s, "you", 0, { kind: "creature", uid })
    expect(s.house.board[0]!.damage).toBe(3)
    s = playCard(s, "you", 0, { kind: "creature", uid })
    expect(s.house.board).toHaveLength(0)
  })
  it("a player-only burn refuses a creature target", () => {
    let s = withBoard(withHand(base(), "you", [card("bulls/flash-crash")]), "house", [{ card: creature("bears/grizzly") }])
    s = playCard(s, "you", 0, { kind: "creature", uid: s.house.board[0]!.uid })
    expect(s.you.hand).toHaveLength(1)
    expect(s.house.board).toHaveLength(1)
  })
  it("destroy, bounce, pump-with-draw, draw, heal, ramp and drain", () => {
    let s = withBoard(withHand(base(), "you", [card("bears/liquidation"), card("quants/arbitrage"), card("quants/alpha-signal"), card("quants/backtest"), card("whales/dividend"), card("whales/compound-interest"), card("bears/bankruptcy")]), "house", [{ card: creature("bears/grizzly") }, { card: creature("bears/vulture-fund") }])
    s = withBoard(s, "you", [{ card: creature("bulls/day-trader") }])
    s = withMana(s, "you", 8)
    const [grizzly, vulture] = s.house.board
    const mine = s.you.board[0]!
    s = playCard(s, "you", 0, { kind: "creature", uid: grizzly!.uid }) // liquidation
    expect(s.house.board.map((c) => c.uid)).toEqual([vulture!.uid])
    s = playCard(s, "you", 0, { kind: "creature", uid: vulture!.uid }) // arbitrage
    expect(s.house.board).toHaveLength(0)
    expect(s.house.hand.map((c) => c.id)).toContain("bears/vulture-fund")
    const handBefore = s.you.hand.length
    s = playCard(s, "you", 0, { kind: "creature", uid: mine.uid }) // alpha signal
    expect(s.you.board[0]).toMatchObject({ pumpP: 2, pumpT: 2 })
    expect(s.you.hand).toHaveLength(handBefore - 1 + 1)
    s = withMana(s, "you", 8)
    const before = s.you.hand.length
    s = playCard(s, "you", 0) // backtest
    expect(s.you.hand).toHaveLength(before - 1 + 2)
    s = { ...s, you: { ...s.you, life: 12 } }
    s = playCard(s, "you", 0) // dividend
    expect(s.you.life).toBe(17)
    s = withMana(s, "you", 3)
    s = playCard(s, "you", 0) // compound interest: crystals 3→4, mana 3-2+1 = 2
    expect(s.you.crystals).toBe(4)
    expect(s.you.mana).toBe(2)
    s = playCard(s, "you", 0) // bankruptcy
    expect(s.house.life).toBe(17)
    expect(s.you.life).toBe(20)
  })
  it("ramp at the cap adds no mana", () => {
    let s = withMana(withHand(base(), "you", [card("whales/compound-interest")]), "you", 8)
    s = playCard(s, "you", 0)
    expect(s.you).toMatchObject({ crystals: 8, mana: 6 })
  })
  it("burn to the face can end the game mid-turn", () => {
    let s = withHand(base(), "you", [card("bulls/flash-crash")])
    s = { ...s, house: { ...s.house, life: 4 } }
    s = playCard(s, "you", 0, { kind: "player", side: "house" })
    expect(s).toMatchObject({ phase: "over", winner: "you", reason: "life" })
  })
  it("legalTargets lists creatures on both boards for a creature spell and both players too for 'any'", () => {
    let s = withBoard(base(), "house", [{ card: creature("bears/grizzly") }])
    s = withBoard(s, "you", [{ card: creature("bulls/day-trader") }])
    const destroy = card("bears/liquidation"); const burn = card("bulls/short-squeeze"); const face = card("bulls/flash-crash")
    if (destroy.kind !== "spell" || burn.kind !== "spell" || face.kind !== "spell") throw new Error()
    expect(legalTargets(s, "you", destroy)).toHaveLength(2)
    expect(legalTargets(s, "you", burn)).toHaveLength(4)
    expect(legalTargets(s, "you", face)).toEqual([{ kind: "player", side: "house" }, { kind: "player", side: "you" }])
  })
})

describe("combat", () => {
  const ready = (id: string) => ({ card: creature(id), enteredTurn: 0 })
  it("summoning sickness: only haste can attack the turn it enters", () => {
    let s = withBoard(base(), "you", [{ card: creature("bulls/day-trader"), enteredTurn: 1 }, { card: creature("bulls/meme-stock"), enteredTurn: 1 }])
    const [trader, meme] = s.you.board
    expect(canAttack(s, trader!)).toBe(true)
    expect(canAttack(s, meme!)).toBe(false)
    s = declareAttackers(s, "you", [meme!.uid])
    expect(s.phase).toBe("main")
    expect(s.attacked).toBe(false)
    s = declareAttackers(s, "you", [trader!.uid])
    expect(s.phase).toBe("blocks")
  })
  it("unblocked damage hits the player and returns to a post-combat main", () => {
    let s = withBoard(base(), "you", [ready("bulls/raging-bull")])
    s = declareAttackers(s, "you", [s.you.board[0]!.uid])
    s = declareBlocks(s, "house", {})
    expect(s.house.life).toBe(15)
    expect(s).toMatchObject({ phase: "main", attacked: true, active: "you" })
    expect(declareAttackers(s, "you", [s.you.board[0]!.uid]).phase).toBe("main")
  })
  it("a blocked pair trade damage; damage wears off at end of turn", () => {
    let s = withBoard(withBoard(base(), "you", [ready("bulls/meme-stock")]), "house", [ready("bears/grizzly")])
    const [meme] = s.you.board; const [grizzly] = s.house.board
    s = declareBlocks(declareAttackers(s, "you", [meme!.uid]), "house", { [meme!.uid]: grizzly!.uid })
    expect(s.you.board).toHaveLength(0)
    expect(s.house.board[0]!.damage).toBe(4)
    expect(s.house.life).toBe(20)
    s = endTurn(s)
    expect(s.house.board[0]!.damage).toBe(0)
  })
  it("flying can only be blocked by flying", () => {
    let s = withBoard(withBoard(base(), "you", [ready("quants/algo-bot")]), "house", [ready("bears/grizzly"), ready("quants/intern-analyst")])
    const [bot] = s.you.board; const [grizzly, intern] = s.house.board
    expect(canBlock(bot!, grizzly!)).toBe(false)
    expect(canBlock(bot!, intern!)).toBe(true)
    s = declareAttackers(s, "you", [bot!.uid])
    const refused = declareBlocks(s, "house", { [bot!.uid]: grizzly!.uid })
    expect(refused.phase).toBe("blocks")
    const ok = declareBlocks(s, "house", { [bot!.uid]: intern!.uid })
    expect(ok.house.board.map((c) => c.uid)).toEqual([grizzly!.uid])
  })
  it("one blocker blocks one attacker", () => {
    let s = withBoard(withBoard(base(), "you", [ready("bulls/day-trader"), ready("bulls/momentum-chaser")]), "house", [ready("bears/grizzly")])
    const [a, b] = s.you.board; const [g] = s.house.board
    s = declareAttackers(s, "you", [a!.uid, b!.uid])
    expect(declareBlocks(s, "house", { [a!.uid]: g!.uid, [b!.uid]: g!.uid }).phase).toBe("blocks")
  })
  it("trample carries the excess over the blocker's remaining toughness", () => {
    // 5/3 trample into a plain 1/1: one to the blocker, four through.
    let s = withBoard(withBoard(base(), "you", [ready("bulls/raging-bull")]), "house", [ready("quants/intern-analyst")])
    const [bull] = s.you.board; const [intern] = s.house.board
    s = declareBlocks(declareAttackers(s, "you", [bull!.uid]), "house", { [bull!.uid]: intern!.uid })
    expect(s.house.board).toHaveLength(0)
    expect(s.house.life).toBe(16)
    expect(s.you.board[0]!.damage).toBe(1)
  })
  it("lifelink heals its controller for damage dealt, including to creatures", () => {
    let s = withBoard(withBoard(base(), "you", [ready("bears/vulture-fund")]), "house", [ready("bears/grizzly")])
    s = { ...s, you: { ...s.you, life: 10 } }
    const [v] = s.you.board; const [g] = s.house.board
    s = declareBlocks(declareAttackers(s, "you", [v!.uid]), "house", { [v!.uid]: g!.uid })
    expect(s.you.life).toBe(13)
    expect(s.you.board).toHaveLength(0)
    let t = withBoard(withBoard(base(), "you", [ready("bulls/meme-stock")]), "house", [ready("bears/short-seller")])
    t = { ...t, house: { ...t.house, life: 10 } }
    const [m] = t.you.board; const [ss] = t.house.board
    t = declareBlocks(declareAttackers(t, "you", [m!.uid]), "house", { [m!.uid]: ss!.uid })
    expect(t.house.life).toBe(11)
  })
  it("pump wears off at end of turn", () => {
    let s = withBoard(withHand(base(), "you", [card("bulls/leveraged-long")]), "you", [ready("bulls/day-trader")])
    s = playCard(s, "you", 0, { kind: "creature", uid: s.you.board[0]!.uid })
    expect(s.you.board[0]!.pumpP).toBe(3)
    s = endTurn(s)
    expect(s.you.board[0]!.pumpP).toBe(0)
  })
  it("lethal combat damage ends the game", () => {
    let s = withBoard(base(), "you", [ready("bears/market-crash")])
    s = { ...s, house: { ...s.house, life: 7 } }
    s = declareBlocks(declareAttackers(s, "you", [s.you.board[0]!.uid]), "house", {})
    expect(s).toMatchObject({ phase: "over", winner: "you", reason: "life" })
  })
  it("only the defender may declare blocks, only in the blocks phase", () => {
    let s = withBoard(base(), "you", [ready("bulls/day-trader")])
    expect(declareBlocks(s, "house", {}).phase).toBe("main")
    s = declareAttackers(s, "you", [s.you.board[0]!.uid])
    expect(declareBlocks(s, "you", {}).phase).toBe("blocks")
  })
})

describe("castable", () => {
  it("needs the turn, the mana, and for a targeted spell a legal target", async () => {
    const { castable } = await import("./duel-sim")
    const s = base()
    expect(castable(s, "you", card("bulls/raging-bull"))).toBe(true)
    expect(castable(withMana(s, "you", 3), "you", card("bulls/raging-bull"))).toBe(false)
    expect(castable(s, "you", card("bulls/leveraged-long"))).toBe(false)
    expect(castable(withBoard(s, "house", [{ card: creature("bears/grizzly") }]), "you", card("bulls/leveraged-long"))).toBe(true)
    expect(castable(s, "you", card("quants/backtest"))).toBe(true)
    expect(castable(s, "house", card("bears/grizzly"))).toBe(false)
  })
})

describe("events", () => {
  const ready = (id: string) => ({ card: creature(id), enteredTurn: 0 })
  it("a burn reports the cast, the damage and the death, and the next action clears them", () => {
    let s = withBoard(withHand(base(), "you", [card("bulls/short-squeeze")]), "house", [{ card: creature("bears/short-seller") }])
    const uid = s.house.board[0]!.uid
    s = playCard(s, "you", 0, { kind: "creature", uid })
    expect(s.events.map((e) => e.kind)).toEqual(["cast", "damage", "destroyed"])
    expect(s.events[2]).toMatchObject({ kind: "destroyed", side: "house", uid, index: 0 })
    s = declareAttackers(s, "you", [])
    expect(s.events).toEqual([])
  })
  it("combat reports the attack, each creature's damage, lifelink and the player hit", () => {
    let s = withBoard(withBoard(base(), "you", [ready("bears/vulture-fund"), ready("bulls/day-trader")]), "house", [ready("bears/grizzly")])
    const [vulture, trader] = s.you.board; const [grizzly] = s.house.board
    s = declareBlocks(declareAttackers(s, "you", [vulture!.uid, trader!.uid]), "house", { [vulture!.uid]: grizzly!.uid })
    const kinds = s.events.map((e) => e.kind)
    expect(kinds[0]).toBe("attack")
    expect(s.events[0]).toMatchObject({ attackers: [{ uid: vulture!.uid, blockerUid: grizzly!.uid }, { uid: trader!.uid, blockerUid: null }] })
    expect(s.events).toContainEqual({ kind: "damage", target: { kind: "creature", uid: grizzly!.uid }, amount: 3 })
    expect(s.events).toContainEqual({ kind: "heal", side: "you", amount: 3 })
    expect(s.events).toContainEqual({ kind: "damage", target: { kind: "player", side: "house" }, amount: 2 })
    expect(s.events.at(-1)).toMatchObject({ kind: "destroyed", uid: vulture!.uid })
  })
  it("summoning, pumping, healing and bouncing each report themselves", () => {
    let s = withBoard(withHand(base(), "you", [card("bulls/day-trader"), card("bulls/leveraged-long"), card("whales/dividend"), card("quants/arbitrage")]), "house", [ready("bears/grizzly")])
    s = playCard(s, "you", 0)
    expect(s.events).toEqual([{ kind: "summon", side: "you", uid: s.you.board[0]!.uid }])
    s = playCard(s, "you", 0, { kind: "creature", uid: s.you.board[0]!.uid })
    expect(s.events.map((e) => e.kind)).toEqual(["cast", "pump"])
    s = playCard(s, "you", 0)
    expect(s.events.map((e) => e.kind)).toEqual(["cast", "heal"])
    s = playCard(s, "you", 0, { kind: "creature", uid: s.house.board[0]!.uid })
    expect(s.events.map((e) => e.kind)).toEqual(["cast", "bounce"])
  })
})
