// What the room looks like at a given hour.
//
// One palette drives BOTH halves of the picture — the backdrop outside (haze,
// the three city layers, window lights) and the room's own lighting inside
// (hemisphere bounce, key, rim, fog). They have to come from one place: the
// room used to be lit for a dark evening while the window showed a midday blue
// sky, which is the giveaway that the two were written independently.
//
// There is deliberately no sky in this palette. The camera pitches ~30° down
// and its top frame edge sits below the horizon in every mode, so the view out
// of the room is DOWNWARD at the neighbouring towers — sky-gradient, cloud and
// star fields would never cover a pixel. What stands in for the sky is the
// haze pair: `haze` is the atmosphere the city sinks into below us, `hazeTop`
// its brighter rim just under the (off-screen) horizon.
//
// The keyframes below are interpolated, never switched between, so there is no
// minute of the day at which the room visibly changes state. That also means
// the assets outside can stay colourless: three white city silhouettes get
// tinted per hour rather than authored four times over.
import { SGT } from "../../lib/time"

export const MINUTES_PER_DAY = 24 * 60

export interface SkyPalette {
  /** The atmosphere's brighter rim, up near the (off-screen) horizon. */
  hazeTop: number
  /** Warm tint bleeding into that rim — the sun below or just past it. */
  horizonGlow: number
  /** How much of that warmth shows, 0 at midday and midnight, 1 at sunset. */
  glowStrength: number
  /** Silhouette tints. Far is palest: more air to look through. */
  cityFar: number
  cityMid: number
  cityNear: number
  /** How brightly the towers' windows burn, 0 by day. */
  windowLights: number
  /** The atmosphere the city below sinks into; also the room's fog colour. */
  haze: number
  hemiSky: number
  hemiGround: number
  hemiIntensity: number
  keyColor: number
  keyIntensity: number
  rimColor: number
  rimIntensity: number
}

/** A palette pinned to a minute of the Singapore day. */
interface Keyframe extends SkyPalette {
  minute: number
}

