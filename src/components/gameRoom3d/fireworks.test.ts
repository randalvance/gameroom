import { describe, expect, it } from "vitest"
import {
  createFireworks,
  FIREWORK_GRAVITY,
  fireworksCueFor,
  launchVolley,
  MAX_SPARKS,
  SKY_BOX,
  stepFireworks,
  victoryMusicFor,
  volleyForPlace,
} from "./fireworks"

/** A deterministic random source: a fixed cycle of values in [0, 1). */
function cycle(values: readonly number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

const RNG = [0.37, 0.61, 0.83, 0.12]

/** Run the sim forward `seconds` in 60 Hz steps. */
function run(sim: ReturnType<typeof createFireworks>, seconds: number, from = 0, rng = cycle(RNG)) {
  const dt = 1 / 60
  let now = from
  for (let i = 0; i < seconds * 60; i++) {
    now += dt * 1000
    stepFireworks(sim, dt, now, rng)
  }
  return now
}

/** Step until the last shell has burst, and hand back the moment it did. */
function runUntilBurst(sim: ReturnType<typeof createFireworks>, from = 0, rng = cycle(RNG)) {
  const dt = 1 / 60
  let now = from
  for (let i = 0; i < 10 * 60; i++) {
    now += dt * 1000
    stepFireworks(sim, dt, now, rng)
    if (sim.shells.length === 0 && sim.bursts.length > 0) return now
  }
  throw new Error("the shell never burst")
}

describe("volleyForPlace", () => {
  it("throws more shells the higher the place, with the finale for first", () => {
    const third = volleyForPlace(3)
    const second = volleyForPlace(2)
    const first = volleyForPlace(1)
    expect(second.shells).toBeGreaterThan(third.shells)
    expect(first.shells).toBeGreaterThan(second.shells)
    expect(first.spreadMs).toBeGreaterThan(third.spreadMs)
  })

  it("colours each place in its medal", () => {
    expect(volleyForPlace(1).colors).toContain(0xffd24a)
    expect(volleyForPlace(2).colors).toContain(0xaec6e8)
    expect(volleyForPlace(3).colors).toContain(0xd08a46)
  })
})

describe("a volley", () => {
  it("schedules its shells across the spread rather than all at once", () => {
    const sim = createFireworks()
    launchVolley(sim, { shells: 4, spreadMs: 3000, colors: [0xffffff] }, 1000, cycle([0.5]))
    expect(sim.pending).toHaveLength(4)
    const at = sim.pending.map((shell) => shell.at)
    expect(at[0]).toBe(1000)
    expect(Math.max(...at)).toBeLessThanOrEqual(4000)
    expect(new Set(at).size).toBe(4)
  })

  it("launches a shell only once its time has come", () => {
    const sim = createFireworks()
    launchVolley(sim, { shells: 2, spreadMs: 2000, colors: [0xffffff] }, 1000, cycle([0.5]))
    stepFireworks(sim, 1 / 60, 999, cycle([0.5]))
    expect(sim.shells).toHaveLength(0)
    stepFireworks(sim, 1 / 60, 1000, cycle([0.5]))
    expect(sim.shells).toHaveLength(1)
    expect(sim.pending).toHaveLength(1)
  })

  it("launches from behind the front wall, inside the sky box", () => {
    const sim = createFireworks()
    launchVolley(sim, { shells: 6, spreadMs: 0, colors: [0xffffff] }, 0, cycle([0, 0.999, 0.5, 0.25, 0.75]))
    // A zero-length step launches what is due without moving anything.
    stepFireworks(sim, 0, 0, cycle([0, 0.999, 0.5, 0.25, 0.75]))
    for (const shell of sim.shells) {
      expect(shell.x).toBeGreaterThanOrEqual(SKY_BOX.minX)
      expect(shell.x).toBeLessThanOrEqual(SKY_BOX.maxX)
      expect(shell.z).toBeGreaterThanOrEqual(SKY_BOX.minZ)
      expect(shell.z).toBeLessThanOrEqual(SKY_BOX.maxZ)
      expect(shell.y).toBe(SKY_BOX.launchY)
      expect(shell.vy).toBeGreaterThan(0)
    }
  })
})

describe("a shell", () => {
  it("climbs, then bursts into sparks above where it was launched", () => {
    const sim = createFireworks()
    launchVolley(sim, { shells: 1, spreadMs: 0, colors: [0xff0000] }, 0, cycle([0.5]))
    run(sim, 0.2)
    expect(sim.shells).toHaveLength(1)
    const climbed = sim.shells[0]!.y
    expect(climbed).toBeGreaterThan(SKY_BOX.launchY)
    runUntilBurst(sim, 200)
    expect(sim.shells).toHaveLength(0)
    expect(sim.sparks.length).toBeGreaterThan(50)
    const burstY = sim.bursts[0]!.y
    expect(burstY).toBeGreaterThan(climbed)
    expect(burstY).toBeGreaterThanOrEqual(SKY_BOX.minBurstY - 1)
    expect(burstY).toBeLessThanOrEqual(SKY_BOX.maxY + 1)
    expect(sim.sparks.every((spark) => spark.color === 0xff0000)).toBe(true)
  })

  it("bursts symmetrically — the sparks spread in every direction", () => {
    const sim = createFireworks()
    launchVolley(sim, { shells: 1, spreadMs: 0, colors: [0xffffff] }, 0, cycle([0.5]))
    runUntilBurst(sim)
    const sparks = sim.sparks
    expect(sparks.length).toBeGreaterThan(0)
    const burst = sim.bursts[0]!
    const left = sparks.filter((spark) => spark.x < burst.x).length
    const right = sparks.filter((spark) => spark.x > burst.x).length
    expect(Math.abs(left - right)).toBeLessThan(sparks.length * 0.35)
  })
})

describe("sparks", () => {
  it("fall under gravity and fade out, and are then forgotten", () => {
    const sim = createFireworks()
    launchVolley(sim, { shells: 1, spreadMs: 0, colors: [0xffffff] }, 0, cycle([0.5]))
    const now = run(sim, 2.2)
    expect(sim.sparks.length).toBeGreaterThan(0)
    const before = sim.sparks.map((spark) => ({ vy: spark.vy, life: spark.life }))
    stepFireworks(sim, 1 / 60, now + 16, cycle([0.5]))
    sim.sparks.forEach((spark, i) => {
      expect(spark.vy).toBeLessThan(before[i]!.vy)
      expect(spark.life).toBeLessThan(before[i]!.life)
    })
    expect(FIREWORK_GRAVITY).toBeGreaterThan(0)
    run(sim, 6, now)
    expect(sim.sparks).toHaveLength(0)
    expect(sim.bursts).toHaveLength(0)
  })

  it("never exceeds the cap the renderer has room for", () => {
    const sim = createFireworks()
    for (let i = 0; i < 20; i++) launchVolley(sim, volleyForPlace(1), 0, cycle([0.5, 0.2, 0.9]))
    run(sim, 3)
    expect(sim.sparks.length).toBeLessThanOrEqual(MAX_SPARKS)
  })

  it("is quiet with nothing launched", () => {
    const sim = createFireworks()
    run(sim, 2)
    expect(sim.sparks).toHaveLength(0)
    expect(sim.shells).toHaveLength(0)
    expect(sim.pending).toHaveLength(0)
  })
})

describe("fireworksCueFor", () => {
  it("has a cue per place, each its own recording", () => {
    const cues = [3, 2, 1].map((place) => fireworksCueFor(place as 1 | 2 | 3))
    expect(new Set(cues).size).toBe(3)
    for (const cue of cues) expect(cue).toMatch(/^\/fireworks_.*\.mp3$/)
  })
})

describe("victoryMusicFor", () => {
  it("has a track per place, each its own recording", () => {
    const tracks = [3, 2, 1].map((place) => victoryMusicFor(place as 1 | 2 | 3))
    expect(new Set(tracks).size).toBe(3)
    for (const track of tracks) expect(track).toMatch(/^\/victory_.*\.mp3$/)
  })

  it("never shares a file with any fireworks cue", () => {
    const cues = [3, 2, 1].map((place) => fireworksCueFor(place as 1 | 2 | 3))
    for (const place of [3, 2, 1] as const) expect(cues).not.toContain(victoryMusicFor(place))
  })
})
