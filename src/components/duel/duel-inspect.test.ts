import { describe, expect, it } from "vitest"
import { DECKS } from "./decks"
import type { Card, CreatureCard } from "./cards"
import { createDuel, declareAttackers, type Creature } from "./duel-sim"
import { effectText, inspectDetails } from "./duel-inspect"

const card = (id: string): Card => { const c = DECKS.flatMap((d) => d.cards).find((c) => c.id === id); if (!c) throw new Error(id); return c }
const onBoard = (id: string, over: Partial<Creature> = {}): Creature => ({ uid: 1, card: card(id) as CreatureCard, damage: 0, pumpP: 0, pumpT: 0, enteredTurn: 0, ...over })

describe("inspectDetails", () => {
  it("explains a creature's keyword and printed stats from the hand, and what it costs you", () => {
    const s = createDuel("bulls", "bears", 1)
    const d = inspectDetails({ card: card("bulls/raging-bull"), owner: "you", where: "hand" }, s)
    expect(d).toMatchObject({ title: "Raging Bull", typeLine: "Creature · 4 mana", stats: "5/3", flavor: "Do not stand in front of it." })
    expect(d.lines).toEqual([
      "Trample: When blocked, damage beyond what its blocker can take goes through to the player.",
      "Costs 4 mana; you have 1 this turn.",
    ])
  })
  it("shows a creature's state on the board: boost, damage, just arrived, attacking", () => {
    let s = createDuel("bulls", "bears", 1)
    const c = onBoard("bulls/meme-stock", { uid: 7, pumpP: 3, pumpT: 1, damage: 2, enteredTurn: 1 })
    s = { ...s, you: { ...s.you, board: [c] } }
    const d = inspectDetails({ card: c.card, creature: c, owner: "you", where: "board" }, s)
    expect(d.stats).toBe("7/1")
    expect(d.lines).toEqual([
      "No special ability: it attacks and blocks.",
      "Boosted +3/+1 until end of turn (printed 4/2).",
      "Has taken 2 damage this turn; it heals at the end of the turn.",
      "Just arrived: it can attack from next turn.",
    ])
    const ready = onBoard("bulls/day-trader", { uid: 8 })
    let t = { ...createDuel("bulls", "bears", 1) }
    t = { ...t, you: { ...t.you, board: [ready] } }
    t = declareAttackers(t, "you", [8])
    expect(inspectDetails({ card: ready.card, creature: ready, owner: "you", where: "board" }, t).lines).toContain("Attacking right now.")
  })
  it("gives a spell its full rule, and says nothing about cost for the house's cards", () => {
    const s = createDuel("bulls", "bears", 1)
    expect(inspectDetails({ card: card("quants/alpha-signal"), owner: "you", where: "hand" }, s).lines[0])
      .toBe("A creature you choose gets +2 power and +2 toughness until the end of the turn. Then you draw 1 card.")
    const d = inspectDetails({ card: card("bears/liquidation"), owner: "house", where: "hand" }, s)
    expect(d).toMatchObject({ typeLine: "Spell · 3 mana", stats: null, lines: ["Destroys a creature you choose, whatever its toughness."] })
  })
  it("keeps the short face text for the card itself", () => {
    const e = card("bulls/short-squeeze"); if (e.kind !== "spell") throw new Error()
    expect(effectText(e.effect)).toBe("Deal 3 damage to any target")
  })
})
