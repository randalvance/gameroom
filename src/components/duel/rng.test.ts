import { describe, expect, it } from "vitest"
import { createRng, shuffle } from "./rng"

describe("createRng", () => {
  it("is deterministic for a seed and stays in [0,1)", () => {
    const a = createRng(7), b = createRng(7)
    const xs = Array.from({ length: 50 }, () => a.next())
    expect(xs).toEqual(Array.from({ length: 50 }, () => b.next()))
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1) }
  })
  it("int(n) covers 0..n-1", () => {
    const rng = createRng(3)
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(4)))
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
  })
})

describe("shuffle", () => {
  it("permutes without losing or duplicating and does not mutate the input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = shuffle(input, createRng(11))
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...out].sort((x, y) => x - y)).toEqual(input)
    expect(out).not.toEqual(input)
  })
})
