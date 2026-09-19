import { describe, expect, it } from "vitest"
import { censor } from "./profanity"

describe("censor", () => {
  it("leaves clean text byte-identical", () => {
    const clean = "gm team, orders are flowing"
    expect(censor(clean)).toBe(clean)
  })

  it("masks a swear word with one star per character", () => {
    expect(censor("fuck")).toBe("****")
  })

  it("masks mid-sentence and leaves the rest of the line alone", () => {
    expect(censor("this shit is broken")).toBe("this **** is broken")
  })

  it("masks regardless of the casing typed", () => {
    expect(censor("FUCK this")).toBe("**** this")
  })

  it("masks every occurrence, not just the first", () => {
    expect(censor("shit shit")).toBe("**** ****")
  })

  it("sees through leetspeak substitutions", () => {
    expect(censor("sh1t")).toBe("****")
    expect(censor("f4ggot")).toBe("******")
  })

  it("sees through padded-out letters", () => {
    expect(censor("shiiiit")).toBe("*******")
  })

  it("sees through letters spaced or punctuated apart", () => {
    expect(censor("s h i t")).toBe("*******")
    expect(censor("f.u.c.k")).toBe("*******")
  })

  // The Scunthorpe problem: naive substring matching bleeps innocent words.
  it("leaves innocent words that merely contain a swear alone", () => {
    for (const ok of ["Scunthorpe", "classic", "assess", "Dickinson", "shitake"]) {
      expect(censor(ok)).toBe(ok)
    }
  })

  it("leaves mild words alone", () => {
    const mild = "damn this hell of a crap trade"
    expect(censor(mild)).toBe(mild)
  })

  it("masks slurs as well as profanity", () => {
    expect(censor("you retard")).toBe("you ******")
  })
})
