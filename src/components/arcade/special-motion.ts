// Shared geometry/timing for simulation, effects and frame selection.
import type { Box } from "./characters"
import type { Fighter } from "./fight-sim"

export const BEAR_WINDUP = 200
export function circleRadius(f: Fighter): number {
  const move = f.move
  if (f.state !== "attack" || move?.kind !== "circle") return 0
  if (f.moveMs < move.startup) return 0
  const progress = Math.max(0, Math.min(1, (f.moveMs - move.startup) / move.active))
  if (move.circleTravel) return (move.range ?? 150) * (0.6 + 0.4 * progress)
  return progress < 1 / 3 ? 80 : progress < 2 / 3 ? 220 : move.range ?? 400
}

export function scriptedMotion(f: Fighter): boolean {
  return f.state === "attack" && ((f.move?.kind === "iceSlam" && !f.special?.landed) || f.move?.kind === "breakingNews")
}

/** Descent and the impact window can overlap bodies, like a diving attack.
 * Normal separation resumes in recovery, after the marked impact resolved. */
export function divingThroughBodies(f: Fighter): boolean {
  return f.state === "attack" && f.move?.kind === "iceSlam"
    && (f.y > 0 || (f.moveMs >= f.move.startup && f.moveMs < f.move.startup + f.move.active))
}

/** Returns true exactly once on a scripted landing, for sound/impact cues. */
export function stepSpecialMotion(f: Fighter, other: Fighter, dtMs: number, stageWidth: number): boolean {
  void other
  const move = f.move, special = f.special
  if (!move || !special) return false
  const clampX = (x: number) => Math.max(f.def.width / 2, Math.min(stageWidth - f.def.width / 2, x))
  if (move.kind === "breakingNews") {
    const u = Math.min(1, f.moveMs / BREAKING_NEWS_LEAP_MS)
    f.x = special.originX + ((special.hoverX ?? special.originX) - special.originX) * u
    const recovery = Math.max(0, (f.moveMs - move.startup - move.active) / move.recovery)
    f.y = BREAKING_NEWS_HOVER_HEIGHT * Math.sin(u * Math.PI / 2) * (1 - Math.min(1, recovery))
    f.vx = 0; f.vy = 0
    return false
  }
  if (move.kind === "dash" && f.moveMs >= move.startup && f.moveMs < move.startup + move.active && !f.hitDone) {
    const remaining = Math.max(0, (move.range ?? 720) - Math.abs(f.x - special.originX))
    const activeDt = Math.min(dtMs, f.moveMs - move.startup)
    f.x = clampX(f.x + f.facing * Math.min(remaining, (move.selfVx ?? 0) * activeDt / 1000))
  }
  if (move.kind === "iceSlam" && !special.landed) {
    const u = Math.max(0, Math.min(1, (f.moveMs - BEAR_WINDUP) / (move.startup - BEAR_WINDUP)))
    f.x = special.originX + (special.targetX - special.originX) * u
    f.y = 4 * 160 * u * (1 - u)
    f.vx = 0; f.vy = 0
  }
  if (scriptedMotion(f) && f.moveMs >= move.startup && !special.landed) {
    special.landed = true
    return true
  }
  return false
}


export const BREAKING_NEWS_LEAP_MS = 600
export const BREAKING_NEWS_FLIGHT_MS = 600
export const BREAKING_NEWS_HOVER_HEIGHT = 190
export const BREAKING_NEWS_WIDTH = 320
export const BREAKING_NEWS_SAFE_HALF_WIDTH = 80

export function circleCenter(f: Fighter): { x: number; y: number } {
  const progress = f.move ? Math.max(0, Math.min(1, (f.moveMs - f.move.startup) / f.move.active)) : 0
  return { x: f.x + f.facing * (f.move?.circleTravel ?? 0) * progress, y: f.y + f.def.height / 2 }
}

/** The entire horizontal ribbon fits between the tallest crouch (110) and
 * shortest standing body (120). Oscillation is deliberately limited to 2px. */
export function scanningBeamBox(f: Fighter): Box {
  const y = 112 + Math.sin(Math.max(0, f.moveMs - (f.move?.startup ?? 0)) / 1000 * Math.PI * 2) * 2
  return { x: f.facing === 1 ? f.x + 18 : f.x - 978, y: f.y + y, w: 960, h: 6 }
}

/** Shared collision and drawing geometry. Target is never clamped back into
 * the stage: doing so could move the blast into the safe space below Bernard. */
export function breakingNewsGeometry(f: Fighter) {
  const move = f.move
  const t = f.moveMs - (move?.startup ?? 2200)
  const phase: 'charge' | 'flight' | 'explosion' | 'recovery' = t < 0 ? 'charge' : t < BREAKING_NEWS_FLIGHT_MS ? 'flight' : t < (move?.active ?? 900) ? 'explosion' : 'recovery'
  const hoverX = f.special?.hoverX ?? f.x
  const targetX = f.special?.targetX ?? hoverX + f.facing * 280
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  const flightProgress = clamp(t / BREAKING_NEWS_FLIGHT_MS)
  const progress = phase === 'charge' ? clamp((f.moveMs - BREAKING_NEWS_LEAP_MS) / ((move?.startup ?? 2200) - BREAKING_NEWS_LEAP_MS))
    : phase === 'flight' ? flightProgress
    : phase === 'explosion' ? clamp((t - BREAKING_NEWS_FLIGHT_MS) / ((move?.active ?? 900) - BREAKING_NEWS_FLIGHT_MS))
    : clamp((t - (move?.active ?? 900)) / (move?.recovery ?? 500))
  const overheadY = f.y + f.def.height + 104
  return {
    phase, progress,
    ballX: phase === 'charge' ? f.x : hoverX + (targetX - hoverX) * flightProgress,
    ballY: phase === 'charge' ? overheadY : (BREAKING_NEWS_HOVER_HEIGHT + f.def.height + 104) * (1 - flightProgress) + 160 * flightProgress,
    radius: phase === 'charge' ? 12 + progress * 44 : 56,
    explosion: { x: targetX - BREAKING_NEWS_WIDTH / 2, y: 0, w: BREAKING_NEWS_WIDTH, h: BREAKING_NEWS_WIDTH },
    safeColumn: { x: hoverX - BREAKING_NEWS_SAFE_HALF_WIDTH, y: 0, w: BREAKING_NEWS_SAFE_HALF_WIDTH * 2, h: BREAKING_NEWS_HOVER_HEIGHT },
  }
}
