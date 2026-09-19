// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import {
  createFrameBudgetWatcher,
  cycleGraphicsPreference,
  GRAPHICS_PREFERENCE_KEY,
  GRAPHICS_PREFERENCES,
  graphicsPreferenceHint,
  graphicsPreferenceLabel,
  loadGraphicsPreference,
  pinnedGraphicsTier,
  saveGraphicsPreference,
  deskLightPlan,
  DESK_LIGHT_DISTANCE,
  DESK_LIGHT_INTENSITY,
  nextTierDown,
  parseQualityOverride,
  qualitySettings,
  resolveQualityTier,
} from "./quality-tier"

describe("resolveQualityTier", () => {
  it("gives a desktop with cores and memory to spare the full room", () => {
    expect(resolveQualityTier({ cores: 12, memoryGb: 16 })).toBe("high")
  })

  it("does not punish a browser that hides deviceMemory", () => {
    // Safari and Firefox report no deviceMemory at all; reading that as a
    // weak device would put every Mac on the medium tier.
    expect(resolveQualityTier({ cores: 8 })).toBe("high")
  })

  it("steps down for a modest laptop", () => {
    expect(resolveQualityTier({ cores: 4, memoryGb: 8 })).toBe("medium")
    expect(resolveQualityTier({ cores: 8, memoryGb: 4 })).toBe("medium")
  })

  it("bottoms out on a genuinely small machine", () => {
    expect(resolveQualityTier({ cores: 2, memoryGb: 4 })).toBe("low")
    expect(resolveQualityTier({ cores: 8, memoryGb: 2 })).toBe("low")
  })

  it("treats a software renderer as the floor whatever the CPU says", () => {
    expect(resolveQualityTier({ cores: 32, memoryGb: 64, softwareRenderer: true })).toBe("low")
  })

  it("gives an iPhone the good room rather than assuming the worst", () => {
    // iOS Safari reports no core count, no memory, and a masked renderer
    // string, so an iPhone arrives looking exactly like a bare browser. There
    // is no signal separating a current phone from a five-year-old one, so
    // the room starts good and the frame-budget watcher takes it away from
    // the phones that cannot hold it.
    expect(resolveQualityTier({})).toBe("high")
  })

  it("still catches a weak phone that does report its hardware", () => {
    // Chrome on Android reports both, so a cheap handset is judged on what it
    // says rather than on being a phone.
    expect(resolveQualityTier({ cores: 8, memoryGb: 4 })).toBe("medium")
    expect(resolveQualityTier({ cores: 4, memoryGb: 2 })).toBe("low")
  })

  it("knows nothing about a bare browser and assumes the best", () => {
    expect(resolveQualityTier({})).toBe("high")
  })
})

describe("qualitySettings", () => {
  it("keeps the high tier at what the room shipped with", () => {
    const high = qualitySettings("high")
    expect(high.renderScale).toBe(1)
    expect(high.maxPixelRatio).toBe(2)
    expect(high.shadowMapSize).toBe(2048)
    expect(high.deskLightsPerRow).toBe(4)
  })

  it("gets monotonically cheaper down the tiers", () => {
    const [ultra, high, medium, low] = (["ultra", "high", "medium", "low"] as const).map(qualitySettings)
    for (const [a, b] of [[ultra!, high!], [high!, medium!], [medium!, low!]] as const) {
      expect(a.renderScale).toBeGreaterThanOrEqual(b.renderScale)
      expect(a.maxPixelRatio).toBeGreaterThanOrEqual(b.maxPixelRatio)
      expect(a.shadowMapSize).toBeGreaterThanOrEqual(b.shadowMapSize)
      expect(a.deskLightsPerRow).toBeGreaterThanOrEqual(b.deskLightsPerRow)
      expect(a.backdropLightsScale).toBeGreaterThanOrEqual(b.backdropLightsScale)
    }
  })

  it("drops the whole post chain at the floor", () => {
    // grade false is what lets the scene skip EffectComposer entirely and
    // render straight to the canvas.
    expect(qualitySettings("low").grade).toBe(false)
    expect(qualitySettings("low").shadows).toBe(false)
  })
})

describe("nextTierDown", () => {
  it("walks one step at a time and stops at the floor", () => {
    expect(nextTierDown("ultra")).toBe("high")
    expect(nextTierDown("high")).toBe("medium")
    expect(nextTierDown("medium")).toBe("low")
    expect(nextTierDown("low")).toBeNull()
  })
})

