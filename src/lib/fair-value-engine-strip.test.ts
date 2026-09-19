// The engine strip's numbers, derived from one live snapshot of the hidden
// price engine. The math mirrors the Go engine exactly: destination is
// start × (1 + target), drift is the per-tick geometric rate that lands the
// anchor on the destination in the remaining ticks (pricing_engine.go drift()).
import { describe, expect, it } from "vitest"

import { engineStrip } from "./fair-value-engine-strip"

// NOVA mid-window: $150 start targeting +20%, anchor at $174.12, 43 of 90
// ticks done.
const nova = { startPrice: 150, targetPct: 0.2, anchor: 174.12, tick: 43, n: 90 }

describe("engineStrip", () => {
  it("computes the destination price from start × (1 + target)", () => {
    expect(engineStrip(nova).destPrice).toBeCloseTo(180, 10)
  })

  it("measures the anchor's deviation from the destination, in percent", () => {
    // (174.12 − 180) / 180 = −3.2667%
    expect(engineStrip(nova).deviationPct).toBeCloseTo(-3.2667, 3)
  })

  it("counts the ticks left", () => {
    expect(engineStrip(nova).ticksLeft).toBe(47)
  })

  it("computes the per-tick drift the engine will apply, in percent", () => {
    // (180 / 174.12)^(1/47) − 1 = +0.0707%/tick
    expect(engineStrip(nova).driftPctPerTick).toBeCloseTo(0.0707, 3)
  })

  it("a flat target's destination is the starting price itself", () => {
    const flat = engineStrip({ ...nova, targetPct: 0, anchor: 150 })
    expect(flat.destPrice).toBe(150)
    expect(flat.deviationPct).toBeCloseTo(0, 10)
    expect(flat.driftPctPerTick).toBeCloseTo(0, 10)
  })

  it("has no drift once the path is complete — matching the engine, which stops advancing", () => {
    const done = engineStrip({ ...nova, tick: 90 })
    expect(done.ticksLeft).toBe(0)
    expect(done.driftPctPerTick).toBeNull()
  })

  it("never divides by zero on a degenerate destination or anchor", () => {
    // targetPct −1 would put the destination at $0; a dead anchor likewise.
    expect(engineStrip({ ...nova, targetPct: -1 }).deviationPct).toBeNull()
    expect(engineStrip({ ...nova, targetPct: -1 }).driftPctPerTick).toBeNull()
    expect(engineStrip({ ...nova, anchor: 0 }).driftPctPerTick).toBeNull()
  })
})