// Sunrise in Singapore is close to 07:00 and sunset close to 19:10 all year —
// it sits a degree off the equator, so unlike most cities these hours are the
// same in January and July and can simply be baked in.
//
// The interior half of the palette (hemi/key/rim) is NOT a dimmer tracking the
// sun. Once the sun is down the room's own fixtures are on, so `hemiIntensity`
// and `keyIntensity` come back UP through the evening rather than following the
// sky into the dark — the earlier table let them sag to ~0.7/0.85 from golden
// hour onward and the room went murky exactly when the event is busiest.
// `hemiGround` carries most of it: it is the bounce off the carpet, and lifting
// it out of near-black is what stops the floor and the fronts of the desks
// reading as silhouettes. The small hours stay below midday so the day still
// has a peak; the city outside is untouched and goes fully dark as before.
//
// Keep neighbouring keyframes at least 45 minutes apart. Interpolation is
// linear, so the per-minute step is (difference / span); the continuity test
// allows 8/255 per channel per minute, which a full-range swing needs 32-odd
// minutes to stay under. Adding a tight keyframe pair is how you break it.
const KEYFRAMES: Keyframe[] = [
  {
    minute: 0, // deep night — the colour the void used to be
    hazeTop: 0x101a30,
    horizonGlow: 0x1a2440, glowStrength: 0.1,
    cityFar: 0x151d33, cityMid: 0x101728, cityNear: 0x080d18,
    // Half the offices have gone home by midnight, so the towers are dimmer
    // than they were at 20:45 and the sky glow above them drops with it.
    windowLights: 0.7,
    haze: 0x05070f,
    hemiSky: 0xd8c8b0, hemiGround: 0x403e4a, hemiIntensity: 0.95,
    keyColor: 0xffe2b8, keyIntensity: 1.05,
    rimColor: 0x4060ff, rimIntensity: 0.55,
  },
  {
    minute: 285, // 04:45 — the dead of night, fewest lights of the whole day
    hazeTop: 0x101a30,
    horizonGlow: 0x1a2440, glowStrength: 0.1,
    cityFar: 0x151d33, cityMid: 0x101728, cityNear: 0x080d18,
    windowLights: 0.62,
    haze: 0x05070f,
    hemiSky: 0xd8c8b0, hemiGround: 0x3c3a46, hemiIntensity: 0.92,
    keyColor: 0xffe2b8, keyIntensity: 1,
    rimColor: 0x4060ff, rimIntensity: 0.55,
  },
  {
    minute: 375, // 06:15 — blue hour before the sun
    hazeTop: 0x5a6a92,
    horizonGlow: 0x9a7a72, glowStrength: 0.45,
    cityFar: 0x36415c, cityMid: 0x28304a, cityNear: 0x161c2e,
    windowLights: 0.85,
    haze: 0x1b2a52,
    hemiSky: 0xc4bcae, hemiGround: 0x2e2e33, hemiIntensity: 0.72,
    keyColor: 0xf2ddbc, keyIntensity: 0.85,
    rimColor: 0x4060ff, rimIntensity: 0.45,
  },
  {
    minute: 420, // 07:00 — sunrise
    hazeTop: 0xe0a878,
    horizonGlow: 0xffb070, glowStrength: 0.95,
    cityFar: 0x6d7d9a, cityMid: 0x4a5570, cityNear: 0x2a3048,
    windowLights: 0.45,
    haze: 0x6f86ab,
    hemiSky: 0x9fb4d8, hemiGround: 0x4a423c, hemiIntensity: 0.7,
    keyColor: 0xffcb96, keyIntensity: 1,
    rimColor: 0x5070d0, rimIntensity: 0.35,
  },
  {
    minute: 480, // 08:00 — morning
    hazeTop: 0xb8d4ee,
    horizonGlow: 0xd8c8a8, glowStrength: 0.3,
    cityFar: 0x93a8c2, cityMid: 0x6a7d99, cityNear: 0x44536c,
    windowLights: 0.1,
    haze: 0x9dbcdc,
    hemiSky: 0x8fb0d8, hemiGround: 0x3a3d42, hemiIntensity: 0.9,
    keyColor: 0xfff2dd, keyIntensity: 1.15,
    rimColor: 0x4060ff, rimIntensity: 0.4,
  },
  {
    minute: 660, // 11:00 — full day
    hazeTop: 0xc4dcf2,
    horizonGlow: 0xdde8f4, glowStrength: 0.08,
    cityFar: 0xa8bcd2, cityMid: 0x7d90ab, cityNear: 0x53627c,
    windowLights: 0,
    haze: 0xaecbe6,
    hemiSky: 0x9fc0e4, hemiGround: 0x42454a, hemiIntensity: 1,
    keyColor: 0xfffaf0, keyIntensity: 1.35,
    rimColor: 0x5878e0, rimIntensity: 0.35,
  },
  {
    minute: 900, // 15:00 — afternoon, barely moved; keeps the day flat
    hazeTop: 0xcadff2,
    horizonGlow: 0xe0e4ec, glowStrength: 0.1,
    cityFar: 0xa6b9cf, cityMid: 0x7b8ea9, cityNear: 0x52607a,
    windowLights: 0,
    haze: 0xafc9e2,
    hemiSky: 0x9fbee0, hemiGround: 0x44454a, hemiIntensity: 0.98,
    keyColor: 0xfff6e4, keyIntensity: 1.3,
    rimColor: 0x5878e0, rimIntensity: 0.35,
  },
  {
    minute: 1050, // 17:30 — late afternoon warming up
    hazeTop: 0xe8d0b0,
    horizonGlow: 0xffcf90, glowStrength: 0.4,
    cityFar: 0x9fb0c6, cityMid: 0x74869f, cityNear: 0x4c5a72,
    windowLights: 0.12,
    haze: 0xb0c4d8,
    hemiSky: 0x9db8d8, hemiGround: 0x46423c, hemiIntensity: 0.92,
    keyColor: 0xffe8c0, keyIntensity: 1.25,
    rimColor: 0x5878e0, rimIntensity: 0.35,
  },
  {
    minute: 1125, // 18:45 — golden hour, the sun on the horizon
    hazeTop: 0xf08a52,
    horizonGlow: 0xff7a3c, glowStrength: 1,
    cityFar: 0x7a6f88, cityMid: 0x50485e, cityNear: 0x2c2838,
    windowLights: 0.55,
    haze: 0x8a6a80,
    hemiSky: 0xb9a2ac, hemiGround: 0x5c4a40, hemiIntensity: 1,
    keyColor: 0xffa860, keyIntensity: 1.2,
    rimColor: 0x6050c0, rimIntensity: 0.45,
  },
  {
    minute: 1170, // 19:30 — dusk, the blue hour after sunset
    hazeTop: 0x6a4a68,
    horizonGlow: 0xc06848, glowStrength: 0.6,
    cityFar: 0x3c3d55, cityMid: 0x282a3e, cityNear: 0x151626,
    windowLights: 0.95,
    haze: 0x2a2f4e,
    hemiSky: 0xcabcae, hemiGround: 0x484450, hemiIntensity: 1.12,
    keyColor: 0xf8ddb4, keyIntensity: 1.2,
    rimColor: 0x4a5ad0, rimIntensity: 0.5,
  },
  {
    // 20:45 — night, but the working city is still up: brightest windows of
    // the day. From here the table wraps back to minute 0, dimming through
    // the small hours.
    minute: 1245,
    hazeTop: 0x18243e,
    horizonGlow: 0x243050, glowStrength: 0.14,
    cityFar: 0x1a2440, cityMid: 0x141d32, cityNear: 0x0a101f,
    windowLights: 1,
    haze: 0x05070f,
    hemiSky: 0xd8c8b0, hemiGround: 0x444250, hemiIntensity: 1.1,
    keyColor: 0xffe2b8, keyIntensity: 1.18,
    rimColor: 0x4060ff, rimIntensity: 0.55,
  },
]

