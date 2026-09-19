export const MENU_SOUND_URLS = {
  news: "/newscast.mp3",
  backgroundGameRoom: "/background_gameroom.mp3",
} as const

// The game room plays for as long as a session lasts, so it gets a playlist
// rather than one looping track. The room's ambient tracks and the event's
// songs are two pools the player alternates between — ambient, song, ambient,
// song — so a song never follows a song and the room never sits in ambience
// for long. Each pool is shuffled on its own, which is what makes both the
// opening track and every hand-off after it unpredictable.
export const GAME_ROOM_BACKGROUND_TRACKS = [
  MENU_SOUND_URLS.backgroundGameRoom,
  "/background_gameroom_02.mp3",
  "/background_gameroom_03.mp3",
  "/background_gameroom_04.mp3",
] as const

// The event's own song and its arrangements, one per genre. A song added here
// also needs a button name in lib/game-room-music.ts — the typecheck says so.
export const GAME_ROOM_SONGS = [
  "/theme.mp3",
  "/theme_jazz.mp3",
  "/theme_kpop.mp3",
  "/theme_rock90s.mp3",
  "/theme_country.mp3",
  "/theme_arena_rock.mp3",
  "/theme_boy_band.mp3",
  "/theme_country_pop.mp3",
] as const

export const GAME_ROOM_MUSIC = [GAME_ROOM_BACKGROUND_TRACKS, GAME_ROOM_SONGS] as const

// Fisher-Yates. `random` is injectable so the shuffle can be pinned in tests.
export function shuffleTracks(tracks: readonly string[], random: () => number = Math.random): string[] {
  const shuffled = [...tracks]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swap]] = [shuffled[swap] as string, shuffled[index] as string]
  }
  return shuffled
}

// Reshuffling at the end of a cycle can deal the track that just finished back
// into the first slot, which sounds like a stutter rather than a fresh round.
// Swapping it out keeps every hand-off audibly a change of track.
export function reshuffleTracks(tracks: readonly string[], previousTrack: string | undefined, random: () => number = Math.random): string[] {
  const shuffled = shuffleTracks(tracks, random)
  if (shuffled.length > 1 && shuffled[0] === previousTrack) {
    const swap = 1 + Math.floor(random() * (shuffled.length - 1))
    ;[shuffled[0], shuffled[swap]] = [shuffled[swap] as string, shuffled[0] as string]
  }
  return shuffled
}

export function sameTracks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((track, index) => track === b[index])
}

/**
 * What a page asks the player for: one track (looped), one playlist (shuffled),
 * or several pools the player alternates between in the order given.
 */
export type MusicRequest = string | readonly string[] | readonly (readonly string[])[]

export function musicPools(request: MusicRequest): readonly (readonly string[])[] {
  if (typeof request === "string") return [[request]]
  if (request.length === 0) return []
  if (typeof request[0] === "string") return [request as readonly string[]]
  return request as readonly (readonly string[])[]
}

export function sameMusicPools(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
  return a.length === b.length && a.every((pool, index) => sameTracks(pool, b[index] as readonly string[]))
}

// A request's contents rather than its identity, so a re-render that hands the
// player the same tracks in a new array does not reshuffle and restart them.
export function musicRequestKey(request: MusicRequest): string {
  return musicPools(request).map((pool) => pool.join("\u0000")).join("\u0001")
}

// One pool is a shuffled ring: `order` is the running order and `index` the
// track last played out of it (-1 before its first turn). The queue visits the
// pools round-robin, so with two pools every hand-off is a change of pool.
// `tracks` is the pool as the page asked for it, kept so the same request can
// be recognised and so a reshuffle starts from the unshuffled list.
export type MusicPool = { tracks: readonly string[]; order: readonly string[]; index: number }
export type MusicQueue = { pools: readonly MusicPool[]; pool: number }

// Opens on the first pool: in the game room that is an ambient track, so the
// room settles before the first song.
export function startMusicQueue(pools: readonly (readonly string[])[], random: () => number = Math.random): MusicQueue | null {
  const filled = pools.filter((pool) => pool.length > 0)
  if (filled.length === 0) return null
  return {
    pools: filled.map((tracks, poolIndex) => ({ tracks, order: shuffleTracks(tracks, random), index: poolIndex === 0 ? 0 : -1 })),
    pool: 0,
  }
}

export function currentMusicTrack(queue: MusicQueue | null): string | null {
  if (!queue) return null
  const pool = queue.pools[queue.pool]
  return pool?.order[pool.index] ?? null
}

export function musicQueueLength(queue: MusicQueue | null): number {
  return queue?.pools.reduce((total, pool) => total + pool.tracks.length, 0) ?? 0
}

// Hand over to the next pool's next track. Once a pool's shuffled order runs
// out, reshuffle it so its following cycle is a fresh random order rather than a
// repeat — and never opens on the track that pool played last.
export function advanceMusicQueue(queue: MusicQueue, random: () => number = Math.random): MusicQueue {
  const nextPoolIndex = (queue.pool + 1) % queue.pools.length
  const pool = queue.pools[nextPoolIndex] as MusicPool
  const next = pool.index + 1
  const advanced: MusicPool = next < pool.order.length
    ? { ...pool, index: next }
    : { ...pool, order: reshuffleTracks(pool.tracks, pool.order[pool.order.length - 1], random), index: 0 }
  return {
    pools: queue.pools.map((current, index) => index === nextPoolIndex ? advanced : current),
    pool: nextPoolIndex,
  }
}

export const MENU_AUDIO_SETTINGS_KEY = "codetoimpact.audio-settings"

export type MenuAudioSettings = {
  musicMuted: boolean
  musicVolume: number
}

// The deployment decides whether audio starts on or off (SITE_AUDIO_DEFAULT_ON,
// threaded through the root loader); the fallback here is muted so anything
// that misses the wiring fails silent, not loud.
function defaultMenuAudioSettings(muted: boolean): MenuAudioSettings {
  return {
    musicMuted: muted,
    musicVolume: 0.35,
  }
}

export function loadMenuAudioSettings(defaultMuted = true): MenuAudioSettings {
  const defaults = defaultMenuAudioSettings(defaultMuted)
  if (typeof window === "undefined") return defaults

  try {
    const parsed = JSON.parse(window.localStorage.getItem(MENU_AUDIO_SETTINGS_KEY) ?? "null") as Partial<MenuAudioSettings> | null
    if (!parsed) return defaults

    return {
      musicMuted: typeof parsed.musicMuted === "boolean" ? parsed.musicMuted : defaults.musicMuted,
      musicVolume: typeof parsed.musicVolume === "number" ? Math.min(1, Math.max(0, parsed.musicVolume)) : defaults.musicVolume,
    }
  } catch {
    return defaults
  }
}

export function playMenuSound(audio: HTMLAudioElement | null): void {
  if (!audio) return

  audio.currentTime = 0
  void audio.play().catch(() => {
    // Browsers can reject playback when audio is not yet unlocked.
  })
}
