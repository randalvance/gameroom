// The duel's sound: the generated clips (duel-audio.generated.ts, made by
// art-src/gen-duel-audio.py) played through <audio> elements — no decoding,
// no AudioContext, the same as the room's own cues. Effects follow the
// site's effects volume; the music sits under them at a fixed fraction.
// A clip that has not loaded, or a browser that refuses to play, is silence:
// the duel never depends on sound.
import { DUEL_AUDIO, type DuelMusicName, type DuelSfxName } from "./duel-audio.generated"

export interface DuelAudio {
  sfx(name: DuelSfxName): void
  /** Switch tracks (null stops). The same track twice is a no-op. */
  music(name: DuelMusicName | null): void
  setVolume(volume: number): void
  close(): void
}

/** Music level relative to the effects volume. */
export const MUSIC_LEVEL = 0.35

const clamp = (v: number) => Math.max(0, Math.min(1, v))

export function createDuelAudio(initialVolume: number): DuelAudio {
  let volume = clamp(initialVolume)
  const supported = typeof Audio !== "undefined"
  const effects = new Map<DuelSfxName, HTMLAudioElement>()
  let track: HTMLAudioElement | null = null
  let trackName: DuelMusicName | null = null

  const element = (url: string): HTMLAudioElement => {
    const el = new Audio(url)
    el.preload = "auto"
    return el
  }
  // Warm every effect as soon as the duel asks for its sound, so the first
  // card slap is not also the first fetch.
  if (supported) for (const name of Object.keys(DUEL_AUDIO.sfx) as DuelSfxName[]) effects.set(name, element(DUEL_AUDIO.sfx[name]))

  return {
    sfx(name) {
      const el = effects.get(name)
      if (!el) return
      el.volume = volume
      el.currentTime = 0
      void el.play()?.catch?.(() => {})
    },
    music(name) {
      if (name === trackName) return
      if (track) { track.pause(); track.src = ""; track = null }
      trackName = name
      if (!name || !supported) return
      const { url, loop } = DUEL_AUDIO.music[name]
      track = element(url)
      track.loop = loop
      track.volume = volume * MUSIC_LEVEL
      void track.play()?.catch?.(() => {})
    },
    setVolume(next) {
      volume = clamp(next)
      if (track) track.volume = volume * MUSIC_LEVEL
    },
    close() {
      for (const el of effects.values()) { el.pause(); el.src = "" }
      effects.clear()
      if (track) { track.pause(); track.src = ""; track = null }
      trackName = null
    },
  }
}
