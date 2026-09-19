// The arcade cabinet's entrance.
//
// When the Konami code lands the room does not just gain a prop: the camera
// moves over to the spot beside Primey, the cabinet drops in from above, hits
// the floor with a squash and a burst of dust, sits for a beat, and the
// camera goes back to wherever it was. This is that timeline, as pure state —
// the scene advances it once per frame and copies the numbers into the
// camera, the cabinet's transform and a dust particle buffer. No three.js
// here, so the whole sequence can be pinned by a test.
//
// The camera move is a BLEND (0..1) between the room's own view and a pose
// framed on the cabinet, the way the wall screen is framed — not a pan. The
// cabinet stands against the south wall, past where the pan is allowed to go,
// and a dolly in toward it reads better than a slide anyway.

export const REVEAL = {
  /** Camera slide from where it was to the cabinet's spot. */
  panInMs: 750,
  /** The drop starts this long before the pan-in finishes, so the cabinet
   * falls into a frame that is still settling. */
  dropLeadMs: 150,
  dropMs: 620,
  /** World units above the floor the cabinet starts its fall from — just
   * above the top of the framed view, so the whole fall is on screen. */
  dropHeight: 13,
  /** The landing squash, and how long the dust hangs around. */
  squashMs: 220,
  dustMs: 1000,
  /** How long the camera lingers on the landed cabinet before going back. */
  holdMs: 500,
  panBackMs: 750,
  /** Camera shake on impact: amplitude in world units, and its decay time. */
  shake: 0.32,
  shakeMs: 260,
  dustCount: 56,
} as const

export interface DustParticle {
  /** Floor-plane offset from the landing point, and height above it. */
  x: number
  y: number
  z: number
  /** 0..1 — what remains of the particle. */
  alpha: number
  size: number
}

export interface RevealFrame {
  /** 0 = the room's own view, 1 = the camera framed on the cabinet. */
  focus: number
  /** Impact jitter to add to the camera, world units; zero except just after the thud. */
  shake: { x: number; z: number }
  /** The cabinet's height above the floor. */
  cabinetY: number
  /** Vertical scale of the cabinet: dips below 1 on impact. */
  squash: number
  /** True on the one frame the cabinet touches down. */
  landedNow: boolean
  /** True from touchdown on. */
  landed: boolean
  /** The dust, or an empty list before impact / after it has settled. */
  dust: readonly DustParticle[]
  /** Radius of the ground ring, 0 when there is none, and its opacity. */
  ring: { radius: number; opacity: number }
  done: boolean
}

export interface ArcadeReveal {
  advance(dtMs: number): RevealFrame
  /** Total length, for input freezes and the like. */
  readonly totalMs: number
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

interface Mote {
  angle: number
  speed: number
  rise: number
  size: number
  drift: number
}

export function createArcadeReveal(random: () => number = Math.random): ArcadeReveal {
  const dropStart = REVEAL.panInMs - REVEAL.dropLeadMs
  const landAt = dropStart + REVEAL.dropMs
  const panBackAt = landAt + REVEAL.holdMs
  const totalMs = panBackAt + REVEAL.panBackMs
  const motes: Mote[] = Array.from({ length: REVEAL.dustCount }, () => ({
    angle: random() * Math.PI * 2,
    speed: 2.2 + random() * 3.4,
    rise: 0.5 + random() * 1.6,
    size: 0.5 + random() * 0.9,
    drift: (random() - 0.5) * 0.8,
  }))
  let t = 0
  let landedReported = false

  const focusAt = (time: number): number => {
    if (time <= REVEAL.panInMs) return easeInOut(clamp01(time / REVEAL.panInMs))
    if (time < panBackAt) return 1
    return 1 - easeInOut(clamp01((time - panBackAt) / REVEAL.panBackMs))
  }

  return {
    totalMs,
    advance(dtMs) {
      t += Math.max(0, dtMs)
      const focus = focusAt(t)
      // Impact shake, decaying: a few frames of jitter after the thud.
      const sinceLand = t - landAt
      const shake = { x: 0, z: 0 }
      if (sinceLand >= 0 && sinceLand < REVEAL.shakeMs) {
        const amp = REVEAL.shake * (1 - sinceLand / REVEAL.shakeMs)
        shake.x = Math.sin(sinceLand * 0.09) * amp
        shake.z = Math.cos(sinceLand * 0.13) * amp * 0.6
      }
      let cabinetY: number = REVEAL.dropHeight
      if (t >= landAt) cabinetY = 0
      else if (t >= dropStart) {
        const u = (t - dropStart) / REVEAL.dropMs
        cabinetY = REVEAL.dropHeight * (1 - u * u)
      }
      const landed = t >= landAt
      const landedNow = landed && !landedReported
      if (landedNow) landedReported = true
      const squash = landed && sinceLand < REVEAL.squashMs
        ? 1 - 0.2 * Math.sin(Math.PI * (sinceLand / REVEAL.squashMs))
        : 1
      const dust: DustParticle[] = []
      let ring = { radius: 0, opacity: 0 }
      if (landed && sinceLand < REVEAL.dustMs) {
        const a = sinceLand / REVEAL.dustMs
        const spread = easeOut(a)
        for (const m of motes) {
          const r = m.speed * spread
          dust.push({
            x: Math.cos(m.angle) * r + m.drift * a,
            y: Math.max(0.05, m.rise * Math.sin(Math.PI * Math.min(1, a * 1.15)) * (1 - a * 0.4)),
            z: Math.sin(m.angle) * r,
            alpha: (1 - a) * (1 - a),
            size: m.size * (0.6 + a),
          })
        }
        ring = { radius: 0.6 + spread * 4.4, opacity: 0.55 * (1 - a) }
      }
      return {
        focus,
        shake,
        cabinetY,
        squash,
        landedNow,
        landed,
        dust,
        ring,
        done: t >= totalMs,
      }
    },
  }
}
