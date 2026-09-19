import { describe, expect, it } from "vitest"
import {
  advanceNightBlend,
  isNightMinute,
  MINUTES_PER_DAY,
  mixPalette,
  NIGHT_SHOW_MINUTE,
  nightBlendTarget,
  parseTimeOverride,
  sgtMinutes,
  skyPalette,
  type SkyPalette,
} from "./time-of-day"

const at = (iso: string) => sgtMinutes(new Date(iso))

/** How far apart two colours are, as the largest single-channel gap. */
function channelGap(a: number, b: number): number {
  return Math.max(
    Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)),
    Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)),
    Math.abs((a & 0xff) - (b & 0xff)),
  )
}

/** Every colour the palette carries, so a test can sweep all of them at once. */
const COLOUR_KEYS = [
  "hazeTop", "horizonGlow", "cityNear", "cityMid", "cityFar",
  "haze", "hemiSky", "hemiGround", "keyColor", "rimColor",
] as const satisfies ReadonlyArray<keyof SkyPalette>

const SCALAR_KEYS = [
  "glowStrength", "windowLights",
  "hemiIntensity", "keyIntensity", "rimIntensity",
] as const satisfies ReadonlyArray<keyof SkyPalette>

describe("sgtMinutes", () => {
  it("reads the Singapore clock, not the host's", () => {
    // The host running these tests could be in any zone; SGT is UTC+8 and the
    // room is a Singapore venue, so 02:00 UTC must be 10:00 whoever is looking.
    expect(at("2026-08-16T02:00:00Z")).toBe(10 * 60)
    expect(at("2026-08-16T09:30:00Z")).toBe(17 * 60 + 30)
  })

  it("rolls into the next Singapore day for late-UTC instants", () => {
    // 17:00 UTC is already 01:00 tomorrow in Singapore. Getting this wrong
    // shows the room a sunset while the venue is asleep.
    expect(at("2026-08-16T17:00:00Z")).toBe(60)
    expect(at("2026-08-16T16:00:00Z")).toBe(0)
  })

  it("stays inside a single day", () => {
    for (let h = 0; h < 24; h++) {
      const m = at(`2026-08-16T${String(h).padStart(2, "0")}:00:00Z`)
      expect(m).toBeGreaterThanOrEqual(0)
      expect(m).toBeLessThan(MINUTES_PER_DAY)
    }
  })
})