const COLOR_KEYS = [
  "hazeTop", "horizonGlow",
  "cityFar", "cityMid", "cityNear", "haze",
  "hemiSky", "hemiGround", "keyColor", "rimColor",
] as const

const SCALAR_KEYS = [
  "glowStrength", "windowLights",
  "hemiIntensity", "keyIntensity", "rimIntensity",
] as const

/** Mix two packed 0xRRGGBB colours channel by channel. */
function mixColor(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 0xff) + (((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t)
  const g = Math.round(((a >> 8) & 0xff) + (((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t)
  const bl = Math.round((a & 0xff) + ((b & 0xff) - (a & 0xff)) * t)
  return (r << 16) | (g << 8) | bl
}

/**
 * Minutes since midnight in Singapore.
 *
 * Pinned to the venue's clock, not the viewer's: a judge watching from London
 * should see the room as it looks in the hall, and API reference §5 already
 * requires SGT for everything user-facing.
 */
export function sgtMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SGT, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now)
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  // Intl renders midnight as "24" in some engines and "00" in others.
  return (value("hour") % 24) * 60 + value("minute")
}

/** The sky and lighting at a given minute of the Singapore day. */
export function skyPalette(minute: number): SkyPalette {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  // Find the pair straddling `m`. Past the last keyframe we wrap to the first,
  // whose minute is 0 — read as 1440 for the span so the evening eases into
  // midnight instead of holding on the last entry until the clock rolls over.
  let i = KEYFRAMES.length - 1
  for (let k = 0; k < KEYFRAMES.length; k++) if (KEYFRAMES[k]!.minute <= m) i = k
  const from = KEYFRAMES[i]!
  const wrapped = i === KEYFRAMES.length - 1
  const to = wrapped ? KEYFRAMES[0]! : KEYFRAMES[i + 1]!
  const span = (wrapped ? MINUTES_PER_DAY : to.minute) - from.minute
  const t = span <= 0 ? 0 : (m - from.minute) / span

  const out = {} as SkyPalette
  for (const k of COLOR_KEYS) out[k] = mixColor(from[k], to[k], t)
  for (const k of SCALAR_KEYS) out[k] = from[k] + (to[k] - from[k]) * t
  return out
}

/**
 * Named times worth jumping straight to. The room otherwise follows the real
 * clock, which is right for the event and useless for a 2pm rehearsal, a
 * screenshot, or checking that dusk actually looks like dusk.
 */
const NAMED_TIMES: Record<string, number> = {
  midnight: 0,
  night: 2 * 60,
  dawn: 6 * 60 + 45,
  sunrise: 7 * 60,
  morning: 9 * 60,
  noon: 12 * 60,
  day: 13 * 60,
  golden: 18 * 60 + 45,
  sunset: 19 * 60 + 10,
  dusk: 19 * 60,
}

/**
 * Reads `?tod=` off a query string: either a name from the table above or a
 * plain `HH:MM`. Anything unrecognised returns null rather than throwing or
 * guessing, so a typo quietly leaves the room on the real Singapore clock.
 */
export function parseTimeOverride(search: string): number | null {
  const raw = new URLSearchParams(search).get("tod")?.trim().toLowerCase()
  if (!raw) return null
  const named = NAMED_TIMES[raw]
  if (named !== undefined) return named
  const clock = /^(\d{1,2}):(\d{2})$/.exec(raw)
  if (!clock) return null
  const h = Number(clock[1])
  const min = Number(clock[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

// ------------------------------------------------------------ forced night

/**
 * The minute the winners' ceremony turns the sky to: 20:45, the night
 * keyframe with the city's windows at their brightest. Fireworks want a dark
 * sky, but not the dead-of-night one with half the towers gone home.
 */
export const NIGHT_SHOW_MINUTE = 20 * 60 + 45

/**
 * Is it already dark outside at this minute? Dusk's blue hour (19:30) to the
 * blue hour before sunrise (06:15) — the span where the palette has the
 * windows lit and the haze down to night.
 */
export function isNightMinute(minute: number): boolean {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return m >= 19 * 60 + 30 || m < 6 * 60 + 15
}

/**
 * How far towards the forced night the room should be: all the way while a
 * ceremony runs by daylight, and not at all otherwise — a room that is
 * already dark is left on its own clock rather than nudged to a different
 * night, so the sky does not visibly shift for nothing.
 */
export function nightBlendTarget(minute: number, ceremonyRunning: boolean): 0 | 1 {
  return ceremonyRunning && !isNightMinute(minute) ? 1 : 0
}

/** The palette `t` of the way from `a` to `b`, every channel and scalar. */
export function mixPalette(a: SkyPalette, b: SkyPalette, t: number): SkyPalette {
  if (t <= 0) return a
  if (t >= 1) return b
  const out = {} as SkyPalette
  for (const k of COLOR_KEYS) out[k] = mixColor(a[k], b[k], t)
  for (const k of SCALAR_KEYS) out[k] = a[k] + (b[k] - a[k]) * t
  return out
}

/**
 * How much of the remaining distance to the night (or back) survives one
 * second. The room takes a few seconds to fall dark: a cut would read as a
 * glitch, and the ceremony has a moment to spare while the camera turns.
 */
export const NIGHT_BLEND_KEEP_PER_SECOND = 0.35

/** One frame of the fade, `dt` seconds long. */
export function advanceNightBlend(current: number, target: number, dt: number): number {
  if (dt <= 0) return current
  const next = target + (current - target) * Math.pow(NIGHT_BLEND_KEEP_PER_SECOND, dt)
  return Math.abs(next - target) < 1e-3 ? target : next
}
