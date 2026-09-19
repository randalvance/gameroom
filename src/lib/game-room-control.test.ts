import { describe, expect, it } from "vitest"
import { SCREEN_PAGES } from "~/components/gameRoom3d/screen-pages"
import { DEFAULT_ANNOUNCEMENT_VOICE_ID } from "./announcement-voices"
import { DEFAULT_HOLD_SECONDS, parseBulletinInput, parseScreenPageInput } from "./game-room-control"

describe("parseScreenPageInput", () => {
  it("accepts every page the wall can actually turn to", () => {
    for (const page of SCREEN_PAGES) {
      expect(parseScreenPageInput({ page })).toBe(page)
    }
  })

  it("reads null as handing the wall back to the players", () => {
    expect(parseScreenPageInput({ page: null })).toBeNull()
  })

  // A page name the room does not have would pin the wall to nothing.
  it("refuses a page the room has never heard of", () => {
    expect(() => parseScreenPageInput({ page: "scoreboard" })).toThrow(/INVALID_INPUT/)
    expect(() => parseScreenPageInput({ page: 3 })).toThrow(/INVALID_INPUT/)
    expect(() => parseScreenPageInput({})).toThrow(/INVALID_INPUT/)
  })
})

describe("parseBulletinInput", () => {
  it("carries the message and the instrument it concerns", () => {
    expect(parseBulletinInput({ message: "Lunch at 12:30.", affectedSymbol: "AXON" })).toMatchObject({
      message: "Lunch at 12:30.",
      affectedSymbol: "AXON",
    })
  })

  it("treats a missing symbol as concerning no instrument", () => {
    expect(parseBulletinInput({ message: "Lunch at 12:30." })).toMatchObject({
      message: "Lunch at 12:30.",
      affectedSymbol: "",
    })
  })

  // A typed announcement is the common case; a replay has to opt out of the
  // voice deliberately rather than every caller having to ask for it.
  it("is spoken unless the caller says otherwise", () => {
    expect(parseBulletinInput({ message: "Hi." }).spoken).toBe(true)
    expect(parseBulletinInput({ message: "Hi.", spoken: false }).spoken).toBe(false)
  })

  it("defaults the announcer and the hold when neither was chosen", () => {
    expect(parseBulletinInput({ message: "Hi." })).toMatchObject({
      voiceId: DEFAULT_ANNOUNCEMENT_VOICE_ID,
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
