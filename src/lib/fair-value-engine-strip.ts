// Derives the engine strip's numbers from one live snapshot of the hidden
// price engine — pure math, mirroring the Go engine (pricing_engine.go):
// destination = start × (1 + target); drift is the per-tick geometric rate
// that lands the anchor on the destination in the remaining ticks. All
// prices are dollars; all percentages are display-ready (−3.27 = −3.27%).

export interface FairValueEngineState {
  startPrice: number // dollars
  targetPct: number // fraction: 0.15 = +15%
  anchor: number // dollars, the live hidden value
  tick: number // completed intervals
  n: number // session horizon in intervals
}

export interface EngineStrip {
  targetPct: number // fraction, echoed for display
  destPrice: number // dollars
  deviationPct: number | null // anchor vs destination; null on a $0 destination
  ticksLeft: number
  driftPctPerTick: number | null // null when the path is complete or degenerate
}

export function engineStrip(e: FairValueEngineState): EngineStrip {
  const destPrice = e.startPrice * (1 + e.targetPct)
  const ticksLeft = Math.max(e.n - e.tick, 0)
  const deviationPct = destPrice > 0 ? ((e.anchor - destPrice) / destPrice) * 100 : null
  // The engine's own guard (drift() in pricing_engine.go): no remaining
  // ticks, or a non-positive anchor or destination, means no drift.
  const driftPctPerTick =
    ticksLeft > 0 && e.anchor > 0 && destPrice > 0
      ? (Math.pow(destPrice / e.anchor, 1 / ticksLeft) - 1) * 100
      : null
  return { targetPct: e.targetPct, destPrice, deviationPct, ticksLeft, driftPctPerTick }
}
