import { ShaderLib } from "three"
import { describe, expect, it } from "vitest"
import {
  PICTURE_MAP_ANCHOR,
  PICTURE_PARS_ANCHOR,
  acesFilmicToneMap,
  applyBroadcastPictureShader,
  broadcastPictureUniforms,
  inverseAcesFilmicToneMap,
} from "./broadcast-picture"

/** The room's exposure — see ROOM_EXPOSURE in scene.ts. */
const EXPOSURE = 0.78

type RGB = [number, number, number]

const expectClose = (actual: RGB, expected: RGB, digits = 3) => {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i]!, digits)
}

describe("acesFilmicToneMap", () => {
  it("is three's curve: mid grey comes out a little darker, white is compressed", () => {
    const [grey] = acesFilmicToneMap([0.18, 0.18, 0.18], EXPOSURE)
    expect(grey).toBeGreaterThan(0.13)
    expect(grey).toBeLessThan(0.17)
    const [white] = acesFilmicToneMap([1, 1, 1], EXPOSURE)
    expect(white).toBeGreaterThan(0.6)
    expect(white).toBeLessThan(0.75)
  })
})

describe("inverseAcesFilmicToneMap", () => {
  it("round-trips greys through the tone mapper", () => {
    for (let y = 0.02; y <= 0.98; y += 0.08) {
      const target: RGB = [y, y, y]
      expectClose(acesFilmicToneMap(inverseAcesFilmicToneMap(target, EXPOSURE), EXPOSURE), target)
    }
  })

  it("round-trips ordinary colours — a newsroom's blues, skin, a red lower-third", () => {
    const colours: RGB[] = [
      [0.05, 0.12, 0.45],
      [0.6, 0.42, 0.33],
      [0.7, 0.08, 0.1],
      [0.85, 0.85, 0.9],
      [0.01, 0.01, 0.02],
    ]
    for (const target of colours) {
      expectClose(acesFilmicToneMap(inverseAcesFilmicToneMap(target, EXPOSURE), EXPOSURE), target)
    }
  })

  it("round-trips the other way: scene colours come back from their mapped values", () => {
    for (const x of [0.01, 0.1, 0.3, 0.6, 1.0]) {
      const scene: RGB = [x, x * 0.8, x * 0.5]
      expectClose(inverseAcesFilmicToneMap(acesFilmicToneMap(scene, EXPOSURE), EXPOSURE), scene)
    }
  })

  it("lands exactly on black and white", () => {
    for (const target of [[1, 1, 1], [0, 0, 0]] as RGB[]) {
      expectClose(acesFilmicToneMap(inverseAcesFilmicToneMap(target, EXPOSURE), EXPOSURE), target, 2)
    }
  })

  it("never produces NaN for a full-strength primary, which ACES cannot reach", () => {
    // A pure sRGB primary is outside the tone mapper's output gamut, so no
    // input maps to it; the clamp keeps the inverse finite and the hue right
    // at the cost of some saturation. Filmed video has no such pixels.
    for (const target of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as RGB[]) {
      const back = inverseAcesFilmicToneMap(target, EXPOSURE)
      for (const v of back) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
      }
      const mapped = acesFilmicToneMap(back, EXPOSURE)
      const dominant = target.indexOf(1)
      expect(mapped[dominant]).toBeGreaterThan(0.9)
      expect(mapped.indexOf(Math.max(...mapped))).toBe(dominant)
    }
  })

  it("puts white far above 1 — the output pass is what brings it back down", () => {
    const [w] = inverseAcesFilmicToneMap([1, 1, 1], EXPOSURE)
    expect(w).toBeGreaterThan(5)
  })
})

describe("applyBroadcastPictureShader", () => {
  // three's own basic-material fragment shader, not a stand-in: the patch
  // hangs off two of its #include lines, and a three upgrade that renames
  // either would silently leave the picture tone mapped.
  const basic = () => ({ uniforms: {}, fragmentShader: ShaderLib.basic.fragmentShader })

  it("finds its anchors in three's MeshBasicMaterial shader", () => {
    expect(ShaderLib.basic.fragmentShader).toContain(PICTURE_PARS_ANCHOR)
    expect(ShaderLib.basic.fragmentShader).toContain(PICTURE_MAP_ANCHOR)
  })

  it("declares before main, runs after the map sample, and registers the uniforms", () => {
    const shader = basic()
    const uniforms = broadcastPictureUniforms(EXPOSURE)
    expect(applyBroadcastPictureShader(shader, uniforms)).toBe(true)
    expect(shader.uniforms).toMatchObject(uniforms)
    const src = shader.fragmentShader
    const declared = src.indexOf("vec3 inverseAcesFilmicToneMap(")
    const main = src.indexOf("void main()")
    const sampled = src.indexOf(PICTURE_MAP_ANCHOR)
    const applied = src.indexOf("diffuseColor.rgb = inverseAcesFilmicToneMap(")
    expect(declared).toBeGreaterThan(-1)
    expect(declared).toBeLessThan(main)
    expect(sampled).toBeLessThan(applied)
  })

  it("is switched by a uniform, so the same material serves the direct path untouched", () => {
    const uniforms = broadcastPictureUniforms(EXPOSURE)
    expect(uniforms.uUndoToneMapping.value).toBe(0)
    expect(uniforms.uToneMappingExposure.value).toBe(EXPOSURE)
    const shader = basic()
    applyBroadcastPictureShader(shader, uniforms)
    expect(shader.fragmentShader).toContain("if ( uUndoToneMapping > 0.5 )")
  })

  it("leaves a shader without the anchors alone rather than corrupting it", () => {
    const shader = { uniforms: {}, fragmentShader: "void main() { gl_FragColor = vec4(1.0); }" }
    expect(applyBroadcastPictureShader(shader, broadcastPictureUniforms(EXPOSURE))).toBe(false)
    expect(shader.fragmentShader).toBe("void main() { gl_FragColor = vec4(1.0); }")
    expect(shader.uniforms).toEqual({})
  })
})
