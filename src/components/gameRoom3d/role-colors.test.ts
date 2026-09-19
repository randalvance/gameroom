import { describe, expect, it } from "vitest"
import { roleHaloColor } from "./role-colors"

describe("roleHaloColor", () => {
  it("uses green for students", () => expect(roleHaloColor("student")).toBe(0x40ff88))
  it("uses red for mentors and judges", () => {
    expect(roleHaloColor("mentor")).toBe(0xff4040)
    expect(roleHaloColor("judge")).toBe(0xff4040)
  })
  it("uses yellow for admins", () => expect(roleHaloColor("admin")).toBe(0xffd040))
  it("keeps legacy or roleless characters green", () => {
    expect(roleHaloColor(undefined)).toBe(0x40ff88)
    expect(roleHaloColor("viewer")).toBe(0x40ff88)
  })
})
