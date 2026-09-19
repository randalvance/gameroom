// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { createFightRenderer } from "./fight-renderer"
import { createFight, worldHitbox } from "./fight-sim"
import type { EffectImages } from "./sprite-loader"
import { FIGHTER_ATLASES } from "./fighter-atlases"
import { drawSpecialEffects } from "./special-effects"
import { breakingNewsGeometry, circleCenter, circleRadius, scanningBeamBox } from "./special-motion"
import { NEWSROOM_STAGE } from "./battle-stages"

it("keeps the newsroom covering the viewport and stationary as fighters move", () => {
  const drawImage = vi.fn()
  const ctx = new Proxy({ drawImage, measureText: () => ({ width: 100 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  } as unknown as CanvasRenderingContext2D, {
    get: (target, key) => Reflect.get(target, key) ?? (() => {}),
  })
  const canvas = document.createElement("canvas")
  vi.spyOn(canvas, "getContext").mockReturnValue(ctx)
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ width: 960, height: 540 } as DOMRect)
  const renderer = createFightRenderer(canvas)
  const far = new Image()
  const oldFloor = new Image()
  renderer.setStage({ far, floor: oldFloor }, NEWSROOM_STAGE)
  const state = createFight("bull", "bernard", { bossSlot: 1 })
  renderer.render(state, 0, ["1P", "CPU"])
  const first = drawImage.mock.calls.find(call => call[0] === far)!
  const [, x, y, w, h] = first
  // The stage art must cover the frame even after aligning the foot baseline.
  expect(x).toBeLessThanOrEqual(0)
  expect(y).toBeLessThanOrEqual(0)
  expect(x + w).toBeGreaterThanOrEqual(960)
  expect(y + h).toBeGreaterThanOrEqual(540)
  expect(drawImage.mock.calls.some(call => call[0] === oldFloor)).toBe(false)
  state.fighters[0].x = 60
  state.fighters[1].x = 240
  drawImage.mockClear()
  renderer.render(state, 100, ["1P", "CPU"])
  expect(drawImage.mock.calls.find(call => call[0] === far)).toEqual(first)
  renderer.dispose()
})

function effectHarness() {
  const calls = { fillRect: vi.fn(), arc: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), rect: vi.fn() }
  const ctx = new Proxy(calls as unknown as CanvasRenderingContext2D, {
    get: (target, key) => Reflect.get(target, key) ?? (() => {}),
  })
  const state = createFight("bernard", "bull")
  state.phase = "fight"
  const fighter = state.fighters[0]
  fighter.state = "attack"
  fighter.special = { originX: fighter.x, targetX: fighter.x + 280, targetLocked: true, landed: false }
  const draw = (layer: "back" | "front" = "front", images: EffectImages = {}) => drawSpecialEffects(ctx, state, fighter.moveMs, x => x, y => 540 - y, layer, images)
  return { state, fighter, calls, draw }
}

describe("Bernard's special animation", () => {
  it.each([1, -1] as const)("draws all four eye-beam frames when facing %s", (facing) => {
    const drawImage = vi.fn()
    const ctx = new Proxy({
      drawImage,
      measureText: () => ({ width: 100 }),
      createLinearGradient: () => ({ addColorStop() {} }),
    } as unknown as CanvasRenderingContext2D, {
      get: (target, key) => Reflect.get(target, key) ?? (() => {}),
    })
    const canvas = document.createElement("canvas")
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx)
    const renderer = createFightRenderer(canvas)
    const sprite = new Image()
    renderer.setSprites({ bernard: sprite })
    const state = createFight("bernard", "bull")
    const fighter = state.fighters[0]
    const move = fighter.def.moves.special
    Object.assign(fighter, { state: "attack", move, facing })
    const times = [0, move.startup * 0.6, move.startup + 1, move.startup + move.active + 1]
    times.forEach((moveMs, index) => {
      fighter.moveMs = moveMs
      drawImage.mockClear()
      renderer.render(state, moveMs, ["1P", "CPU"])
      const frame = FIGHTER_ATLASES.bernard!.poses.specialScan![index]!
      expect(drawImage).toHaveBeenCalledWith(sprite, frame.x, frame.y, frame.w, frame.h,
        expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number))
    })
    renderer.dispose()
  })
})

