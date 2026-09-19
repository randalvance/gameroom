// The arcade's sound chip.
//
// Everything is synthesized with the Web Audio API at call time — no audio
// files to fetch, nothing to preload, and the room's bundle carries only this
// small module. The unlock jingle is the one sound the ROOM plays (when the
// Konami code lands); the rest belong to the fight and are driven by the sim's
// events. Volume is the site's fixed effects volume, pushed in by the caller
// because there is no React context down here.

type Wave = OscillatorType

export interface ArcadeAudio {
  /** The Konami code just landed: a rising 8-bit power-up. */
  unlock(): void
  /** The cabinet hit the floor: a heavy thud with a dusty tail. */
  thud(): void
  select(): void
  confirm(): void
  fight(): void
  hit(heavy: boolean): void
  block(): void
  whiff(): void
  special(): void
  jump(): void
  ko(): void
  roundWin(): void
  setVolume(volume: number): void
  close(): void
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

export function createArcadeAudio(initialVolume = 0.8): ArcadeAudio {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let volume = Math.max(0, Math.min(1, initialVolume))

  const ensure = (): AudioContext | null => {
    if (!ctx) {
      ctx = contextFor()
      if (!ctx) return null
      master = ctx.createGain()
      master.gain.value = volume
      master.connect(ctx.destination)
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {})
    return ctx
  }

  /** One oscillator note: `freq` sliding to `slideTo` over its life. */
  const tone = (freq: number, wave: Wave, duration: number, peak: number, at = 0, slideTo?: number) => {
    const c = ensure()
    if (!c || !master) return
    const osc = c.createOscillator()
    const gain = c.createGain()
    const start = c.currentTime + at
    osc.type = wave
    osc.frequency.setValueAtTime(freq, start)
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + duration)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    osc.connect(gain)
    gain.connect(master)
    osc.start(start)
    osc.stop(start + duration + 0.02)
  }

  /** A burst of filtered noise — impacts and swooshes. */
  const noise = (duration: number, peak: number, filterHz: number, at = 0, sweepTo?: number) => {
    const c = ensure()
    if (!c || !master) return
    const length = Math.max(1, Math.floor(c.sampleRate * duration))
    const buffer = c.createBuffer(1, length, c.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    const source = c.createBufferSource()
    source.buffer = buffer
    const filter = c.createBiquadFilter()
    filter.type = "bandpass"
    filter.Q.value = 0.9
    const start = c.currentTime + at
    filter.frequency.setValueAtTime(filterHz, start)
    if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), start + duration)
    const gain = c.createGain()
    gain.gain.setValueAtTime(peak, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    source.start(start)
    source.stop(start + duration + 0.02)
  }

  return {
    unlock() {
      // C5 E5 G5 C6 in quick succession, then a held shimmer an octave up.
      const notes = [523.25, 659.25, 783.99, 1046.5]
      notes.forEach((f, i) => tone(f, "square", 0.11, 0.18, i * 0.085))
      tone(2093, "square", 0.42, 0.14, notes.length * 0.085)
      tone(1568, "triangle", 0.42, 0.12, notes.length * 0.085 + 0.02)
      noise(0.25, 0.08, 4000, notes.length * 0.085, 9000)
    },
    thud() {
      tone(70, "sine", 0.35, 0.6, 0, 28)
      tone(140, "triangle", 0.12, 0.3)
      noise(0.28, 0.45, 220, 0, 60)
      noise(0.6, 0.18, 1800, 0.05, 300)
    },
    select() {
      tone(880, "square", 0.05, 0.12)
    },
    confirm() {
      tone(660, "square", 0.07, 0.14)
      tone(990, "square", 0.12, 0.14, 0.07)
    },
    fight() {
      tone(392, "square", 0.12, 0.2)
      tone(392, "square", 0.12, 0.2, 0.16)
      tone(784, "square", 0.3, 0.22, 0.32)
    },
    hit(heavy) {
      noise(heavy ? 0.16 : 0.08, heavy ? 0.5 : 0.32, heavy ? 500 : 900, 0, 140)
      tone(heavy ? 110 : 160, "triangle", heavy ? 0.16 : 0.08, heavy ? 0.4 : 0.25, 0, 50)
    },
    block() {
      tone(1200, "square", 0.04, 0.16, 0, 500)
      noise(0.05, 0.16, 2500)
    },
    whiff() {
      noise(0.12, 0.12, 900, 0, 2400)
    },
    special() {
      tone(220, "sawtooth", 0.28, 0.16, 0, 880)
      noise(0.2, 0.12, 1200, 0.05, 3000)
    },
    jump() {
      tone(300, "square", 0.09, 0.08, 0, 600)
    },
    ko() {
      tone(196, "square", 0.2, 0.22)
      tone(147, "square", 0.25, 0.22, 0.2)
      tone(98, "square", 0.7, 0.24, 0.45, 60)
      noise(0.6, 0.35, 400, 0.45, 80)
    },
    roundWin() {
      const notes = [523.25, 523.25, 523.25, 698.46]
      notes.forEach((f, i) => tone(f, "square", i === 3 ? 0.4 : 0.1, 0.16, i * 0.12))
    },
    setVolume(next) {
      volume = Math.max(0, Math.min(1, next))
      if (master) master.gain.value = volume
    },
    close() {
      void ctx?.close().catch(() => {})
      ctx = null
      master = null
    },
  }
}
