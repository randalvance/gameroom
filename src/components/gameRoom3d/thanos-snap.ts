// The snap.
//
// Half the room, chosen at random, crumbles to dust: each character fades as
// it lifts a little off the floor, and a cloud of motes rises from where it
// stood and drifts away. The characters go one after another rather than all
// at once, the way it happens in the film, and once a character is gone it
// stays gone — until the page is reloaded, because none of this is real:
// nothing reaches the hub, and the scene alone remembers who was taken.
//
// Pure state, no three.js: the scene advances it once per frame and copies
// the numbers into the materials and a Points buffer, so the timeline can be
// pinned by a test.

export const DISSOLVE = {
  /** One character's fade, start to gone. */
  charMs: 1400,
  /** Delay between one character starting and the next. */
  staggerMs: 90,
  /** How far up a character drifts by the time it is gone, world units. */
  lift: 0.6,
  /** Motes per character, and how long each one lives. */
  dustPerChar: 40,
  dustLifeMs: [900, 1500] as const,
  /** Motes are released over this fraction of the fade, not all at once. */
  dustReleaseFrac: 0.7,
  /** Upward speed and sideways drift of a mote, world units per second. */
  dustRise: [0.5, 1.3] as const,
  dustDrift: 0.45,
  dustSize: [0.35, 0.7] as const,
} as const

export interface SnapTarget {
  id: number
  /** The sprite's centre and its plane size, world units. */
  x: number
  y: number
  z: number
  w: number
  h: number
}

export interface SnapCharFrame {
  id: number
  /** 1 = as drawn, 0 = gone. */
  alpha: number
  /** World units above where it stood. */
  lift: number
  /** The fade is over: hide it. */
  gone: boolean
}

export interface SnapMote {
  x: number
  y: number
  z: number
  /** 0..1 — what remains of the mote. */
  alpha: number
  size: number
}

export interface SnapFrame {
  chars: SnapCharFrame[]
  dust: SnapMote[]
  done: boolean
}

export interface SnapDissolve {
  /** ms from the first frame until the last mote is gone. */
  totalMs: number
  /** The most motes any one frame can hold — size the buffer to this. */
  dustCapacity: number
  advance(frameMs: number): SnapFrame
}

/** Exactly half of `ids`, rounded down, chosen at random. */
export function chooseSnapped(ids: readonly number[], rng: () => number): number[] {
  const pool = [...ids]
  const count = Math.floor(pool.length / 2)
  // A partial Fisher–Yates: the first `count` slots end up a uniform sample.
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i))
    const tmp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = tmp
  }
  return pool.slice(0, count)
}

interface Mote {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** ms from the dissolve's start at which it is released. */
  at: number
  lifeMs: number
  size: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const between = (range: readonly [number, number], rng: () => number) => lerp(range[0], range[1], rng())

export function createSnapDissolve(targets: readonly SnapTarget[], rng: () => number): SnapDissolve {
  const starts = targets.map((_, i) => i * DISSOLVE.staggerMs)
  const motes: Mote[] = []
  targets.forEach((t, i) => {
    for (let k = 0; k < DISSOLVE.dustPerChar; k++) {
      motes.push({
        x: t.x + (rng() - 0.5) * t.w,
        y: t.y + (rng() - 0.5) * t.h,
        z: t.z + (rng() - 0.5) * 0.2,
        vx: (rng() - 0.5) * 2 * DISSOLVE.dustDrift,
        vy: between(DISSOLVE.dustRise, rng),
        vz: (rng() - 0.5) * 2 * DISSOLVE.dustDrift,
        at: starts[i]! + rng() * DISSOLVE.charMs * DISSOLVE.dustReleaseFrac,
        lifeMs: between(DISSOLVE.dustLifeMs, rng),
        size: between(DISSOLVE.dustSize, rng),
      })
    }
  })
  const lastStart = starts.length > 0 ? starts[starts.length - 1]! : 0
  const totalMs = targets.length === 0
    ? 0
    : Math.max(lastStart + DISSOLVE.charMs, ...motes.map((m) => m.at + m.lifeMs))
  let elapsed = 0
  return {
    totalMs,
    dustCapacity: motes.length,
    advance(frameMs) {
      elapsed += frameMs
      const chars = targets.map((t, i) => {
        const progress = Math.min(1, Math.max(0, (elapsed - starts[i]!) / DISSOLVE.charMs))
        const eased = progress * progress
        return {
          id: t.id,
          alpha: 1 - eased,
          lift: DISSOLVE.lift * progress,
          gone: progress >= 1,
        }
      })
      const dust: SnapMote[] = []
      for (const m of motes) {
        const age = elapsed - m.at
        if (age < 0 || age >= m.lifeMs) continue
        const s = age / 1000
        const remaining = 1 - age / m.lifeMs
        dust.push({
          x: m.x + m.vx * s,
          y: m.y + m.vy * s,
          z: m.z + m.vz * s,
          alpha: remaining,
          size: m.size * lerp(1, 0.4, 1 - remaining),
        })
      }
      return { chars, dust, done: elapsed >= totalMs }
    },
  }
}
