import { describe, expect, it } from "vitest"
import { DECKS } from "./decks"
import type { CreatureCard, SpellCard } from "./cards"
import type { DuelEvent } from "./duel-sim"
import { cuesForEvents } from "./audio-cues"

const spell = (id: string) => DECKS.flatMap((d) => d.cards).find((c) => c.id === id) as SpellCard
const creature = DECKS[0]!.cards.find((c) => c.kind === "creature") as CreatureCard

describe("cuesForEvents", () => {
  it("a burn crackles instead of thudding, and a death shatters", () => {
    const events: DuelEvent[] = [
      { kind: "cast", side: "you", card: spell("bulls/short-squeeze"), target: { kind: "creature", uid: 1 } },
      { kind: "damage", target: { kind: "creature", uid: 1 }, amount: 3 },
      { kind: "destroyed", side: "house", uid: 1, index: 0, card: creature },
    ]
    expect(cuesForEvents(events)).toEqual(["spell", "burn", "destroy"])
  })
  it("combat is a swing, one hit however many land, a heal for lifelink", () => {
    const events: DuelEvent[] = [
      { kind: "attack", side: "you", attackers: [{ uid: 1, blockerUid: 2 }, { uid: 3, blockerUid: null }] },
      { kind: "damage", target: { kind: "creature", uid: 2 }, amount: 3 },
      { kind: "damage", target: { kind: "creature", uid: 1 }, amount: 5 },
      { kind: "heal", side: "you", amount: 3 },
      { kind: "damage", target: { kind: "player", side: "house" }, amount: 2 },
    ]
    expect(cuesForEvents(events)).toEqual(["attack", "hit", "heal"])
  })
  it("a summon slaps the card down then whumps; a drain is one dark sound", () => {
    expect(cuesForEvents([{ kind: "summon", side: "you", uid: 1 }])).toEqual(["card", "summon"])
    expect(cuesForEvents([
      { kind: "cast", side: "house", card: spell("bears/bankruptcy") },
      { kind: "heal", side: "house", amount: 3 },
      { kind: "damage", target: { kind: "player", side: "you" }, amount: 3 },
    ])).toEqual(["spell", "drain"])
  })
  it("pump and bounce have their own cues; nothing for nothing", () => {
    expect(cuesForEvents([{ kind: "pump", uid: 1, power: 3, toughness: 0 }])).toEqual(["pump"])
    expect(cuesForEvents([{ kind: "bounce", side: "you", uid: 1, index: 0, card: creature }])).toEqual(["bounce"])
    expect(cuesForEvents([])).toEqual([])
  })
})