describe("parseQualityOverride", () => {
  it("reads a pinned tier with or without the leading question mark", () => {
    expect(parseQualityOverride("?quality=low")).toBe("low")
    expect(parseQualityOverride("quality=HIGH")).toBe("high")
    expect(parseQualityOverride("?foo=1&quality=medium")).toBe("medium")
    expect(parseQualityOverride("?quality=ultra")).toBe("ultra")
  })

  it("ignores anything that is not a tier", () => {
    expect(parseQualityOverride("?quality=auto")).toBeNull()
    expect(parseQualityOverride("?quality=maximum")).toBeNull()
    expect(parseQualityOverride("?other=low")).toBeNull()
    expect(parseQualityOverride("")).toBeNull()
  })
})

describe("ultra", () => {
  it("supersamples rather than switching anything extra on", () => {
    const ultra = qualitySettings("ultra")
    const high = qualitySettings("high")
    expect(ultra.renderScale).toBeGreaterThan(1)
    expect(ultra.softShadows).toBe(true)
    expect(ultra.shadowMapSize).toBeGreaterThan(high.shadowMapSize)
    // Same room, drawn more carefully — nothing high has is missing here.
    expect(ultra.grade).toBe(high.grade)
    expect(ultra.deskLightsPerRow).toBe(high.deskLightsPerRow)
    expect(ultra.cheapFurniture).toBe(false)
  })

  it("is never chosen for you", () => {
    // Rendering 2.25× the pixels a screen has is a decision to spend, not a
    // capability to detect. The only routes to ultra are OPTIONS and ?quality=.
    const beefy = [
      { cores: 32, memoryGb: 64 },
      { cores: 16, memoryGb: 32 },
      { cores: 8 },
      {},
    ]
    for (const signals of beefy) expect(resolveQualityTier(signals)).not.toBe("ultra")
  })
})

describe("graphics preference", () => {
  beforeEach(() => {
    window.localStorage.removeItem(GRAPHICS_PREFERENCE_KEY)
  })

  it("offers automatic first, then cheapest to dearest", () => {
    expect(GRAPHICS_PREFERENCES).toEqual(["auto", "low", "medium", "high", "ultra"])
  })

  it("defaults to auto when nothing has been chosen", () => {
    expect(loadGraphicsPreference()).toBe("auto")
    expect(pinnedGraphicsTier()).toBeNull()
  })

  it("round-trips a chosen tier", () => {
    saveGraphicsPreference("ultra")
    expect(loadGraphicsPreference()).toBe("ultra")
    expect(pinnedGraphicsTier()).toBe("ultra")
  })

  it("treats auto as no pin at all, so the scene measures the device", () => {
    saveGraphicsPreference("auto")
    expect(pinnedGraphicsTier()).toBeNull()
  })

  it("falls back to auto rather than trusting a junk stored value", () => {
    window.localStorage.setItem(GRAPHICS_PREFERENCE_KEY, "cinematic")
    expect(loadGraphicsPreference()).toBe("auto")
  })

  it("wraps at both ends so neither arrow is ever a dead key", () => {
    expect(cycleGraphicsPreference("auto", 1)).toBe("low")
    expect(cycleGraphicsPreference("ultra", 1)).toBe("auto")
    expect(cycleGraphicsPreference("auto", -1)).toBe("ultra")
    expect(cycleGraphicsPreference("low", -1)).toBe("auto")
  })

  it("labels and describes every choice", () => {
    for (const preference of GRAPHICS_PREFERENCES) {
      expect(graphicsPreferenceLabel(preference)).toMatch(/^[A-Z]+$/)
      expect(graphicsPreferenceHint(preference).length).toBeGreaterThan(0)
    }
  })
})

