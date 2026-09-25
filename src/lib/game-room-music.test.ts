import { describe, expect, it } from "vitest"
import { GAME_ROOM_BACKGROUND_TRACKS, GAME_ROOM_MUSIC, GAME_ROOM_SONGS } from "./menu-sounds"
import { ROOM_MUSIC_CHOICES, parseRoomMusicInput, roomMusicRequest } from "./game-room-music"

describe("the console's music choices", () => {
  it("offers every track the room plays, each once, and nothing else", () => {
    expect(ROOM_MUSIC_CHOICES.map((choice) => choice.track)).toEqual([...GAME_ROOM_BACKGROUND_TRACKS, ...GAME_ROOM_SONGS])
    expect(new Set(ROOM_MUSIC_CHOICES.map((choice) => choice.label)).size).toBe(ROOM_MUSIC_CHOICES.length)
  })
})

describe("parseRoomMusicInput", () => {
  it("reads null as handing the music back to the room's playlist", () => {
    expect(parseRoomMusicInput({ music: null })).toBeNull()
  })

  it("reads stop", () => {
    expect(parseRoomMusicInput({ music: { mode: "stop" } })).toEqual({ mode: "stop" })
  })

  it("accepts every track the console can put on", () => {
    for (const { track } of ROOM_MUSIC_CHOICES) {
      expect(parseRoomMusicInput({ music: { mode: "track", track } })).toEqual({ mode: "track", track })
    }
  })

  // A track the room does not have would put the projector on silence with
  // the console claiming otherwise.
  it("refuses a track the room has never heard of, and any other shape", () => {
    expect(() => parseRoomMusicInput({ music: { mode: "track", track: "/rickroll.mp3" } })).toThrow(/INVALID_INPUT/)
    expect(() => parseRoomMusicInput({ music: { mode: "track" } })).toThrow(/INVALID_INPUT/)
    expect(() => parseRoomMusicInput({ music: { mode: "loud" } })).toThrow(/INVALID_INPUT/)
    expect(() => parseRoomMusicInput({ music: "stop" })).toThrow(/INVALID_INPUT/)
    expect(() => parseRoomMusicInput({})).toThrow(/INVALID_INPUT/)
  })
})

describe("roomMusicRequest", () => {
  it("plays the room's own playlist with no command, whoever is listening", () => {
    for (const role of ["host", "screen", "visitor"]) {
      expect(roomMusicRequest(null, role)).toBe(GAME_ROOM_MUSIC)
      expect(roomMusicRequest(undefined, role)).toBe(GAME_ROOM_MUSIC)
    }
  })

  it("loops the chosen track, or goes silent, on the PA screens", () => {
    for (const role of ["host", "screen"]) {
      expect(roomMusicRequest({ mode: "track", track: "/theme.mp3" }, role)).toBe("/theme.mp3")
      expect(roomMusicRequest({ mode: "stop" }, role)).toEqual([])
    }
  })

  // The command is for the projector and the big screen. A visitor's laptop
  // is not the room's PA, so it is left to its own playlist — the same split
  // as the filmed broadcasts.
  it("leaves every other screen on the room's playlist", () => {
    for (const role of ["visitor", "anything-else"]) {
      expect(roomMusicRequest({ mode: "track", track: "/theme.mp3" }, role)).toBe(GAME_ROOM_MUSIC)
      expect(roomMusicRequest({ mode: "stop" }, role)).toBe(GAME_ROOM_MUSIC)
    }
  })
})