describe("Bernard's effect geometry", () => {
  it.each([1, -1] as const)("connects the scanning beam to the eyes inside the fighter silhouette facing %s", facing => {
    const { fighter, calls, draw } = effectHarness()
    fighter.facing = facing
    fighter.move = fighter.def.moves.special
    fighter.moveMs = fighter.move.startup + 400
    const before = scanningBeamBox(fighter)
    draw()
    expect(calls.moveTo).toHaveBeenCalledWith(fighter.x + facing * 18, 540 - fighter.y - 128)
    expect(calls.lineTo).toHaveBeenCalledWith(fighter.x + facing * 28, 540 - before.y - before.h / 2)
    expect(28).toBeLessThan(fighter.def.width / 2)
    expect(scanningBeamBox(fighter)).toEqual(before)
  })

  it("draws the scanning beam throughout its full second and stops exactly at recovery", () => {
    const { fighter, calls, draw } = effectHarness()
    fighter.move = fighter.def.moves.special
    expect(fighter.move.active).toBe(1000)
    for (const elapsed of [0, 250, 500, 999]) {
      fighter.moveMs = fighter.move.startup + elapsed
      calls.fillRect.mockClear()
      draw()
      const box = scanningBeamBox(fighter)
      expect(calls.fillRect).toHaveBeenCalledWith(box.x, 540 - box.y - box.h, box.w, box.h)
    }
    fighter.moveMs = fighter.move.startup + fighter.move.active
    calls.fillRect.mockClear()
    draw()
    expect(calls.fillRect).not.toHaveBeenCalled()
  })

  it("draws the fired math circle at the simulation's traveling center and radius", () => {
    const { fighter, calls, draw } = effectHarness()
    fighter.move = fighter.def.moves.specialDownForward!
    fighter.moveMs = fighter.move.startup + fighter.move.active * 0.5
    draw("back")
    const center = circleCenter(fighter)
    expect(center.x).toBeGreaterThan(fighter.x)
    expect(calls.arc).toHaveBeenCalledWith(center.x, 540 - center.y, circleRadius(fighter), 0, Math.PI * 2)
  })

  it.each([1, -1] as const)("uses the ultimate's exact target and safe area facing %s", facing => {
    const { fighter, calls, draw } = effectHarness()
    fighter.facing = facing
    fighter.x = facing === 1 ? 900 : 60
    fighter.special!.originX = fighter.x
    fighter.special!.targetX = fighter.x + facing * 280
    fighter.move = fighter.def.moves.specialUltimate!
    fighter.moveMs = fighter.move.startup - 1
    fighter.y = 190
    draw("back")
    const tell = breakingNewsGeometry(fighter)
    expect(tell.explosion.w).toBe(320)
    expect(calls.fillRect).toHaveBeenCalledWith(tell.explosion.x, 540 - 8, tell.explosion.w, 8)
    draw()
    expect(calls.arc).toHaveBeenCalledWith(tell.ballX, 540 - tell.ballY, tell.radius, 0, Math.PI * 2)
    expect(tell.ballY - tell.radius).toBeGreaterThan(fighter.y + fighter.def.height)
    fighter.moveMs = fighter.move.startup + 601
    calls.fillRect.mockClear()
    draw()
    const blast = breakingNewsGeometry(fighter).explosion
    expect(calls.rect).toHaveBeenCalledWith(blast.x, 540 - blast.y - blast.h, blast.w, blast.h)
    expect(calls.fillRect).not.toHaveBeenCalledWith(blast.x, 540 - blast.y - blast.h, blast.w, blast.h)
  })

  it.each([[0, 0, 0], [100, 512, 0], [200, 0, 512], [300, 512, 512]])("draws explosion art at elapsed %sms, including fading recovery", (elapsed, sx, sy) => {
    const { fighter, calls, draw } = effectHarness()
    fighter.move = fighter.def.moves.specialUltimate!
    fighter.moveMs = fighter.move.startup + 600 + elapsed
    const explosion = new Image()
    Object.defineProperties(explosion, { naturalWidth: { value: 1024 }, naturalHeight: { value: 1024 } })
    draw("front", { explosion })
    expect(calls.drawImage).toHaveBeenCalledWith(explosion, sx, sy, 512, 512,
      expect.any(Number), expect.any(Number), 320, expect.any(Number))
    const blast = breakingNewsGeometry(fighter).explosion
    expect(calls.rect).toHaveBeenCalledWith(blast.x, 540 - 320, 320, 320)
    expect(calls.fillRect).not.toHaveBeenCalled()
  })

  it("uses the empowered orb's own lifetime for its countdown rim", () => {
    const { state, calls, draw } = effectHarness()
    state.orbs.push({ owner: 0, x: 500, y: 100, radius: 64, remainingMs: 2500, lifetimeMs: 5000, captured: null })
    draw()
    expect(calls.arc).toHaveBeenCalledWith(500, 440, 64, 0, Math.PI * 2)
    expect(calls.arc).toHaveBeenCalledWith(500, 440, 68, -Math.PI / 2, Math.PI / 2)
  })

  it("sizes Bernard's ice art to its larger shared hitbox", () => {
    const { fighter, calls, draw } = effectHarness()
    fighter.move = fighter.def.moves.specialBack!
    fighter.moveMs = fighter.move.startup + 1
    const image = new Image()
    Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 100 } })
    draw("front", { ice: image })
    const box = worldHitbox(fighter, fighter.move.hitbox)
    expect(calls.drawImage).toHaveBeenCalledWith(image, 0, 0, 100, 100, box.x, 540 - box.y - box.h, box.w, box.h)
  })

  it("renders the beam with missing atlas images without relying on legacy projectiles", () => {
    const { state } = effectHarness()
    const ctx = new Proxy({ measureText: () => ({ width: 100 }), createLinearGradient: () => ({ addColorStop() {} }) } as unknown as CanvasRenderingContext2D, {
      get: (target, key) => Reflect.get(target, key) ?? (() => {}),
    })
    const canvas = document.createElement("canvas")
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx)
    const renderer = createFightRenderer(canvas)
    state.fighters[0].move = state.fighters[0].def.moves.special
    state.fighters[0].moveMs = state.fighters[0].move.startup + 500
    expect(() => renderer.render(state, 1000, ["1P", "CPU"])).not.toThrow()
    renderer.dispose()
  })

  it("keeps the overhead ultimate ball and its tell below the HUD on a short screen", () => {
    const { state, fighter } = effectHarness()
    fighter.move = fighter.def.moves.specialUltimate!
    fighter.moveMs = fighter.move.startup - 1
    fighter.y = 190
    const arc = vi.fn()
    const ctx = new Proxy({ arc, measureText: () => ({ width: 100 }), createLinearGradient: () => ({ addColorStop() {} }) } as unknown as CanvasRenderingContext2D, {
      get: (target, key) => Reflect.get(target, key) ?? (() => {}),
    })
    const canvas = document.createElement("canvas")
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx)
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ width: 960, height: 540 } as DOMRect)
    const renderer = createFightRenderer(canvas)
    renderer.render(state, 1000, ["1P", "CPU"])
    const radius = breakingNewsGeometry(fighter).radius
    const sphere = arc.mock.calls.find((call) => call[2] === radius)
    expect(sphere).toBeDefined()
    expect(sphere![1] - radius * 1.16).toBeGreaterThanOrEqual(125)
    renderer.dispose()
  })
})
