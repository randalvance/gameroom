import { describe, expect, it } from "vitest"
import { tableInteractAction } from "./table-interact-action"

describe("tableInteractAction", () => {
  const teams = [{ competing: true }, { competing: false }, {}]
  it("opens the duel only at an explicitly non-competing desk", () => {
    expect(tableInteractAction(teams, 0)).toBe("menu")
    expect(tableInteractAction(teams, 1)).toBe("duel")
    expect(tableInteractAction(teams, 2)).toBe("menu")
    expect(tableInteractAction(teams, 7)).toBe("menu")
  })
})