describe("deskLightPlan", () => {
  const columns = [122, 307, 492, 677]

  it("leaves the hand-placed rig alone when nothing is being merged", () => {
    expect(deskLightPlan(columns, 4)).toEqual(
      columns.map((x) => ({ x, distance: DESK_LIGHT_DISTANCE, intensity: DESK_LIGHT_INTENSITY })),
    )
  })

  it("merges columns in pairs and widens what is left", () => {
    const plan = deskLightPlan(columns, 2)
    expect(plan.map((light) => light.x)).toEqual([214.5, 584.5])
    expect(plan[0]!.distance).toBeCloseTo(DESK_LIGHT_DISTANCE * Math.SQRT2)
    expect(plan[0]!.intensity).toBe(DESK_LIGHT_INTENSITY * 2)
  })

  it("collapses the row to one centred pool", () => {
    const plan = deskLightPlan(columns, 1)
    expect(plan).toHaveLength(1)
    expect(plan[0]!.x).toBe((122 + 307 + 492 + 677) / 4)
    expect(plan[0]!.intensity).toBe(DESK_LIGHT_INTENSITY * 4)
  })

  it("keeps an uneven split centred by loading the leading pools", () => {
    // 4 columns into 3 pools is 2-1-1, not 1-1-2: the merged pair sits at the
    // west end where the row starts rather than hanging off the east edge.
    const plan = deskLightPlan(columns, 3)
    expect(plan.map((light) => light.x)).toEqual([214.5, 492, 677])
  })

  it("never asks for more pools than there are columns", () => {
    expect(deskLightPlan(columns, 9)).toHaveLength(4)
    expect(deskLightPlan(columns, 0)).toEqual([])
  })
})

describe("createFrameBudgetWatcher", () => {
  const feed = (watcher: { sample(ms: number): boolean }, frameMs: number, count: number) => {
    let fired = 0
    for (let i = 0; i < count; i++) if (watcher.sample(frameMs)) fired++
    return fired
  }

  it("stays quiet while the room holds its budget", () => {
    const watcher = createFrameBudgetWatcher()
    expect(feed(watcher, 16, 2000)).toBe(0)
  })

  it("ignores the opening seconds, where the shaders compile", () => {
    const watcher = createFrameBudgetWatcher({ graceMs: 3000, windowMs: 2000 })
    // 2.5s of dreadful frames, all inside the grace period.
    expect(feed(watcher, 50, 50)).toBe(0)
  })

  it("drops a tier once a slow window has actually accumulated", () => {
    const watcher = createFrameBudgetWatcher({ budgetMs: 22, windowMs: 2000, graceMs: 1000 })
    feed(watcher, 10, 100) // 1s of grace
    // The window has to fill before it can fire, so the first slow frames pass.
    expect(watcher.sample(40)).toBe(false)
    expect(feed(watcher, 40, 200)).toBeGreaterThan(0)
  })

  it("does not demote a device over one hitch", () => {
    const watcher = createFrameBudgetWatcher({ budgetMs: 22, windowMs: 2000, graceMs: 0 })
    feed(watcher, 16, 200)
    expect(watcher.sample(300)).toBe(false)
    expect(feed(watcher, 16, 200)).toBe(0)
  })

  it("gives the new tier a fresh window before dropping again", () => {
    const watcher = createFrameBudgetWatcher({ budgetMs: 22, windowMs: 2000, graceMs: 0 })
    // Healthy frames first, so the watcher knows this display can do 60 Hz
    // and reads the 40 ms frames that follow as load rather than refresh rate.
    feed(watcher, 16, 200)
    let firstFireAt = -1
    for (let i = 0; i < 400; i++) {
      if (watcher.sample(40)) { firstFireAt = i; break }
    }
    expect(firstFireAt).toBeGreaterThan(0)
    // Immediately after firing the history is empty, so the very next frame
    // cannot fire again however slow it is.
    expect(watcher.sample(40)).toBe(false)
  })

  it("does not demote a display that is simply capped at 30 Hz", () => {
    // Every frame is 33 ms because the panel refreshes 30 times a second,
    // not because the GPU is behind. A fixed 22 ms budget would read these
    // as failure and walk the room all the way down to the bottom tier.
    const watcher = createFrameBudgetWatcher({ budgetMs: 22, windowMs: 2000, graceMs: 500 })
    expect(feed(watcher, 33.3, 600)).toBe(0)
  })

  it("still demotes a device that has never once managed a fast frame", () => {
    // The refresh inference is capped, so 60 ms frames cannot pass themselves
    // off as a very slow display.
    const watcher = createFrameBudgetWatcher({ budgetMs: 22, windowMs: 2000, graceMs: 500 })
    expect(feed(watcher, 60, 200)).toBeGreaterThan(0)
  })

  it("throws away the giant frame a backgrounded tab reports on return", () => {
    const watcher = createFrameBudgetWatcher({ budgetMs: 22, windowMs: 2000, graceMs: 0 })
    expect(watcher.sample(60_000)).toBe(false)
    expect(feed(watcher, 16, 300)).toBe(0)
  })
})
