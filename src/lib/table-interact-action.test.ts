import { describe, expect, it } from "vitest"
import { HOUSE_TABLE_IDXS } from "~/components/gameRoom/constants"
import { deskInteractAction } from "./table-interact-action"

describe("deskInteractAction", () => {
  it("opens the duel only at a house desk", () => {
    for (const idx of HOUSE_TABLE_IDXS) expect(deskInteractAction(idx)).toBe("duel")
    expect(deskInteractAction(0)).toBe("menu")
    expect(deskInteractAction(7)).toBe("menu")
  })
})
