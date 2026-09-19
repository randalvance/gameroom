import { describe, expect, it } from "vitest"
import {
  ANNOUNCEMENT_PREFIX,
  ANNOUNCEMENT_VOICES,
  DEFAULT_ANNOUNCEMENT_VOICE_ID,
  resolveVoiceId,
  spokenAnnouncement,
} from "./announcement-voices"

describe("the voices the gamemaster can pick", () => {
  it("uses the replacement default announcer and retires the previous one", () => {
    expect(ANNOUNCEMENT_VOICES).toContainEqual({
      id: "HDVDearvsECwhyI3Y21m",
      label: "Default Announcer",
    })
    expect(ANNOUNCEMENT_VOICES.some((voice) => voice.id === "laTmoAT4stwoPzthxjZT")).toBe(false)
    expect(DEFAULT_ANNOUNCEMENT_VOICE_ID).toBe("HDVDearvsECwhyI3Y21m")
    expect(resolveVoiceId("XsmrVB66q3D4TaXVaWNF")).toBeNull()
  })

  it("names one of them as the default", () => {
    expect(ANNOUNCEMENT_VOICES.some((v) => v.id === DEFAULT_ANNOUNCEMENT_VOICE_ID)).toBe(true)
  })

  it("offers the announcers added for the event", () => {
    expect(ANNOUNCEMENT_VOICES.map((v) => v.label)).toEqual([
      "Default Announcer",
      "Sergeant Brock",
      "Brian",
      "Hope",
      "Emma",
      "Horatius",
    ])
  })

  // This list grows by pasting ids from the ElevenLabs dashboard, which is
  // exactly the operation that duplicates or truncates one. A duplicate id
  // would make two dropdown entries the same announcer; an empty one would
  // resolve to the default and read in a voice nobody picked.
  it("has a distinct, non-empty id and label for every announcer", () => {
    const ids = ANNOUNCEMENT_VOICES.map((v) => v.id)
    const labels = ANNOUNCEMENT_VOICES.map((v) => v.label)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(labels).size).toBe(labels.length)
    expect(ids.every((id) => id.trim().length > 0)).toBe(true)
    expect(labels.every((label) => label.trim().length > 0)).toBe(true)
  })

  // Every id has to survive a round trip through the validator, or the voice
  // is selectable in the console and refused by the server.
  it("accepts every announcer it offers", () => {
    for (const voice of ANNOUNCEMENT_VOICES) {
      expect(resolveVoiceId(voice.id)).toBe(voice.id)
    }
  })
})

describe("resolveVoiceId", () => {
  it("accepts a voice from the list", () => {
    expect(resolveVoiceId("HDVDearvsECwhyI3Y21m")).toBe("HDVDearvsECwhyI3Y21m")
  })

  // The console is admin-only, but an unvalidated passthrough to a metered
  // vendor is a bad shape regardless of who can reach it.
  it("refuses an id that is not one of ours", () => {
    expect(resolveVoiceId("someone-elses-voice")).toBeNull()
  })

  it("falls back to the default when nothing was chosen", () => {
    expect(resolveVoiceId(undefined)).toBe(DEFAULT_ANNOUNCEMENT_VOICE_ID)
    expect(resolveVoiceId("")).toBe(DEFAULT_ANNOUNCEMENT_VOICE_ID)
  })
})

describe("what the announcer actually reads", () => {
  it("opens with the announcement prefix", () => {
    expect(spokenAnnouncement("Lunch is in the atrium.")).toBe(
      `${ANNOUNCEMENT_PREFIX}Lunch is in the atrium.`,
    )
    expect(spokenAnnouncement("Lunch is in the atrium.")).toMatch(/^Important Announcement/)
  })

  // The pause is the point. An ellipsis is prosody punctuation that every TTS
  // model reads as a beat — unlike a <break> tag, which a model that does not
  // support it may read out loud, over a room's PA.
  it("puts a real beat between the prefix and the message", () => {
    expect(ANNOUNCEMENT_PREFIX).toContain("...")
    expect(ANNOUNCEMENT_PREFIX).not.toContain("<")
  })

  it("does not stack the prefix on a message that already opens with it", () => {
    const once = spokenAnnouncement("Lunch is in the atrium.")
    expect(spokenAnnouncement(once)).toBe(once)
  })

  it("trims the message it is given", () => {
    expect(spokenAnnouncement("  Lunch.  ")).toBe(`${ANNOUNCEMENT_PREFIX}Lunch.`)
  })
})
