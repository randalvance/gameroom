// Pins the load-bearing property of the dollars<->cents boundary: d2c ROUNDS.
// "Simplifying" it to `dollars * 100` ships fractional cents onto the wire
// silently — the exact bug validateInstrumentConfig had (audit #428, $4.35).
import { describe, expect, it } from "vitest"
import { c2d, d2c } from "./money"

describe("money boundary", () => {
  it("d2c survives the float trap the helper exists for", () => {
    // 150.10 * 100 === 15010.000000000002 — Math.round is load-bearing.
    expect(d2c(150.10)).toBe(15010)
  })

  it("d2c always yields whole cents, whatever gets typed", () => {
    expect(Number.isInteger(d2c(42.505))).toBe(true)
  })

  it("the round trip is lossless", () => {
    expect(d2c(c2d(4251))).toBe(4251)
  })
})
