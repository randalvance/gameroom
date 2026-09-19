// Fireworks over the city, for the winners' ceremony.
//
// A tiny particle simulation, deliberately three-free: shells are launched on
// a schedule, climb until their fuse runs out, and burst into a sphere of
// sparks that fall under gravity and fade. The scene copies the sparks into a
// Points buffer each frame; nothing here knows what a buffer is, so the
// physics can be tested without a WebGL context behind it.
//
// WHERE they go off matters more than how they look. The room's camera turns
// square on to the front wall for an announcement (see screen-focus.ts), and
// with the wall 13 units high and the framed view nearer 27, the band above
// the wall is open sky. The shells launch from behind the wall — below its
// top, so they are unseen until they climb out over it — and burst in that
// band, where every screen in the room is already looking.

import { RANK_COLORS } from "./rank-numerals"

export interface FireworkShell {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Seconds left before it bursts. */
  fuse: number
  color: number
}

export interface FireworkSpark {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Seconds left; 0 is gone. */
  life: number
  /** What it started with, so the renderer can fade it by the fraction left. */
  maxLife: number
  color: number
  /** Render size, in world units — a few big sparks per burst read as embers. */
  size: number
}

/** Where a shell burst — kept for the flash the scene draws at that point. */
export interface FireworkBurst {
  x: number
  y: number
  z: number
  color: number
  /** Seconds left of the flash. */
  life: number
}

interface PendingShell {
  /** performance.now()-style ms at which it launches. */
  at: number
  color: number
}

export interface FireworksSim {
  pending: PendingShell[]
  shells: FireworkShell[]
  sparks: FireworkSpark[]
  bursts: FireworkBurst[]
}

export interface VolleySpec {
  shells: number
  /** How long the volley is spread over, in ms — the first shell goes at once. */
  spreadMs: number
  /** Shell colours, picked per shell. */
  colors: readonly number[]
}

/**
 * The volume the display fills, in world units. The front wall stands at
 * z = 0 and the room extends to +z, so negative z is the city beyond the
 * wall. `launchY` is under the wall head (13), so a shell rises into view.
 */
export const SKY_BOX = {
  minX: -18,
  maxX: 18,
  minZ: -38,
  maxZ: -12,
  launchY: 8,
  /** Bursts happen between these two heights — all of them over the wall
   * head as seen from the framed pose, which looks up past it from y ≈ 7. */
  minBurstY: 18,
  maxY: 30,
} as const

/** Hard cap on live sparks: the renderer's buffer is sized to it. */
export const MAX_SPARKS = 6000

/** World units per second squared. Real gravity looks too fast at this scale. */
export const FIREWORK_GRAVITY = 3.6
/** Fraction of velocity kept per second — the air slowing a spark. */
const SPARK_DRAG = 0.55
const SHELL_DRAG = 0.9

/** How many sparks one burst throws. */
const SPARKS_PER_BURST = 160
/** How fast they leave the burst, in world units per second. */
const BURST_SPEED = 6
const SPARK_LIFE_MIN = 1.7
const SPARK_LIFE_MAX = 2.8
const BURST_FLASH_S = 0.28

/** The show for each place: third is a taste, first is the finale. */
export function volleyForPlace(place: 1 | 2 | 3): VolleySpec {
  switch (place) {
    case 1:
      return { shells: 12, spreadMs: 6500, colors: [RANK_COLORS.gold, 0xfff6c8, 0xff6ad5, 0x54ffd8] }
    case 2:
      return { shells: 7, spreadMs: 4200, colors: [RANK_COLORS.silver, 0xffffff, 0x8fb4ff] }
    default:
      return { shells: 4, spreadMs: 2800, colors: [RANK_COLORS.bronze, 0xffb070] }
  }
}

export function createFireworks(): FireworksSim {
  return { pending: [], shells: [], sparks: [], bursts: [] }
}

