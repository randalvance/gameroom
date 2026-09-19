// The two arcade sounds the ROOM plays — the Konami unlock jingle and the
// cabinet's landing thud — without pulling the game chunk in.
//
// They are ordinary mp3s from the generated audio set, played through an
// <audio> element (no decoding, no AudioContext of their own). If a file has
// not loaded by the time it is needed, or fails, the synthesized chip in
// arcade-sfx.ts plays its version instead, so the cue is never missed.

import { AUDIO } from "./audio-atlas.generated"
import { createArcadeAudio, type ArcadeAudio } from "./arcade-sfx"

export interface RoomArcadeCues {
  unlock(): void
  thud(): void
  setVolume(volume: number): void
  close(): void
}

export function createRoomArcadeCues(initialVolume: number): RoomArcadeCues {
  let chip: ArcadeAudio | null = null
  let volume = Math.max(0, Math.min(1, initialVolume))
  const elements = new Map<string, HTMLAudioElement>()
  const element = (url: string): HTMLAudioElement | null => {
    if (typeof Audio === "undefined") return null
    let el = elements.get(url)
    if (!el) {
      el = new Audio(url)
      el.preload = "auto"
      elements.set(url, el)
    }
    return el
  }
  // Warm both as soon as the room asks for its cues, so the jingle that
  // follows the code is not the first fetch.
  element(AUDIO.sfx.unlock_jingle)
  element(AUDIO.sfx.cabinet_thud)
  const play = (url: string, fallback: (chip: ArcadeAudio) => void) => {
    const el = element(url)
    const synth = () => {
      if (!chip) chip = createArcadeAudio(volume)
      fallback(chip)
    }
    if (!el || el.readyState < 2) {
      synth()
      return
    }
    el.volume = volume
    el.currentTime = 0
    void el.play().catch(synth)
  }
  return {
    unlock() { play(AUDIO.sfx.unlock_jingle, (c) => c.unlock()) },
    thud() { play(AUDIO.sfx.cabinet_thud, (c) => c.thud()) },
    setVolume(next) {
      volume = Math.max(0, Math.min(1, next))
      chip?.setVolume(volume)
    },
    close() {
      chip?.close()
      chip = null
      for (const el of elements.values()) { el.pause(); el.src = "" }
      elements.clear()
    },
  }
}
