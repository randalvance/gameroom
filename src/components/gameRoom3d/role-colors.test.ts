import { describe, expect, it } from "vitest"
import { roleHaloColor } from "./role-colors"

describe("roleHaloColor", () => {
  it("rings a visitor green, a host gold and a screen red", () => {
    expect(roleHaloColor("visitor")).toBe(0x40ff88)
    expect(roleHaloColor(undefined)).toBe(0x40ff88)
    expect(roleHaloColor("host")).toBe(0xffd040)
    expect(roleHaloColor("screen")).toBe(0xff4040)
  })
})
