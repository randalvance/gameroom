import { describe, expect, it } from "vitest"
import { DEFAULT_HOLD_SECONDS, parseBulletinInput } from "./game-room-control"

describe("parseBulletinInput", () => {
  it("carries the message and the hold", () => {
    expect(parseBulletinInput({ message: "Lunch at 12:30.", holdSeconds: 30 })).toEqual({
      message: "Lunch at 12:30.",
      holdSeconds: 30,
    })
  })

  it("defaults the hold when none was chosen", () => {
    expect(parseBulletinInput({ message: "Hi." })).toMatchObject({
      holdSeconds: DEFAULT_HOLD_SECONDS,
    })
  })

  it("refuses a hold the wall will not honour", () => {
    expect(() => parseBulletinInput({ message: "Hi.", holdSeconds: 0 })).toThrow(/INVALID_INPUT/)
    expect(() => parseBulletinInput({ message: "Hi.", holdSeconds: "soon" })).toThrow(/INVALID_INPUT/)
  })

  it("refuses a bulletin with no message in it", () => {
    expect(() => parseBulletinInput({ message: "   " })).toThrow(/INVALID_INPUT/)
    expect(() => parseBulletinInput({ message: 42 })).toThrow(/INVALID_INPUT/)
    expect(() => parseBulletinInput({})).toThrow(/INVALID_INPUT/)
  })
})
