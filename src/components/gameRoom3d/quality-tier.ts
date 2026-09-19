// How much rendering the game room is allowed to spend on this device.
//
// The room is an HD-2D diorama: twenty dynamic point lights, a 2048² shadow
// map, and a post chain (render → output → grade) that all run
// at the device pixel ratio. That is a fine bill on a desktop GPU and an
// unpayable one on a phone or an integrated laptop chip, so the scene reads
// its cost ceiling from here instead of hard-coding it.
//
// Everything in this file is pure — the scene calls `detectQualitySignals`
// once at build time and hands the result in, which keeps the tier decision
// testable without a WebGL context.

export type QualityTier = "ultra" | "high" | "medium" | "low"

/** Most expensive first — `nextTierDown` walks this order. */
const QUALITY_TIERS: readonly QualityTier[] = ["ultra", "high", "medium", "low"]

/** What the room actually switches on or off at a given tier. */
export interface QualitySettings {
  tier: QualityTier
  /**
   * Multiplier on the device pixel ratio. Above 1 this is supersampling —
   * rendering more pixels than the screen has and letting the downscale do
   * the antialiasing. It is the one knob that keeps improving after every
   * effect is already on, and the reason `ultra` exists.
   */
  renderScale: number
  /** Ceiling on the resulting pixel ratio — fill rate is the dominant cost. */
  maxPixelRatio: number
  /** The vignette-and-grain ShaderPass. Off, there is no EffectComposer at
   * all and the room draws straight to the canvas. */
  grade: boolean
  /** Real shadow mapping. The room already draws blob/contact decals, so
   * turning this off costs much less than it sounds. */
  shadows: boolean
  shadowMapSize: number
  /** PCFSoftShadowMap instead of PCFShadowMap — a wider, more expensive tap
   * pattern that softens the shadow edge. */
  softShadows: boolean
  /** Warm ceiling pools per desk row — the room has four columns of desks,
   * so 4 is one light each and 1 merges the row into a single pool. */
  deskLightsPerRow: number
  /** The blue point light spilling off the countdown screen. */
  screenGlowLight: boolean
  /** Lambert furniture instead of Standard — no metalness/roughness maths. */
  cheapFurniture: boolean
  /** Resolution multiplier for the generated lit-window layers of the city
   * backdrop. Building those is a synchronous main-thread canvas scan over
   * millions of pixels, and it is the room's biggest load-time stall. */
  backdropLightsScale: number
}

const SETTINGS: Record<QualityTier, QualitySettings> = {
  // Everything `high` has, rendered at half again the screen's resolution and
  // resolved back down, with a larger and softer shadow map. There is nothing
  // switched on here that `high` switches off — ultra is the same room drawn
  // more carefully, which is why auto-detection never picks it: 2.25× the
  // fragments is a bill only a person should agree to.
  ultra: {
    tier: "ultra",
    renderScale: 1.5,
    maxPixelRatio: 3,
    grade: true,
    shadows: true,
    shadowMapSize: 4096,
    softShadows: true,
    deskLightsPerRow: 4,
    screenGlowLight: true,
    cheapFurniture: false,
    backdropLightsScale: 1,
  },
  high: {
    tier: "high",
    renderScale: 1,
    maxPixelRatio: 2,
    grade: true,
    shadows: true,
    shadowMapSize: 2048,
    softShadows: false,
    deskLightsPerRow: 4,
    screenGlowLight: true,
    cheapFurniture: false,
    backdropLightsScale: 1,
  },
  medium: {
    tier: "medium",
    renderScale: 1,
    maxPixelRatio: 1.5,
    grade: true,
    shadows: true,
    shadowMapSize: 1024,
    softShadows: false,
    deskLightsPerRow: 2,
    screenGlowLight: true,
    cheapFurniture: false,
    backdropLightsScale: 0.75,
  },
  low: {
    tier: "low",
    renderScale: 1,
    maxPixelRatio: 1,
    grade: false,
    shadows: false,
    shadowMapSize: 512,
    softShadows: false,
    // Two rather than one: a single pool per row lights the floor flat, and
    // the pools are most of what stops the room reading as a grey office.
    // These four extra lights land on Lambert surfaces at a quarter of the
    // pixels, which is a fraction of what they cost on the top tier.
    deskLightsPerRow: 2,
    screenGlowLight: false,
    cheapFurniture: true,
    backdropLightsScale: 0.5,
  },
}

