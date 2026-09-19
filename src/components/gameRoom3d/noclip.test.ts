import { describe, expect, it } from "vitest"
import { parseNoclipOverride } from "./noclip"

describe("parseNoclipOverride", () => {
  it("reads the documented spelling", () => {
    expect(parseNoclipOverride("?noclip=1")).toBe(true)
  })

  it("accepts the other ways a person types a URL flag", () => {
    expect(parseNoclipOverride("?noclip")).toBe(true)
    expect(parseNoclipOverride("?noclip=")).toBe(true)
    expect(parseNoclipOverride("?noclip=true")).toBe(true)
    expect(parseNoclipOverride("?noclip=YES")).toBe(true)
    expect(parseNoclipOverride("?noclip=on")).toBe(true)
    expect(parseNoclipOverride("noclip=1")).toBe(true)
  })

  it("leaves the room solid for anything it does not understand", () => {
    expect(parseNoclipOverride("")).toBe(false)
    expect(parseNoclipOverride("?quality=low")).toBe(false)
    expect(parseNoclipOverride("?noclip=0")).toBe(false)
    expect(parseNoclipOverride("?noclip=false")).toBe(false)
    expect(parseNoclipOverride("?noclip=maybe")).toBe(false)
  })

  it("does not fire on a param that merely starts the same way", () => {
    expect(parseNoclipOverride("?noclipping=1")).toBe(false)
  })

  it("coexists with the other room overrides", () => {
    expect(parseNoclipOverride("?tod=dusk&noclip=1&quality=low")).toBe(true)
  })
})
