import { describe, expect, it } from "vitest"
import { DECKS } from "./decks"
import type { CreatureCard, SpellCard } from "./cards"
import type { DuelEvent } from "./duel-sim"
import { fxClasses, fxFromEvents } from "./duel-effects"

const spell = DECKS[0]!.cards.find((c) => c.kind === "spell") as SpellCard
const creature = DECKS[0]!.cards.find((c) => c.kind === "creature") as CreatureCard

describe("fxFromEvents", () => {
  it("maps each event to the item the screen animates, tagged with the batch", () => {
    const events: DuelEvent[] = [
      { kind: "cast", side: "house", card: spell, target: { kind: "player", side: "you" } },
      { kind: "attack", side: "you", attackers: [{ uid: 4, blockerUid: null }, { uid: 5, blockerUid: 9 }] },
      { kind: "damage", target: { kind: "creature", uid: 9 }, amount: 3 },
      { kind: "damage", target: { kind: "player", side: "house" }, amount: 2 },
      { kind: "heal", side: "you", amount: 3 },
      { kind: "pump", uid: 4, power: 3, toughness: 0 },
      { kind: "destroyed", side: "house", uid: 9, index: 1, card: creature },
      { kind: "bounce", side: "you", uid: 5, index: 0, card: creature },
      { kind: "summon", side: "you", uid: 6 },
    ]
    const items = fxFromEvents(events, 7)
    expect(items.every((i) => i.id === 7)).toBe(true)
    expect(items.map((i) => [i.key, i.kind])).toEqual([
      ["cast", "cast"], ["c:4", "lunge"], ["c:5", "lunge"], ["c:9", "hit"], ["p:house", "hit"],
      ["p:you", "glow"], ["c:4", "glow"], ["c:9", "ghost"], ["c:5", "ghost"], ["c:6", "summon"],
    ])
    expect(items[3]).toMatchObject({ text: "-3" })
    expect(items[5]).toMatchObject({ tone: "gain", text: "+3" })
    expect(items[6]).toMatchObject({ tone: "pump", text: "+3/+0" })
    expect(items[7]).toMatchObject({ tone: "dissolve", index: 1 })
    expect(items[8]).toMatchObject({ tone: "bounce" })
  })
  it("turns items into the classes a card wears", () => {
    const items = fxFromEvents([
      { kind: "attack", side: "you", attackers: [{ uid: 1, blockerUid: null }] },
      { kind: "damage", target: { kind: "creature", uid: 1 }, amount: 1 },
      { kind: "pump", uid: 1, power: 1, toughness: 1 },
    ], 1)
    expect(fxClasses(items)).toBe("duel-fx-lunge-you duel-fx-hit duel-fx-glow-pump")
    expect(fxClasses([])).toBe("")
  })
})
