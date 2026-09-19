// The gamemaster's grip on the room's music — the MUSIC card on the GAME ROOM
// console tab.
//
// Client-safe on purpose: the console, the room and the hub all read it, so it
// holds nothing but the command's shape, its parser, and what the room plays
// in answer to it.

import { GAME_ROOM_BACKGROUND_TRACKS, GAME_ROOM_MUSIC, GAME_ROOM_SONGS, type MusicRequest } from "./menu-sounds"

/**
 * What the gamemaster has asked the projector and viewer screens to play.
 * Null is the room's own alternating playlist; `track` loops one track; `stop`
 * is silence. STATE rather than a moment, like the pinned wall page: hello
 * carries it, so a screen that reconnects mid-hold plays what the others do.
 */
export type RoomMusic = { mode: "track"; track: string } | { mode: "stop" } | null

// Keyed by track rather than by position, so a song added to the playlist
// without a button name fails the typecheck instead of going unlabelled.
const SONG_LABELS: Record<(typeof GAME_ROOM_SONGS)[number], string> = {
  "/theme.mp3": "THEME",
  "/theme_jazz.mp3": "THEME (JAZZ)",
  "/theme_kpop.mp3": "THEME (K-POP)",
  "/theme_rock90s.mp3": "THEME (90s ROCK)",
  "/theme_country.mp3": "THEME (COUNTRY)",
  "/theme_arena_rock.mp3": "THEME (ARENA ROCK)",
  "/theme_boy_band.mp3": "THEME (BOY BAND)",
  "/theme_country_pop.mp3": "THEME (COUNTRY POP)",
}

/** Every track the console can put on, named for its button. */
export const ROOM_MUSIC_CHOICES: ReadonlyArray<{ track: string; label: string }> = [
  ...GAME_ROOM_BACKGROUND_TRACKS.map((track, index) => ({ track, label: `AMBIENT ${index + 1}` })),
  ...GAME_ROOM_SONGS.map((track) => ({ track, label: SONG_LABELS[track] })),
]

const ROOM_MUSIC_TRACKS: readonly string[] = ROOM_MUSIC_CHOICES.map((choice) => choice.track)

/** The command as the console sends it: `{ music: RoomMusic }`. */
export function parseRoomMusicInput(input: unknown): RoomMusic {
  const music = (input as { music?: unknown } | null)?.music
  if (music === null) return null
  if (typeof music === "object" && music !== null) {
    const { mode, track } = music as { mode?: unknown; track?: unknown }
    if (mode === "stop") return { mode: "stop" }
    if (mode === "track" && typeof track === "string" && ROOM_MUSIC_TRACKS.includes(track)) {
      return { mode: "track", track }
    }
  }
  throw new Error(`INVALID_INPUT: music must be null, { mode: "stop" } or { mode: "track", track } with a track the room has`)
}

/**
 * What a room plays under a command. Only the PA screens — the admin laptop
 * and the viewer account on the big screen — obey it; a student's laptop keeps
 * the room's own playlist, the same split as the filmed broadcasts.
 */
export function roomMusicRequest(music: RoomMusic | undefined, role: string): MusicRequest {
  if (!music || (role !== "admin" && role !== "viewer")) return GAME_ROOM_MUSIC
  if (music.mode === "stop") return []
  return music.track
}
