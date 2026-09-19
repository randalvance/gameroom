import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { DECKS } from "./decks"
import { CARD_ART, CARD_BACK, DECK_ART, MANA_CRYSTAL, PLAYMAT } from "./card-art.generated"

const publicDir = join(__dirname, "../../../public")

describe("card art", () => {
  it("has a shipped webp for every card, deck emblem, faction playmat, the back and the mana crystal", () => {
    const urls = [
      ...DECKS.flatMap((d) => d.cards).map((c) => CARD_ART[c.id]),
      ...DECKS.map((d) => DECK_ART[d.id]),
      ...DECKS.map((d) => PLAYMAT[d.id]),
      CARD_BACK, MANA_CRYSTAL,
    ]
    for (const url of urls) {
      expect(url, "missing art entry").toMatch(/^\/assets\/duel\/[a-z0-9-]+\.webp$/)
      expect(existsSync(join(publicDir, url!)), `missing file ${url}`).toBe(true)
    }
  })
})