export function qualitySettings(tier: QualityTier): QualitySettings {
  return SETTINGS[tier]
}

/** One step cheaper, or null if already at the bottom. */
export function nextTierDown(tier: QualityTier): QualityTier | null {
  const at = QUALITY_TIERS.indexOf(tier)
  return QUALITY_TIERS[at + 1] ?? null
}

export interface QualitySignals {
  /** navigator.hardwareConcurrency — absent on iOS Safari. */
  cores?: number
  /** navigator.deviceMemory in GB — Chromium only; absent elsewhere. */
  memoryGb?: number
  /** SwiftShader/llvmpipe — no GPU at all behind the context. */
  softwareRenderer?: boolean
}

/**
 * Pick a starting tier from what the browser will admit to.
 *
 * Deliberately conservative in one direction only: an unknown signal is not
 * held against the device (Safari reports neither `deviceMemory` nor, on iOS,
 * `hardwareConcurrency`, and treating "unknown" as "weak" would put every Mac
 * on the medium tier). Getting it wrong upward is caught by the frame-budget
 * watcher below, which drops a tier when the room actually runs slowly;
 * getting it wrong downward is only fixable by hand, so it is the worse miss.
 *
 * Being touch-first is NOT a signal. It used to be — phones were capped at
 * medium and, with no core count to clear the bar, every iPhone and iPad
 * landed on low. That was the same "unknown means weak" mistake in a
 * different coat: iOS Safari reports no `hardwareConcurrency`, no
 * `deviceMemory`, and masks its renderer string to a flat "Apple GPU", so
 * there is no signal that separates a five-year-old phone from this year's.
 * Since one of them can plainly render this room and the other cannot, the
 * only honest way to tell them apart is to draw some frames and look — which
 * is precisely what the frame-budget watcher does. A phone that cannot cope
 * gives up a tier within a few seconds; one that can keeps the good room it
 * was always capable of.
 *
 * The pixel-ratio cap is what makes that affordable: `high` renders a DPR-3
 * phone screen at 2, so the fill rate is well under what the panel implies.
 *
 * Tops out at `high`. `ultra` supersamples, and choosing to render 2.25× the
 * pixels a screen has is a decision to spend, not a capability to detect — it
 * is only ever reached by someone picking it in OPTIONS.
 */
export function resolveQualityTier(signals: QualitySignals): QualityTier {
  if (signals.softwareRenderer) return "low"
  const cores = signals.cores
  const memory = signals.memoryGb

  if ((cores !== undefined && cores <= 2) || (memory !== undefined && memory <= 2)) return "low"
  if ((cores !== undefined && cores <= 4) || (memory !== undefined && memory <= 4)) return "medium"
  return "high"
}

/** `?quality=low` on the game-room URL, for pinning a tier by hand. */
export function parseQualityOverride(search: string): QualityTier | null {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
    .get("quality")
    ?.toLowerCase()
  return QUALITY_TIERS.find((tier) => tier === value) ?? null
}

/**
 * Watch frame times and say when the room should give up a tier.
 *
 * Median rather than mean, over a window rather than per frame: a single
 * 200 ms hitch is a texture upload or a GC pause, not a device that cannot
 * keep up, and reacting to it would demote a machine that is fine. The first
 * `graceMs` is skipped outright — the opening seconds are shader compiles.
 *
 * Downgrade only, never upgrade. A watcher that could climb back would sit on
 * the boundary flipping the post chain on and off, which is far more visible
 * than simply running one tier below the best the device could manage.
 */
export interface FrameBudgetWatcher {
  /** Feed one frame's duration in ms; true means "drop a tier now". */
  sample(frameMs: number): boolean
}

