// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import {
  GAME_ROOM_BACKGROUND_TRACKS,
  GAME_ROOM_MUSIC,
  GAME_ROOM_SONGS,
  MENU_AUDIO_SETTINGS_KEY,
  MENU_SOUND_URLS,
  advanceMusicQueue,
  currentMusicTrack,
  loadMenuAudioSettings,
  musicPools,
  musicQueueLength,
  musicRequestKey,
  playMenuSound,
  reshuffleTracks,
  sameMusicPools,
  sameTracks,
  shuffleTracks,
  startMusicQueue,
} from "./menu-sounds"

describe("menu sounds", () => {
  it("maps the venue audio to its public files", () => {
    expect(MENU_SOUND_URLS).toEqual({
      news: "/newscast.mp3",
      backgroundGameRoom: "/background_gameroom.mp3",
    })
  })

  it("restarts and plays the requested sound", async () => {
    const audio = {
      currentTime: 2,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLAudioElement

    playMenuSound(audio)

    expect(audio.currentTime).toBe(0)
    expect(audio.play).toHaveBeenCalledOnce()
  })

  it("restores only persisted game-room music settings", () => {
    window.localStorage.setItem(MENU_AUDIO_SETTINGS_KEY, JSON.stringify({
      effectsMuted: true,
      musicMuted: false,
      effectsVolume: 0.25,
      musicVolume: 0.6,
    }))

    expect(loadMenuAudioSettings()).toEqual({
      musicMuted: false,
      musicVolume: 0.6,
    })
  })

  it("starts muted by default when the visitor has no saved settings", () => {
    window.localStorage.removeItem(MENU_AUDIO_SETTINGS_KEY)

    expect(loadMenuAudioSettings()).toEqual({ musicMuted: true, musicVolume: 0.35 })
  })

  it("starts unmuted when the deployment default says audio is on", () => {
    window.localStorage.removeItem(MENU_AUDIO_SETTINGS_KEY)

    expect(loadMenuAudioSettings(false)).toEqual({ musicMuted: false, musicVolume: 0.35 })
  })

  it("prefers the visitor's saved settings over the deployment default", () => {
    window.localStorage.setItem(MENU_AUDIO_SETTINGS_KEY, JSON.stringify({
      effectsMuted: false,
      musicMuted: false,
      effectsVolume: 0.25,
      musicVolume: 0.6,
    }))

    expect(loadMenuAudioSettings(true)).toEqual({ musicMuted: false, musicVolume: 0.6 })
  })
})

describe("game room playlist", () => {
  it("alternates the room's ambient tracks with the event's songs", () => {
    expect(GAME_ROOM_BACKGROUND_TRACKS).toEqual([
      "/background_gameroom.mp3",
      "/background_gameroom_02.mp3",
      "/background_gameroom_03.mp3",
      "/background_gameroom_04.mp3",
    ])
    expect(GAME_ROOM_SONGS).toEqual([
      "/theme.mp3",
      "/theme_jazz.mp3",
      "/theme_kpop.mp3",
      "/theme_rock90s.mp3",
      "/theme_country.mp3",
      "/theme_arena_rock.mp3",
      "/theme_boy_band.mp3",
      "/theme_country_pop.mp3",
    ])
    expect(GAME_ROOM_MUSIC).toEqual([GAME_ROOM_BACKGROUND_TRACKS, GAME_ROOM_SONGS])
  })

  it("keeps every track exactly once when shuffling, so nothing is dropped or doubled", () => {
    const shuffled = shuffleTracks(GAME_ROOM_BACKGROUND_TRACKS)

    expect([...shuffled].sort()).toEqual([...GAME_ROOM_BACKGROUND_TRACKS].sort())
  })

  it("reorders the tracks rather than returning the given order", () => {
    // Fisher-Yates walks from the end down, so a random() pinned to 0 sends
    // every pick to the lowest remaining index — a deterministic reordering.
    expect(shuffleTracks(["a", "b", "c"], () => 0)).toEqual(["b", "c", "a"])
  })

  it("does not mutate the tracks it was handed", () => {
    const tracks = ["a", "b", "c"]
    shuffleTracks(tracks, () => 0)

    expect(tracks).toEqual(["a", "b", "c"])
  })

  it("starts the next cycle on a different track than the one just heard", () => {
    // random() pinned to 0 would otherwise deal "b" back into the first slot.
    expect(reshuffleTracks(["a", "b", "c"], "b", () => 0)).toEqual(["c", "b", "a"])
  })

  it("leaves a fresh order alone when it does not repeat the last track", () => {
    expect(reshuffleTracks(["a", "b", "c"], "a", () => 0)).toEqual(["b", "c", "a"])
  })

  it("has no different track to move to when the playlist holds one track", () => {
    expect(reshuffleTracks(["a"], "a", () => 0)).toEqual(["a"])
  })

  it("recognises the same playlist so a re-render does not restart the music", () => {
    expect(sameTracks(["a", "b"], ["a", "b"])).toBe(true)
    expect(sameTracks(["a", "b"], ["b", "a"])).toBe(false)
    expect(sameTracks(["a"], ["a", "b"])).toBe(false)
  })
})

describe("music queue", () => {
  const AMBIENT = ["/ambient_1.mp3", "/ambient_2.mp3", "/ambient_3.mp3"]
  const SONGS = ["/song_1.mp3", "/song_2.mp3"]

  // Plays `count` hand-offs and returns every track heard, opening track first.
  function listen(pools: readonly (readonly string[])[], count: number, random: () => number = Math.random): string[] {
    let queue = startMusicQueue(pools, random)!
    const heard = [currentMusicTrack(queue)!]
    for (let step = 0; step < count; step += 1) {
      queue = advanceMusicQueue(queue, random)
      heard.push(currentMusicTrack(queue)!)
    }
    return heard
  }

  it("reads a lone track, a flat playlist and a set of pools as pools", () => {
    expect(musicPools("/a.mp3")).toEqual([["/a.mp3"]])
    expect(musicPools(["/a.mp3", "/b.mp3"])).toEqual([["/a.mp3", "/b.mp3"]])
    expect(musicPools([AMBIENT, SONGS])).toEqual([AMBIENT, SONGS])
    expect(musicPools([])).toEqual([])
  })

  it("opens on an ambient track, so the room settles before the first song", () => {
    const queue = startMusicQueue([AMBIENT, SONGS])

    expect(AMBIENT).toContain(currentMusicTrack(queue))
    expect(musicQueueLength(queue)).toBe(5)
  })

  it("alternates ambient and song for as long as the room is open", () => {
    const heard = listen([AMBIENT, SONGS], 11)

    heard.forEach((track, step) => {
      expect(step % 2 === 0 ? AMBIENT : SONGS).toContain(track)
    })
  })

  it("plays every track of a pool before any of that pool comes round again", () => {
    const heard = listen([AMBIENT, SONGS], 9)
    const ambient = heard.filter((_track, step) => step % 2 === 0)
    const songs = heard.filter((_track, step) => step % 2 === 1)

    expect([...ambient.slice(0, 3)].sort()).toEqual([...AMBIENT].sort())
    expect([...songs.slice(0, 2)].sort()).toEqual([...SONGS].sort())
    expect([...songs.slice(2, 4)].sort()).toEqual([...SONGS].sort())
  })

  it("never lets a pool reopen on the track it played last", () => {
    // random() pinned to 0 is the case reshuffleTracks exists for: it would
    // otherwise deal the pool's last track straight back into its first slot.
    const heard = listen([AMBIENT, SONGS], 40, () => 0)
    for (let step = 2; step < heard.length; step += 1) {
      expect(heard[step]).not.toBe(heard[step - 2])
    }
  })

  it("treats one pool as the flat shuffled playlist it always was", () => {
    const heard = listen([AMBIENT], 5)

    expect([...heard.slice(0, 3)].sort()).toEqual([...AMBIENT].sort())
    expect([...heard.slice(3, 6)].sort()).toEqual([...AMBIENT].sort())
    expect(heard[3]).not.toBe(heard[2])
  })

  it("has nothing to play for empty pools", () => {
    expect(startMusicQueue([])).toBeNull()
    expect(startMusicQueue([[], []])).toBeNull()
    expect(currentMusicTrack(null)).toBeNull()
    expect(musicQueueLength(null)).toBe(0)
  })

  it("recognises the same request by its contents so a re-render does not restart the music", () => {
    expect(sameMusicPools([AMBIENT, SONGS], [[...AMBIENT], [...SONGS]])).toBe(true)
    expect(sameMusicPools([AMBIENT, SONGS], [SONGS, AMBIENT])).toBe(false)
    expect(sameMusicPools([AMBIENT], [AMBIENT, SONGS])).toBe(false)
    expect(musicRequestKey([AMBIENT, SONGS])).toBe(musicRequestKey([[...AMBIENT], [...SONGS]]))
    expect(musicRequestKey([AMBIENT, SONGS])).not.toBe(musicRequestKey([...AMBIENT, ...SONGS]))
    expect(musicRequestKey("/a.mp3")).toBe(musicRequestKey(["/a.mp3"]))
  })
})
