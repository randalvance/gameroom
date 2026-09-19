import { describe, expect, it } from "vitest"
import { marketNewsHeader } from "./useMarketNews"

describe("marketNewsHeader", () => {
  it("names a scripted event the wall has no film for", () => {
    // The projector would have cut to a broadcast; with none filmed, the
    // banner itself has to say this is a market event and not a notice.
    expect(marketNewsHeader({ message: "BREAKING: rate cut.", affectedSymbol: "CRVX", clip: null, placeholder: true }))
      .toBe("◆ MARKET EVENT ONGOING ◆")
  })

  it("keeps the generic header for an ad-hoc bulletin", () => {
    // "Lunch is in the atrium" travels the same path and is not a market event.
    expect(marketNewsHeader({ message: "Lunch at 12:30.", affectedSymbol: "", clip: null, placeholder: false }))
      .toBe("◆ ANNOUNCEMENT ◆")
  })
})
