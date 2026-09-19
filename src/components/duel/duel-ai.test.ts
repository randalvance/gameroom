import { describe, expect, it } from "vitest"
import { DECKS } from "./decks"
import type { Card, CreatureCard } from "./cards"
import { createDuel, declareAttackers, endTurn, type DuelState, type Side } from "./duel-sim"
import { houseBlocks, houseNextMainAction } from "./duel-ai"

const card = (id: string): Card => { const c = DECKS.flatMap((d) => d.cards).find((c) => c.id === id); if (!c) throw new Error(id); return c }
const creature = (id: string): CreatureCard => { const c = card(id); if (c.kind !== "creature") throw new Error(id); return c }
const withHand = (s: DuelState, side: Side, cards: Card[]): DuelState => ({ ...s, [side]: { ...s[side], hand: cards } })
const withMana = (s: DuelState, side: Side, mana: number): DuelState => ({ ...s, [side]: { ...s[side], crystals: mana, mana } })
const withLife = (s: DuelState, side: Side, life: number): DuelState => ({ ...s, [side]: { ...s[side], life } })
const withBoard = (s: DuelState, side: Side, ids: string[], enteredTurn = 0): DuelState => {
  let uid = s.nextUid
  const board = ids.map((id) => ({ uid: uid++, card: creature(id), damage: 0, pumpP: 0, pumpT: 0, enteredTurn }))
  return { ...s, nextUid: uid, [side]: { ...s[side], board: [...s[side].board, ...board] } }
}
/** The house's main phase with an empty hand and 8 mana. */
const houseMain = () => withMana(withHand(endTurn(createDuel("bulls", "bears", 1)), "house", []), "house", 8)

describe("houseNextMainAction", () => {
  it("plays the most expensive affordable creature first", () => {
    const s = withMana(withHand(houseMain(), "house", [card("bears/short-seller"), card("bears/grizzly"), card("bears/market-crash")]), "house", 5)
    expect(houseNextMainAction(s)).toMatchObject({ kind: "play", handIdx: 1, name: "Grizzly" })
  })
  it("ramps and draws before creatures", () => {
    const s = withHand(houseMain(), "house", [card("whales/humpback"), card("whales/compound-interest")])
    expect(houseNextMainAction(s)).toMatchObject({ kind: "play", handIdx: 1 })
  })
  it("removes the biggest enemy creature it can kill", () => {
    let s = withHand(houseMain(), "house", [card("bears/bear-raid")])
    s = withBoard(s, "you", ["bears/market-crash", "bulls/raging-bull", "bulls/day-trader"])
    const bull = s.you.board[1]!
    expect(houseNextMainAction(s)).toMatchObject({ kind: "play", handIdx: 0, target: { kind: "creature", uid: bull.uid } })
  })
  it("burns the face when that is lethal", () => {
    let s = withLife(withHand(houseMain(), "house", [card("bulls/short-squeeze")]), "you", 3)
    s = withBoard(s, "you", ["bulls/day-trader"])
    expect(houseNextMainAction(s)).toMatchObject({ kind: "play", target: { kind: "player", side: "you" } })
  })
  it("heals only when low", () => {
    const hi = withHand(houseMain(), "house", [card("whales/dividend")])
    expect(houseNextMainAction(hi)).toMatchObject({ kind: "attack" })
    expect(houseNextMainAction(withLife(hi, "house", 9))).toMatchObject({ kind: "play", handIdx: 0 })
  })
  it("pumps only a creature that is about to attack", () => {
    const s = withHand(houseMain(), "house", [card("bulls/leveraged-long")])
    const sick = withBoard(s, "house", ["bears/grizzly"], s.turn)
    expect(houseNextMainAction(sick)).toMatchObject({ kind: "attack", uids: [] })
    const ready = withBoard(s, "house", ["bears/grizzly"])
    expect(houseNextMainAction(ready)).toMatchObject({ kind: "play", handIdx: 0, target: { kind: "creature", uid: ready.house.board[0]!.uid } })
  })
  it("with nothing to play it attacks with safe creatures only", () => {
    let s = withBoard(houseMain(), "house", ["bears/grizzly", "bears/short-seller"])
    s = withBoard(s, "you", ["bulls/meme-stock"])
    const [grizzly] = s.house.board
    expect(houseNextMainAction(s)).toEqual({ kind: "attack", uids: [grizzly!.uid] })
  })
  it("trades up when ahead on life", () => {
    let s = withBoard(houseMain(), "house", ["bulls/meme-stock"])
    s = withBoard(s, "you", ["bulls/momentum-chaser"])
    expect(houseNextMainAction(withLife(s, "you", 15))).toMatchObject({ kind: "attack", uids: [s.house.board[0]!.uid] })
    expect(houseNextMainAction(withLife(s, "house", 10))).toMatchObject({ kind: "attack", uids: [] })
  })
  it("goes all-in when the total is lethal and you cannot block them all", () => {
    let s = withBoard(houseMain(), "house", ["bears/short-seller", "bears/short-seller", "bears/short-seller"])
    s = withBoard(s, "you", ["bears/grizzly"])
    s = withLife(s, "you", 3)
    expect(houseNextMainAction(s)).toMatchObject({ kind: "attack", uids: s.house.board.map((c) => c.uid) })
  })
  it("after attacking it plays leftover creatures then ends", () => {
    let s = withBoard(houseMain(), "house", ["bears/grizzly"])
    s = declareAttackers(s, "house", [])
    expect(houseNextMainAction(withHand(s, "house", [card("bears/short-seller")]))).toMatchObject({ kind: "play", handIdx: 0 })
    expect(houseNextMainAction(s)).toEqual({ kind: "end" })
  })
})

describe("houseBlocks", () => {
  const attacking = (s: DuelState) => declareAttackers(s, "you", s.you.board.map((c) => c.uid))
  it("blocks with a creature that kills and survives", () => {
    let s = withBoard(withBoard(createDuel("bulls", "bears", 1), "you", ["bulls/meme-stock"]), "house", ["bears/short-seller", "bears/grizzly"])
    s = attacking(s)
    expect(houseBlocks(s)).toEqual({ [s.you.board[0]!.uid]: s.house.board[1]!.uid })
  })
  it("respects flying and does not chump when healthy", () => {
    const s = withBoard(withBoard(createDuel("bulls", "bears", 1), "you", ["quants/algo-bot"]), "house", ["bears/grizzly"])
    expect(houseBlocks(attacking(s))).toEqual({})
    const t = withBoard(withBoard(createDuel("bulls", "bears", 1), "you", ["bulls/raging-bull"]), "house", ["bears/short-seller"])
    expect(houseBlocks(attacking(t))).toEqual({})
  })
  it("chumps the biggest attacker when the damage would leave it at six or less", () => {
    let s = withBoard(withBoard(createDuel("bulls", "bears", 1), "you", ["bulls/raging-bull", "bulls/day-trader"]), "house", ["bears/short-seller"])
    s = withLife(s, "house", 10)
    s = attacking(s)
    expect(houseBlocks(s)).toEqual({ [s.you.board[0]!.uid]: s.house.board[0]!.uid })
  })
  it("never uses one blocker twice", () => {
    const s = withBoard(withBoard(createDuel("bulls", "bears", 1), "you", ["bulls/day-trader", "bulls/day-trader"]), "house", ["bears/grizzly"])
    const blocks = houseBlocks(attacking(s))
    expect(Object.keys(blocks)).toHaveLength(1)
  })
})
