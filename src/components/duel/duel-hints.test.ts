import { describe, expect, it } from "vitest"
import { DECKS } from "./decks"
import type { Card, CreatureCard } from "./cards"
import { createDuel, declareAttackers, endTurn, type DuelState, type Side } from "./duel-sim"
import { duelHint, type HintUi } from "./duel-hints"

const card = (id: string): Card => { const c = DECKS.flatMap((d) => d.cards).find((c) => c.id === id); if (!c) throw new Error(id); return c }
const creature = (id: string) => card(id) as CreatureCard
const withHand = (s: DuelState, side: Side, ids: string[]): DuelState => ({ ...s, [side]: { ...s[side], hand: ids.map(card) } })
const withMana = (s: DuelState, side: Side, mana: number): DuelState => ({ ...s, [side]: { ...s[side], crystals: mana, mana } })
const withBoard = (s: DuelState, side: Side, ids: string[], enteredTurn = 0): DuelState => {
  let uid = s.nextUid
  const board = ids.map((id) => ({ uid: uid++, card: creature(id), damage: 0, pumpP: 0, pumpT: 0, enteredTurn }))
  return { ...s, nextUid: uid, [side]: { ...s[side], board: [...s[side].board, ...board] } }
}
const ui = (over: Partial<HintUi> = {}): HintUi => ({ chosenAttackers: 0, pendingBlocker: false, ...over })
const base = () => withHand(withMana(createDuel("bulls", "bears", 1), "you", 2), "you", [])

describe("duelHint on your turn", () => {
  it("says to end the turn when nothing in hand is affordable", () => {
    const s = withHand(base(), "you", ["bulls/raging-bull"])
    expect(duelHint(s, ui())).toEqual({ text: expect.stringMatching(/^Not enough mana.*End turn/), nudge: "primary", tone: "act" })
  })
  it("does not suggest pumping the house's creature", () => {
    const s = withBoard(withHand(base(), "you", ["bulls/leveraged-long"]), "house", ["bears/short-seller"])
    expect(duelHint(s, ui())!.nudge).toBe("primary")
    const mine = withBoard(s, "you", ["bulls/meme-stock"], s.turn)
    expect(duelHint(mine, ui())!.nudge).toBe("hand")
  })
  it("does not point at a spell with nothing to aim at", () => {
    const s = withHand(base(), "you", ["bulls/leveraged-long"])
    expect(duelHint(s, ui())).toMatchObject({ nudge: "primary", text: expect.stringMatching(/^Your spells need a creature to aim at/) })
    const mixed = withHand(base(), "you", ["bulls/leveraged-long", "bulls/raging-bull"])
    expect(duelHint(mixed, ui())!.text).toMatch(/^Not enough mana/)
  })
  it("points at the hand when a card is affordable, and explains cost on turn one", () => {
    const h = duelHint(withHand(base(), "you", ["bulls/day-trader", "bulls/raging-bull"]), ui())
    expect(h).toMatchObject({ nudge: "hand" })
    expect(h!.text).toMatch(/You have 2 mana\. Click a card you can afford/)
    expect(h!.text).toMatch(/corner is its cost/)
  })
  it("mentions that new creatures wait a turn", () => {
    const s = withBoard(withHand(base(), "you", ["bulls/day-trader"]), "you", ["bulls/meme-stock"], 1)
    expect(duelHint(s, ui())!.text).toMatch(/attack from your next turn, unless they have Haste/)
  })
  it("says ready to attack when creatures can and nothing is affordable", () => {
    const s = withBoard(withHand(base(), "you", ["bulls/raging-bull"]), "you", ["bulls/meme-stock"])
    expect(duelHint(s, ui())).toMatchObject({ nudge: "attackers", text: expect.stringMatching(/^Ready to attack/) })
  })
  it("offers both when a card is affordable and creatures are ready", () => {
    const s = withBoard(withHand(base(), "you", ["bulls/day-trader"]), "you", ["bulls/meme-stock"])
    expect(duelHint(s, ui())).toMatchObject({ nudge: "hand-and-attackers" })
  })
  it("once attackers are chosen, points at the attack button", () => {
    const s = withBoard(base(), "you", ["bulls/meme-stock", "bulls/day-trader"])
    expect(duelHint(s, ui({ chosenAttackers: 2 }))).toMatchObject({ nudge: "primary", text: "Press Attack with 2 to send them in. The house may block." })
  })
  it("after combat, suggests a leftover card or ending the turn", () => {
    let s = withBoard(base(), "you", ["bulls/meme-stock"])
    s = declareAttackers(s, "you", [])
    expect(duelHint(withHand(s, "you", ["bulls/day-trader"]), ui())).toMatchObject({ nudge: "hand", text: expect.stringMatching(/^Combat's done/) })
    expect(duelHint(s, ui())).toMatchObject({ nudge: "primary", text: "Nothing more to do this turn. Press End turn." })
  })
  it("walks you through picking a target", () => {
    const h = duelHint(base(), ui({ pendingCard: card("bulls/short-squeeze") }))
    expect(h).toEqual({ text: "Pick a glowing creature or life total for Short Squeeze. Esc cancels.", nudge: null, tone: "act" })
    expect(duelHint(base(), ui({ pendingCard: card("bears/liquidation") }))!.text).toMatch(/^Pick a glowing creature for/)
  })
})

describe("duelHint while the house acts", () => {
  const houseTurn = () => endTurn(base())
  it("waits during the house's own turn", () => {
    expect(duelHint(houseTurn(), ui())).toEqual({ text: "The house is taking its turn…", nudge: null, tone: "wait" })
  })
  it("explains blocking, flyers, and the second click", () => {
    let s = withBoard(withBoard(houseTurn(), "house", ["quants/algo-bot"]), "you", ["quants/intern-analyst"])
    s = declareAttackers(s, "house", [s.house.board[0]!.uid])
    const h = duelHint(s, ui())!
    expect(h.nudge).toBe("blockers")
    expect(h.text).toMatch(/^The house attacks with 1 for 2 damage\. To block, click your creature, then the attacker\./)
    expect(h.text).toMatch(/Only flyers can block flyers\./)
    expect(duelHint(s, ui({ pendingBlocker: true }))!.text).toBe("Now click the attacker it should block.")
  })
  it("says to confirm when nothing can block", () => {
    let s = withBoard(withBoard(houseTurn(), "house", ["quants/algo-bot"]), "you", ["bears/grizzly"])
    s = declareAttackers(s, "house", [s.house.board[0]!.uid])
    expect(duelHint(s, ui())).toMatchObject({ nudge: "primary", text: expect.stringMatching(/Nothing of yours can block, so press Confirm blocks\./) })
  })
  it("waits while the house decides blocks, and says nothing once the game is over", () => {
    let s = withBoard(base(), "you", ["bulls/meme-stock"])
    s = declareAttackers(s, "you", [s.you.board[0]!.uid])
    expect(duelHint(s, ui())).toMatchObject({ tone: "wait" })
    expect(duelHint({ ...s, phase: "over", winner: "you" }, ui())).toBeNull()
  })
})