export interface FrameBudgetOptions {
  /** Frame time the room is expected to hold. 22 ms ≈ 45 fps. */
  budgetMs?: number
  /** How much history the median is taken over. */
  windowMs?: number
  /** Startup time ignored entirely (shader compiles, texture uploads). */
  graceMs?: number
  /**
   * Multiple of the fastest frame ever seen that still counts as healthy.
   * Frames cannot arrive faster than the display refreshes, so on a panel
   * capped at 30 Hz every frame is 33 ms however idle the GPU is — measuring
   * that against a fixed 22 ms budget would demote a machine that is not
   * working hard at all.
   */
  refreshHeadroom?: number
  /** Ceiling on the inferred budget, so a device that has never once managed
   * a fast frame cannot excuse itself out of ever being demoted. */
  maxBudgetMs?: number
}

export function createFrameBudgetWatcher(options: FrameBudgetOptions = {}): FrameBudgetWatcher {
  const budgetMs = options.budgetMs ?? 22
  const windowMs = options.windowMs ?? 2000
  const graceMs = options.graceMs ?? 3000
  const refreshHeadroom = options.refreshHeadroom ?? 1.5
  const maxBudgetMs = options.maxBudgetMs ?? 40

  let elapsed = 0
  let fastestMs = Number.POSITIVE_INFINITY
  const window: number[] = []
  let windowMsHeld = 0

  return {
    sample(frameMs: number): boolean {
      // A tab that was backgrounded reports one enormous frame on return;
      // it says nothing about the GPU, so it is not history worth keeping.
      if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) return false
      elapsed += frameMs
      // The fastest frame is the display's period, and it is worth learning
      // from the grace period too — a compile stutter can only push the
      // maximum around, never the minimum.
      fastestMs = Math.min(fastestMs, frameMs)
      if (elapsed < graceMs) return false

      window.push(frameMs)
      windowMsHeld += frameMs
      // Drop the oldest frame only while the window would still cover
      // `windowMs` without it. Trimming to strictly under the target instead
      // would leave the window permanently one frame short of full, and the
      // watcher could never fire at all.
      while (window.length > 1 && windowMsHeld - window[0]! >= windowMs) {
        windowMsHeld -= window.shift()!
      }
      if (windowMsHeld < windowMs) return false

      const effectiveBudget = Math.min(
        maxBudgetMs,
        Math.max(budgetMs, fastestMs * refreshHeadroom),
      )
      const sorted = [...window].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]!
      if (median <= effectiveBudget) return false

      // Fired: start the next window from empty so the tier that was just
      // dropped gets a full window to prove itself before dropping again.
      window.length = 0
      windowMsHeld = 0
      return true
    },
  }
}

/**
 * Where the warm ceiling pools go when there are fewer of them than desk
 * columns. Contiguous columns are merged into one pool at their mean, and the
 * survivor is widened and brightened to cover the ground the merged lights
 * used to. At `perRow === colCenters.length` this returns the columns exactly
 * as given — the top tier has to be pixel-identical to the hand-placed rig.
 */
export interface DeskLight {
  /** Column centre in room-plan px, the same space `colCenters` is in. */
  x: number
  distance: number
  intensity: number
}

export const DESK_LIGHT_DISTANCE = 24
export const DESK_LIGHT_INTENSITY = 55

export function deskLightPlan(
  colCenters: readonly number[],
  perRow: number,
): DeskLight[] {
  const columns = colCenters.length
  const wanted = Math.max(0, Math.min(columns, Math.floor(perRow)))
  if (wanted === 0) return []

  const lights: DeskLight[] = []
  let taken = 0
  for (let group = 0; group < wanted; group++) {
    // Spread the remainder over the leading groups rather than the trailing
    // one, so 4 columns into 3 pools reads 2-1-1 and stays centred.
    const size = Math.ceil((columns - taken) / (wanted - group))
    const slice = colCenters.slice(taken, taken + size)
    taken += size
    lights.push({
      x: slice.reduce((sum, x) => sum + x, 0) / slice.length,
      // Radius grows with the square root of the merge: the pool has to reach
      // further, but a linear widening washes the whole row out flat.
      distance: DESK_LIGHT_DISTANCE * Math.sqrt(size),
      intensity: DESK_LIGHT_INTENSITY * size,
    })
  }
  return lights
}

