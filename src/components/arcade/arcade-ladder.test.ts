import { describe, expect, it } from "vitest"
import { buildCpuLadder } from "./arcade-ladder"

describe("CPU ladder", () => {
  it("schedules two other fighters before Bernard's final-boss fight", () => {
    const ladder = buildCpuLadder("bull", () => 0)
    expect(ladder).toHaveLength(3)
    expect(ladder[2]).toBe("bernard")
    expect(ladder.slice(0, 2)).not.toContain("bull")
    expect(ladder.slice(0, 2)).not.toContain("bernard")
  })
})
