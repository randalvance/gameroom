// The arcade's sound bank: the generated clips, played through Web Audio.
//
// Sound effects, fighter lines, the announcer and the music all come from
// mp3s under public/assets/arcade/audio (see audio-atlas.generated.ts and
// the generator in art-src). Clips are fetched and decoded on first use and
// cached for the session; a fight preloads what it needs before the bell.
// Until a clip has decoded — or if it never does — the synthesized chip in
// arcade-sfx.ts answers instead, so nothing is ever silent.
//
// Voices are one channel per speaker: a new line cuts the old one, the way
// an arcade board with a single voice channel would. Music is one track at a
// time with a short crossfade, looping natively on the buffer source, and
// it follows the site's music mute and volume rather than the effects level.

import { AUDIO, type AnnouncerName, type MusicName, type SfxName, type VoiceLine } from "./audio-atlas.generated"
import { createArcadeAudio, type ArcadeAudio } from "./arcade-sfx"
import type { CharacterId } from "./characters"
import type { AudioCue } from "./audio-cues"

export interface ArcadeSoundBank {
  /** Fetch and decode ahead of need; a fight passes its two fighters. */
  preload(scope: "ui" | "fight", fighters?: readonly CharacterId[]): void
  sfx(name: SfxName): void
  voice(fighter: CharacterId, line: VoiceLine, take?: number): void
  announce(name: AnnouncerName): void
  /** Switch tracks (null stops). The same track twice is a no-op. */
  music(name: MusicName | null): void
  /** Lower the music while a sheet is up, and bring it back. */
  duck(on: boolean): void
  cue(cue: AudioCue): void
  /** How many takes a fighter has of a line — the cue mapper asks. */
  takes(fighter: CharacterId, line: VoiceLine): number
  setVolumes(settings: { effects: number; music: number; musicMuted: boolean }): void
  close(): void
}

const SFX_FALLBACK: Partial<Record<SfxName, (chip: ArcadeAudio) => void>> = {
  hit_light: (chip) => chip.hit(false),
  hit_heavy: (chip) => chip.hit(true),
  block: (chip) => chip.block(),
  whiff: (chip) => chip.whiff(),
  jump: (chip) => chip.jump(),
  special: (chip) => chip.special(),
  horn_attack: (chip) => chip.special(),
  ice_slam: (chip) => chip.special(),
  math_circle: (chip) => chip.special(),
  water_orb: (chip) => chip.special(),
  prime_laser: (chip) => chip.special(),
  redline_vision: (chip) => chip.special(),
  laser_rain: (chip) => chip.special(),
  breaking_news_charge: (chip) => chip.special(),
  breaking_news_release: (chip) => chip.special(),
  breaking_news_impact: (chip) => chip.hit(true),
  ko: (chip) => chip.ko(),
  round_bell: (chip) => chip.fight(),
  round_win: (chip) => chip.roundWin(),
  select_move: (chip) => chip.select(),
  select_confirm: (chip) => chip.confirm(),
  unlock_jingle: (chip) => chip.unlock(),
  cabinet_thud: (chip) => chip.thud(),
}

function contextFor(): AudioContext | null {
  if (typeof window === "undefined") return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    return new Ctor()
  } catch {
    return null
  }
}

