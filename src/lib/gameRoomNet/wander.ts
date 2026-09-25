// The laps a working agent walks around its desk. Pure and DOM-free on
// purpose: state in, state out, deterministic for a given seed and step
// count — which is what lets every client walk the same agents the same way
// from the same props, with nothing relayed between them.

/**
 * Overall pace of the wandering cast — 1 is the original gait. Scales the walk
 * cycle and the distance covered TOGETHER, so a slower room still lands one
 * stride per animation frame instead of moonwalking.
 */
export const WALK_SPEED = 0.8

export interface WanderState {
  phase: number
  speed: number
  pauseLeft: number
  rng: number
}

/** The seeds the scene has always used, so the cast keeps its personality. */
export function seedWander(playerIdx: number, teamIdx: number, seatIdx: number): WanderState {
  return {
    phase: seatIdx * 30 + teamIdx * 7,
    speed: (0.28 + (playerIdx % 7) * 0.02) * WALK_SPEED * (playerIdx % 3 === 0 ? -1 : 1),
    pauseLeft: (playerIdx * 7) % 25,
    rng: (playerIdx * 1664525 + 1013904223) & 0x7fffffff,
  }
}

/**
 * One 60 Hz step of a character's aimless orbit of its table. Mutates the
 * state. The pause lengths and roll odds are tuned against the fixed clock —
 * see gameRoom3d/sim-clock.ts.
 */
export function stepWander(w: WanderState): void {
  if (w.pauseLeft > 0) {
    w.pauseLeft--
    return
  }
  w.phase += w.speed
  w.rng = (w.rng * 1664525 + 1013904223) & 0x7fffffff
  if ((w.rng & 0xff) < 1) w.pauseLeft = 30 + ((w.rng >> 8) & 0x3f)
  if ((w.rng & 0x3ff) < 1) w.speed = -w.speed
}