describe("skyPalette", () => {
  it("is defined for every minute of the day", () => {
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      const p = skyPalette(m)
      for (const k of COLOUR_KEYS) {
        expect(Number.isInteger(p[k]), `${k} at ${m}`).toBe(true)
        expect(p[k], `${k} at ${m}`).toBeGreaterThanOrEqual(0)
        expect(p[k], `${k} at ${m}`).toBeLessThanOrEqual(0xffffff)
      }
      for (const k of SCALAR_KEYS) {
        expect(Number.isFinite(p[k]), `${k} at ${m}`).toBe(true)
        expect(p[k], `${k} at ${m}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("never jumps — the sky changes continuously, including across midnight", () => {
    // This is the test that earns its keep. A keyframe table that is out of
    // order, or a wraparound that clamps to the last entry instead of easing
    // back to the first, both show up here as a hard cut and nowhere else:
    // the room would visibly snap at some minute of the day.
    let worstColour = { gap: 0, minute: -1, key: "" }
    let worstScalar = { gap: 0, minute: -1, key: "" }
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      const a = skyPalette(m)
      const b = skyPalette((m + 1) % MINUTES_PER_DAY)
      for (const k of COLOUR_KEYS) {
        const gap = channelGap(a[k], b[k])
        if (gap > worstColour.gap) worstColour = { gap, minute: m, key: k }
      }
      for (const k of SCALAR_KEYS) {
        const gap = Math.abs(a[k] - b[k])
        if (gap > worstScalar.gap) worstScalar = { gap, minute: m, key: k }
      }
    }
    // A minute is at most a few 1/255ths of any channel if the whole day is
    // interpolated; a missed wraparound is a gap of tens or hundreds.
    expect(worstColour.gap, `worst colour step: ${worstColour.key} at minute ${worstColour.minute}`)
      .toBeLessThan(8)
    expect(worstScalar.gap, `worst scalar step: ${worstScalar.key} at minute ${worstScalar.minute}`)
      .toBeLessThan(0.05)
  })

  it("wraps the day around rather than treating minute 0 as a wall", () => {
    // 23:59 and 00:01 sit either side of the seam and are both deep night, so
    // they must look practically identical.
    const before = skyPalette(MINUTES_PER_DAY - 1)
    const after = skyPalette(1)
    for (const k of COLOUR_KEYS) expect(channelGap(before[k], after[k]), k).toBeLessThan(12)
  })

  it("accepts minutes outside the day and folds them back in", () => {
    expect(skyPalette(MINUTES_PER_DAY + 90)).toEqual(skyPalette(90))
    expect(skyPalette(-30)).toEqual(skyPalette(MINUTES_PER_DAY - 30))
  })

  it("lights the city windows at night and puts them out by day", () => {
    expect(skyPalette(2 * 60).windowLights).toBeGreaterThan(0.6)
    expect(skyPalette(22 * 60).windowLights).toBeGreaterThan(0.8)
    expect(skyPalette(13 * 60).windowLights).toBe(0)
  })

  it("dims the towers through the small hours instead of holding them lit", () => {
    // 20:45 is the brightest the city gets; by 04:45 most of it has gone home.
    // The span between those two crosses midnight, so this only holds if the
    // wrap interpolates rather than clamping to the last keyframe — which is
    // exactly the bug the continuity test above cannot see on its own.
    const evening = skyPalette(20 * 60 + 45).windowLights
    const midnight = skyPalette(0).windowLights
    const small = skyPalette(4 * 60 + 45).windowLights
    expect(evening).toBeGreaterThan(midnight)
    expect(midnight).toBeGreaterThan(small)
  })

  it("is brightest at midday and darkest in the small hours", () => {
    const noon = skyPalette(13 * 60)
    const night = skyPalette(3 * 60)
    expect(noon.keyIntensity).toBeGreaterThan(night.keyIntensity)
    expect(noon.hemiIntensity).toBeGreaterThan(night.hemiIntensity)
    const luma = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff)
    expect(luma(noon.haze)).toBeGreaterThan(luma(night.haze))
  })

  it("keeps the room's own lights on after dark", () => {
    // The regression this guards: the interior lighting used to track the sky
    // down, so from golden hour through the night the room dimmed to ~0.7 hemi
    // / 0.85 key and went murky — during the hours the hall is fullest. The
    // fixtures are on after sunset, so the evening must stay at least as lit as
    // a flat afternoon, even though the city outside has gone dark.
    const afternoon = skyPalette(15 * 60)
    for (const m of [18 * 60 + 45, 19 * 60, 19 * 60 + 30, 21 * 60, 23 * 60]) {
      const p = skyPalette(m)
      expect(p.hemiIntensity, `hemi at ${m}`).toBeGreaterThanOrEqual(afternoon.hemiIntensity * 0.95)
      expect(p.keyIntensity, `key at ${m}`).toBeGreaterThanOrEqual(afternoon.keyIntensity * 0.8)
      // Bounce off the floor: near-black here is what silhouettes the desks.
      const groundLuma = ((p.hemiGround >> 16) & 0xff) + ((p.hemiGround >> 8) & 0xff) + (p.hemiGround & 0xff)
      expect(groundLuma, `hemiGround at ${m}`).toBeGreaterThan(0x38 * 3)
    }
  })

  it("warms the horizon at dawn and dusk and not at midday", () => {
    expect(skyPalette(18 * 60 + 45).glowStrength).toBeGreaterThan(0.5)
    expect(skyPalette(6 * 60 + 45).glowStrength).toBeGreaterThan(0.4)
    expect(skyPalette(13 * 60).glowStrength).toBeLessThan(0.15)
  })
})

describe("parseTimeOverride", () => {
  it("reads an explicit clock time", () => {
    expect(parseTimeOverride("?tod=19:30")).toBe(19 * 60 + 30)
    expect(parseTimeOverride("?tod=00:00")).toBe(0)
    expect(parseTimeOverride("?tod=7:05")).toBe(7 * 60 + 5)
  })

  it("reads the named presets used for screenshots and the run of show", () => {
    expect(parseTimeOverride("?tod=night")).toBe(2 * 60)
    expect(parseTimeOverride("?tod=DUSK")).toBe(19 * 60)
    expect(parseTimeOverride("?tod=day")).toBe(13 * 60)
    expect(parseTimeOverride("?tod=dawn")).toBe(6 * 60 + 45)
  })

  it("ignores anything it does not understand, so a typo falls back to the real clock", () => {
    expect(parseTimeOverride("")).toBeNull()
    expect(parseTimeOverride("?foo=1")).toBeNull()
    expect(parseTimeOverride("?tod=")).toBeNull()
    expect(parseTimeOverride("?tod=teatime")).toBeNull()
    expect(parseTimeOverride("?tod=25:00")).toBeNull()
    expect(parseTimeOverride("?tod=12:60")).toBeNull()
    expect(parseTimeOverride("?tod=-1:00")).toBeNull()
  })
})

describe("the forced night for the winners' ceremony", () => {
  it("counts dusk to dawn as night and the working day as not", () => {
    expect(isNightMinute(21 * 60)).toBe(true)
    expect(isNightMinute(0)).toBe(true)
    expect(isNightMinute(5 * 60)).toBe(true)
    expect(isNightMinute(9 * 60)).toBe(false)
    expect(isNightMinute(17 * 60)).toBe(false)
    expect(isNightMinute(MINUTES_PER_DAY + 21 * 60)).toBe(true)
  })

  it("darkens a daytime ceremony and leaves a night-time one alone", () => {
    expect(nightBlendTarget(15 * 60, true)).toBe(1)
    expect(nightBlendTarget(21 * 60, true)).toBe(0)
    expect(nightBlendTarget(15 * 60, false)).toBe(0)
  })

  it("turns the sky to the lit-city night, not the dead of night", () => {
    expect(isNightMinute(NIGHT_SHOW_MINUTE)).toBe(true)
    expect(skyPalette(NIGHT_SHOW_MINUTE).windowLights).toBeGreaterThan(skyPalette(3 * 60).windowLights)
  })

  it("mixes two palettes channel by channel, and is exact at the ends", () => {
    const day = skyPalette(13 * 60)
    const night = skyPalette(NIGHT_SHOW_MINUTE)
    expect(mixPalette(day, night, 0)).toBe(day)
    expect(mixPalette(day, night, 1)).toBe(night)
    const half = mixPalette(day, night, 0.5)
    for (const k of COLOUR_KEYS) {
      expect(channelGap(half[k], day[k]), k).toBeLessThanOrEqual(channelGap(night[k], day[k]) / 2 + 1)
      expect(channelGap(half[k], night[k]), k).toBeLessThanOrEqual(channelGap(night[k], day[k]) / 2 + 1)
    }
    for (const k of SCALAR_KEYS) {
      expect(half[k], k).toBeCloseTo((day[k] + night[k]) / 2, 6)
    }
  })

  it("eases towards the target and settles on it", () => {
    let blend = 0
    for (let i = 0; i < 60; i++) blend = advanceNightBlend(blend, 1, 1 / 60)
    expect(blend).toBeGreaterThan(0.5)
    expect(blend).toBeLessThan(1)
    for (let i = 0; i < 60 * 10; i++) blend = advanceNightBlend(blend, 1, 1 / 60)
    expect(blend).toBe(1)
    for (let i = 0; i < 60 * 10; i++) blend = advanceNightBlend(blend, 0, 1 / 60)
    expect(blend).toBe(0)
    expect(advanceNightBlend(0.4, 1, 0)).toBe(0.4)
  })

  it("fades at the same speed whatever the frame rate", () => {
    let at60 = 0
    for (let i = 0; i < 120; i++) at60 = advanceNightBlend(at60, 1, 1 / 60)
    let at30 = 0
    for (let i = 0; i < 60; i++) at30 = advanceNightBlend(at30, 1, 1 / 30)
    expect(at60).toBeCloseTo(at30, 3)
  })
})