/** Queue a volley starting at `now` (ms). */
export function launchVolley(sim: FireworksSim, spec: VolleySpec, now: number, random: () => number): void {
  for (let i = 0; i < spec.shells; i++) {
    // Evenly spaced across the spread, each nudged so the rhythm is not a
    // metronome. The first one goes at once: the announcement just landed.
    const slot = spec.shells <= 1 ? 0 : (i / (spec.shells - 1)) * spec.spreadMs
    const jitter = i === 0 ? 0 : (random() - 0.5) * (spec.spreadMs / spec.shells) * 0.6
    const at = Math.min(now + spec.spreadMs, Math.max(now, now + slot + jitter))
    sim.pending.push({ at, color: spec.colors[Math.floor(random() * spec.colors.length)] ?? spec.colors[0]! })
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function fireShell(sim: FireworksSim, color: number, random: () => number): void {
  const x = lerp(SKY_BOX.minX, SKY_BOX.maxX, random())
  const z = lerp(SKY_BOX.minZ, SKY_BOX.maxZ, random())
  const apex = lerp(SKY_BOX.minBurstY, SKY_BOX.maxY, random())
  // Climb with drag towards the apex: the fuse is set so the burst lands a
  // touch short of the peak, while the shell is still visibly rising.
  const climb = apex - SKY_BOX.launchY
  const fuse = 1.1 + random() * 0.5
  // With drag the shell covers vy * (1 - drag^t) / -ln(drag) in t seconds
  // (gravity aside); solve for vy so it reaches `climb` at the fuse.
  const k = -Math.log(SHELL_DRAG)
  const vy = (climb * k) / (1 - Math.exp(-k * fuse)) + FIREWORK_GRAVITY * fuse * 0.5
  sim.shells.push({
    x,
    y: SKY_BOX.launchY,
    z,
    vx: (random() - 0.5) * 1.2,
    vy,
    vz: (random() - 0.5) * 1.2,
    fuse,
    color,
  })
}

function burst(sim: FireworksSim, shell: FireworkShell, random: () => number): void {
  sim.bursts.push({ x: shell.x, y: shell.y, z: shell.z, color: shell.color, life: BURST_FLASH_S })
  const room = MAX_SPARKS - sim.sparks.length
  const count = Math.min(SPARKS_PER_BURST, room)
  for (let i = 0; i < count; i++) {
    // A uniform direction on the sphere (Marsaglia), so the burst is round
    // from every seat in the room rather than bunched at the poles.
    const u = random() * 2 - 1
    const phi = random() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    const speed = BURST_SPEED * (0.55 + random() * 0.55)
    const life = lerp(SPARK_LIFE_MIN, SPARK_LIFE_MAX, random())
    sim.sparks.push({
      x: shell.x,
      y: shell.y,
      z: shell.z,
      vx: r * Math.cos(phi) * speed + shell.vx * 0.3,
      vy: u * speed + shell.vy * 0.15,
      vz: r * Math.sin(phi) * speed + shell.vz * 0.3,
      life,
      maxLife: life,
      color: shell.color,
      size: random() < 0.15 ? 0.75 : 0.42,
    })
  }
}

/**
 * One frame. `dt` is seconds of simulation, `now` the clock the volley was
 * scheduled against (ms).
 */
export function stepFireworks(sim: FireworksSim, dt: number, now: number, random: () => number): void {
  if (sim.pending.length > 0) {
    const due = sim.pending.filter((shell) => shell.at <= now)
    if (due.length > 0) {
      sim.pending = sim.pending.filter((shell) => shell.at > now)
      for (const shell of due) fireShell(sim, shell.color, random)
    }
  }
  if (dt <= 0) return

  const shellKeep = Math.pow(SHELL_DRAG, dt)
  for (let i = sim.shells.length - 1; i >= 0; i--) {
    const shell = sim.shells[i]!
    shell.fuse -= dt
    shell.vy -= FIREWORK_GRAVITY * dt
    shell.vx *= shellKeep
    shell.vy *= shellKeep
    shell.vz *= shellKeep
    shell.x += shell.vx * dt
    shell.y += shell.vy * dt
    shell.z += shell.vz * dt
    if (shell.fuse <= 0) {
      burst(sim, shell, random)
      sim.shells.splice(i, 1)
    }
  }

  const sparkKeep = Math.pow(SPARK_DRAG, dt)
  let write = 0
  for (let i = 0; i < sim.sparks.length; i++) {
    const spark = sim.sparks[i]!
    spark.life -= dt
    if (spark.life <= 0) continue
    spark.vy -= FIREWORK_GRAVITY * dt
    spark.vx *= sparkKeep
    spark.vy *= sparkKeep
    spark.vz *= sparkKeep
    spark.x += spark.vx * dt
    spark.y += spark.vy * dt
    spark.z += spark.vz * dt
    sim.sparks[write++] = spark
  }
  sim.sparks.length = write

  let keepBursts = 0
  for (let i = 0; i < sim.bursts.length; i++) {
    const flash = sim.bursts[i]!
    flash.life -= dt
    if (flash.life > 0) sim.bursts[keepBursts++] = flash
  }
  sim.bursts.length = keepBursts
}

/**
 * The sound of each place's volley, as a public asset path. Three separate
 * cues rather than one looped bang: each is generated to run the length of
 * its volley — a few pops for third, a rolling salvo for the finale — so the
 * sound ends with the sky, not on a timer.
 */
export function fireworksCueFor(place: 1 | 2 | 3): string {
  switch (place) {
    case 1:
      return "/fireworks_first.mp3"
    case 2:
      return "/fireworks_second.mp3"
    default:
      return "/fireworks_third.mp3"
  }
}

/**
 * The victory music for each place, as a public asset path. Three lively
 * video game victory fanfares, a minute each: a marching brass band parade
 * for third, an arcade chiptune-and-orchestra celebration for second, and a
 * bouncy party fanfare for the winner. Generated with ElevenLabs music
 * (scripts/gen-victory-music.sh).
 */
export function victoryMusicFor(place: 1 | 2 | 3): string {
  switch (place) {
    case 1:
      return "/victory_first.mp3"
    case 2:
      return "/victory_second.mp3"
    default:
      return "/victory_third.mp3"
  }
}
