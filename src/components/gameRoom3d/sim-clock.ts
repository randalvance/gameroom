// The room's animation clock.
//
// Everything about a character's wander — how far it moves, how fast its legs
// cycle, how long it stands still — used to count requestAnimationFrame ticks.
// rAF fires at the DISPLAY's refresh rate, so the room ran at exactly double
// speed on a 120 Hz screen and at whatever rate the monitor happened to be
// elsewhere. The constants those behaviours are tuned against (one sprite frame
// per 6 ticks, a 30–93 tick pause, the 1-in-256 roll that starts one) only mean
// something against a FIXED rate, so the scene advances a 60 Hz simulation step
// instead and lets rAF drive rendering alone.

export const SIM_HZ = 60
export const SIM_STEP_MS = 1000 / SIM_HZ

/**
 * A backgrounded tab — or one long GC pause — hands back an enormous elapsed
 * time. Without a cap the room would fast-forward every character through the
 * whole gap in a single frame, so a returning tab resumes rather than teleports.
 */
export const MAX_STEPS_PER_FRAME = 5

export interface SimAdvance {
  /** Simulation steps to run this frame. */
  steps: number
  /** Time left over, to carry into the next frame. */
  carryMs: number
}

/**
 * How many fixed steps the elapsed wall-clock time is worth. Carrying the
 * remainder is what keeps a refresh rate that does not divide evenly into the
 * step (a 90 Hz or 144 Hz display) from drifting slow.
 */
export function advanceSimClock(carryMs: number, elapsedMs: number): SimAdvance {
  const pending = carryMs + Math.max(0, elapsedMs)
  const steps = Math.floor(pending / SIM_STEP_MS)
  if (steps > MAX_STEPS_PER_FRAME) return { steps: MAX_STEPS_PER_FRAME, carryMs: 0 }
  return { steps, carryMs: pending - steps * SIM_STEP_MS }
}
