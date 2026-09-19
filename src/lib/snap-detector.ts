// Hearing a finger snap in a microphone stream.
//
// A snap is a transient: near-silence, one very loud frame, near-silence. The
// detector tracks a slow noise floor and fires when a frame's level jumps well
// clear of it in a single step. Speech and music rise over many frames, so the
// floor climbs with them and they never look like a jump; a clap does, and
// that is fine for an easter egg.
//
// Pure: the caller measures each frame (see `rmsOf`) and pushes the number
// with a clock. No AudioContext here, so the rule is pinned by a test.

export const SNAP = {
  /** Quietest level that can ever count, so silence is not amplified into snaps. */
  minLevel: 0.08,
  /** How many times the noise floor a frame must be. */
  ratio: 6,
  /** The frame before the snap must be at most this fraction of it: a real
   * transient comes out of nothing, not out of an already loud frame. */
  riseFrom: 0.35,
  /** The noise floor's smoothing while the level is above it (rising slowly)
   * and below it (falling faster). */
  floorRise: 0.03,
  floorFall: 0.2,
  /** Opening the mic pops; nothing in this window counts. */
  warmupMs: 250,
  /** After one snap, the next is not heard for this long. */
  cooldownMs: 1500,
} as const

export interface SnapDetector {
  /** One frame's level (0..1), with a ms clock. True when a snap just landed. */
  push(level: number, nowMs: number): boolean
}

export function createSnapDetector(): SnapDetector {
  let floor = 0
  let prev = 0
  let startedAt: number | null = null
  let lastFiredAt = -Infinity
  return {
    push(level, nowMs) {
      if (startedAt === null) startedAt = nowMs
      const settling = nowMs - startedAt < SNAP.warmupMs
      const jumped =
        !settling &&
        level >= SNAP.minLevel &&
        level >= floor * SNAP.ratio &&
        prev <= level * SNAP.riseFrom &&
        nowMs - lastFiredAt >= SNAP.cooldownMs
      // A snap must not drag the floor up behind it, or the next one is judged
      // against the last.
      if (!jumped) {
        floor += (level - floor) * (level > floor ? SNAP.floorRise : SNAP.floorFall)
      }
      prev = level
      if (jumped) lastFiredAt = nowMs
      return jumped
    },
  }
}

/** The RMS level (0..1) of an AnalyserNode's byte time-domain buffer. */
export function rmsOf(samples: Uint8Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const s of samples) {
    const v = (s - 128) / 128
    sum += v * v
  }
  return Math.sqrt(sum / samples.length)
}