/** Read the tier signals off a live browser. Safe to call anywhere; every
 * field is optional precisely because half of them are not universal. */
export function detectQualitySignals(): QualitySignals {
  if (typeof navigator === "undefined") return {}
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    cores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    softwareRenderer: detectSoftwareRenderer(),
  }
}

/**
 * Is there actually a GPU behind the context? A headless CI box, a VM, or a
 * machine whose driver has been blocklisted falls back to SwiftShader or
 * llvmpipe, which will render this room at single-digit frame rates.
 *
 * The probe context is created and released here rather than reusing the
 * scene's: the tier has to be known before the renderer is built.
 */
function detectSoftwareRenderer(): boolean | undefined {
  if (typeof document === "undefined") return undefined
  try {
    const canvas = document.createElement("canvas")
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl")
    if (!gl) return true
    const info = gl.getExtension("WEBGL_debug_renderer_info")
    const renderer = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER))
    gl.getExtension("WEBGL_lose_context")?.loseContext()
    return /swiftshader|llvmpipe|software|basic render/i.test(renderer)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------- preference

/**
 * What the player chose in OPTIONS → GRAPHICS. `"auto"` is the default and
 * hands the decision back to `resolveQualityTier` plus the frame-budget
 * watcher; anything else is a pin, and a pin is never overridden — a setting
 * that quietly moved itself would read as a broken setting, not a clever one.
 */
export type GraphicsPreference = "auto" | QualityTier

/** Menu order: the automatic choice first, then cheapest to most expensive. */
export const GRAPHICS_PREFERENCES: readonly GraphicsPreference[] = [
  "auto",
  "low",
  "medium",
  "high",
  "ultra",
]

export const GRAPHICS_PREFERENCE_KEY = "codetoimpact.graphics-preference"

const GRAPHICS_LABELS: Record<GraphicsPreference, string> = {
  auto: "AUTO",
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  ultra: "ULTRA",
}

const GRAPHICS_HINTS: Record<GraphicsPreference, string> = {
  auto: "Match this device · drops effects if frames slip",
  low: "Flat lighting · no post FX · fastest",
  medium: "Soft focus · fewer lights · half resolution",
  high: "Full lighting · tilt-shift",
  ultra: "High plus supersampling · soft shadows · heaviest",
}

export function graphicsPreferenceLabel(preference: GraphicsPreference): string {
  return GRAPHICS_LABELS[preference]
}

/** The one-line description shown under the setting in the menu. */
export function graphicsPreferenceHint(preference: GraphicsPreference): string {
  return GRAPHICS_HINTS[preference]
}

function isGraphicsPreference(value: unknown): value is GraphicsPreference {
  return GRAPHICS_PREFERENCES.some((preference) => preference === value)
}

/** Step through the list, wrapping at both ends so ◀ and ▶ always do something. */
export function cycleGraphicsPreference(
  preference: GraphicsPreference,
  direction: 1 | -1,
): GraphicsPreference {
  const at = GRAPHICS_PREFERENCES.indexOf(preference)
  const count = GRAPHICS_PREFERENCES.length
  // `at` is -1 for a value that is not in the list, and (-1 + 1) % 5 lands on
  // "auto" — the right place to recover to.
  return GRAPHICS_PREFERENCES[(at + direction + count) % count]!
}

export function loadGraphicsPreference(): GraphicsPreference {
  if (typeof window === "undefined") return "auto"
  try {
    const stored = window.localStorage.getItem(GRAPHICS_PREFERENCE_KEY)
    return isGraphicsPreference(stored) ? stored : "auto"
  } catch {
    // Private browsing and locked-down profiles throw on access rather than
    // returning null. Rendering the room matters more than remembering how.
    return "auto"
  }
}

export function saveGraphicsPreference(preference: GraphicsPreference): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(GRAPHICS_PREFERENCE_KEY, preference)
  } catch {
    /* see loadGraphicsPreference */
  }
}

/** The stored pin, or null when the player left it on AUTO. */
export function pinnedGraphicsTier(): QualityTier | null {
  const preference = loadGraphicsPreference()
  return preference === "auto" ? null : preference
}
