import { describe, expect, it } from "vitest"

import { keepMovementTrade } from "./movement-trades"

describe("keepMovementTrade", () => {
  it("keeps student↔bot", () => {
    expect(keepMovementTrade(false, true)).toBe(true)
    expect(keepMovementTrade(true, false)).toBe(true)
  })
  it("keeps student↔student", () => {
    expect(keepMovementTrade(false, false)).toBe(true)
  })
  it("drops bot↔bot", () => {
    expect(keepMovementTrade(true, true)).toBe(false)
  })
})