export function createArcadeSoundBank(initial: { effects: number; music: number; musicMuted: boolean }): ArcadeSoundBank {
  const ctx = contextFor()
  const chip = createArcadeAudio(initial.effects)
  const buffers = new Map<string, Promise<AudioBuffer | null>>()
  const effectsGain = ctx?.createGain() ?? null
  const voiceGain = ctx?.createGain() ?? null
  const musicGain = ctx?.createGain() ?? null
  let musicLevel = initial.musicMuted ? 0 : initial.music
  let ducked = false
  if (ctx && effectsGain && voiceGain && musicGain) {
    effectsGain.gain.value = initial.effects
    voiceGain.gain.value = initial.effects
    musicGain.gain.value = musicLevel
    effectsGain.connect(ctx.destination)
    voiceGain.connect(ctx.destination)
    musicGain.connect(ctx.destination)
  }
  const channels = new Map<string, AudioBufferSourceNode>()
  let currentMusic: { name: MusicName; source: AudioBufferSourceNode; gain: GainNode } | null = null
  let wantedMusic: MusicName | null = null
  let closed = false

  const resume = () => {
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {})
  }

  const load = (url: string): Promise<AudioBuffer | null> => {
    let pending = buffers.get(url)
    if (pending) return pending
    pending = (async () => {
      if (!ctx) return null
      try {
        const response = await fetch(url)
        if (!response.ok) return null
        const data = await response.arrayBuffer()
        return await ctx.decodeAudioData(data)
      } catch {
        return null
      }
    })()
    buffers.set(url, pending)
    return pending
  }

  /** Play a decoded clip now; false if it is not decoded yet (and start it loading). */
  const playNow = (url: string, out: GainNode | null, channel?: string): boolean => {
    if (!ctx || !out) return false
    const pending = buffers.get(url)
    let buffer: AudioBuffer | null | undefined
    // A settled promise's value is not readable synchronously; keep a side
    // cache of decoded buffers instead.
    buffer = decoded.get(url)
    if (buffer === undefined) {
      if (!pending) void load(url).then((b) => { if (b) decoded.set(url, b) })
      else void pending.then((b) => { if (b) decoded.set(url, b) })
      return false
    }
    if (!buffer) return false
    resume()
    if (channel) channels.get(channel)?.stop()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(out)
    source.start()
    if (channel) {
      channels.set(channel, source)
      source.onended = () => { if (channels.get(channel) === source) channels.delete(channel) }
    }
    return true
  }
  const decoded = new Map<string, AudioBuffer>()
  const warm = (url: string) => { void load(url).then((b) => { if (b) decoded.set(url, b) }) }

  const startMusic = (name: MusicName) => {
    if (!ctx || !musicGain) return
    const track = AUDIO.music[name]
    const buffer = decoded.get(track.url)
    if (!buffer) return
    resume()
    const now = ctx.currentTime
    if (currentMusic) {
      const old = currentMusic
      old.gain.gain.setValueAtTime(old.gain.gain.value, now)
      old.gain.gain.linearRampToValueAtTime(0, now + 0.6)
      old.source.stop(now + 0.65)
    }
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(1, now + 0.5)
    gain.connect(musicGain)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = track.loop
    source.connect(gain)
    source.start(now)
    currentMusic = { name, source, gain }
    source.onended = () => { if (currentMusic?.source === source) currentMusic = null }
  }

  const applyMusicGain = () => {
    if (!ctx || !musicGain) return
    const target = ducked ? musicLevel * 0.35 : musicLevel
    musicGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08)
  }

  return {
    preload(scope, fighters = []) {
      if (!ctx) return
      if (scope === "ui") {
        for (const name of ["select_move", "select_confirm", "versus_sting", "pause"] as const) warm(AUDIO.sfx[name])
        warm(AUDIO.music.title.url)
        warm(AUDIO.music.select.url)
      } else {
        for (const url of Object.values(AUDIO.sfx)) warm(url)
        for (const url of Object.values(AUDIO.announcer)) warm(url)
        for (const name of ["fight", "victory", "gameover"] as const) warm(AUDIO.music[name].url)
        for (const fighter of fighters) {
          const lines = AUDIO.voices[fighter as keyof typeof AUDIO.voices]
          if (!lines) continue
          for (const urls of Object.values(lines)) for (const url of urls) warm(url)
        }
      }
    },
    sfx(name) {
      if (!playNow(AUDIO.sfx[name], effectsGain)) SFX_FALLBACK[name]?.(chip)
    },
    voice(fighter, line, take = 0) {
      const lines = AUDIO.voices[fighter as keyof typeof AUDIO.voices]
      const urls = lines?.[line]
      if (!urls || !urls.length) return
      const list: readonly string[] = urls
      playNow(list[Math.min(take, list.length - 1)]!, voiceGain, `voice:${fighter}`)
    },
    announce(name) {
      playNow(AUDIO.announcer[name], voiceGain, "announcer")
    },
    music(name) {
      wantedMusic = name
      if (!ctx || !musicGain) return
      if (name === null) {
        if (currentMusic) {
          const now = ctx.currentTime
          currentMusic.gain.gain.setValueAtTime(currentMusic.gain.gain.value, now)
          currentMusic.gain.gain.linearRampToValueAtTime(0, now + 0.5)
          currentMusic.source.stop(now + 0.55)
          currentMusic = null
        }
        return
      }
      if (currentMusic?.name === name) return
      const url = AUDIO.music[name].url
      if (decoded.has(url)) {
        startMusic(name)
        return
      }
      // Not decoded yet: start it when it lands, if it is still wanted.
      void load(url).then((buffer) => {
        if (!buffer || closed) return
        decoded.set(url, buffer)
        if (wantedMusic === name && currentMusic?.name !== name) startMusic(name)
      })
    },
    duck(on) {
      ducked = on
      applyMusicGain()
    },
    cue(cue) {
      switch (cue.kind) {
        case "sfx": this.sfx(cue.name); break
        case "voice": this.voice(cue.fighter, cue.line, cue.take); break
        case "announce": this.announce(cue.name); break
        case "music": this.music(cue.name); break
      }
    },
    takes(fighter, line) {
      const lines = AUDIO.voices[fighter as keyof typeof AUDIO.voices]
      return lines?.[line]?.length ?? 0
    },
    setVolumes(settings) {
      chip.setVolume(settings.effects)
      if (effectsGain) effectsGain.gain.value = settings.effects
      if (voiceGain) voiceGain.gain.value = settings.effects
      musicLevel = settings.musicMuted ? 0 : settings.music
      applyMusicGain()
    },
    close() {
      closed = true
      for (const source of channels.values()) { try { source.stop() } catch { /* ended */ } }
      channels.clear()
      try { currentMusic?.source.stop() } catch { /* ended */ }
      currentMusic = null
      chip.close()
      void ctx?.close().catch(() => {})
    },
  }
}
