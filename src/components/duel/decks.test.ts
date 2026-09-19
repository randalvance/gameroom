import { describe, expect, it } from "vitest"
import { createRng } from "./rng"
import { COPIES, DECKS, DECK_BY_ID, buildDeck, exhibitionOrdinal, houseDeckForDesk } from "./decks"

describe("DECKS", () => {
  it("has four decks of eight unique cards in ascending cost", () => {
    expect(DECKS.map((d) => d.id)).toEqual(["bulls", "bears", "quants", "whales"])
    for (const deck of DECKS) {
      expect(deck.cards).toHaveLength(8)
      expect(new Set(deck.cards.map((c) => c.id)).size).toBe(8)
      for (const card of deck.cards) expect(card.id.startsWith(`${deck.id}/`)).toBe(true)
      const costs = deck.cards.map((c) => c.cost)
      expect(costs).toEqual([...costs].sort((a, b) => a - b))
    }
  })
  it("every creature has positive stats", () => {
    for (const deck of DECKS) for (const card of deck.cards) {
      if (card.kind !== "creature") continue
      expect(card.power).toBeGreaterThan(0)
      expect(card.toughness).toBeGreaterThan(0)
    }
  })
})

describe("buildDeck", () => {
  it("deals 20 cards with the 3/3/3/3/2/2/2/2 split", () => {
    expect(COPIES).toEqual([3, 3, 3, 3, 2, 2, 2, 2])
    const deck = buildDeck("bulls", createRng(1))
    expect(deck).toHaveLength(20)
    const counts = new Map<string, number>()
    for (const c of deck) counts.set(c.id, (counts.get(c.id) ?? 0) + 1)
    DECK_BY_ID.bulls.cards.forEach((card, i) => expect(counts.get(card.id)).toBe(COPIES[i]))
  })
  it("is shuffled but deterministic for a seed", () => {
    const a = buildDeck("quants", createRng(5)).map((c) => c.id)
    const b = buildDeck("quants", createRng(5)).map((c) => c.id)
    expect(a).toEqual(b)
    const sorted = DECK_BY_ID.quants.cards.flatMap((c, i) => Array(COPIES[i]).fill(c.id))
    expect(a).not.toEqual(sorted)
  })
})

describe("house deck for a desk", () => {
  it("counts exhibition desks in room order and cycles the decks", () => {
    const competing = [true, true, false, true, false, false]
    expect(exhibitionOrdinal(competing, 2)).toBe(0)
    expect(exhibitionOrdinal(competing, 4)).toBe(1)
    expect(exhibitionOrdinal(competing, 5)).toBe(2)
    expect(exhibitionOrdinal(competing, 0)).toBe(-1)
    expect([0, 1, 2, 3, 4].map(houseDeckForDesk)).toEqual(["bulls", "bears", "quants", "whales", "bulls"])
  })
})
