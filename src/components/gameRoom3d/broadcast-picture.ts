// Showing a filmed broadcast on the wall as filmed.
//
// The room's frame goes through ACES filmic tone mapping at 0.78 exposure,
// applied to the finished frame by the post chain's output pass, which is
// where a material's `toneMapped: false` stops meaning anything. A video put
// through that comes out dark and flat (measured at ~0.17 mean luma against
// the clip's own 0.24). That is not the clip.
//
// So the picture is not drawn with the room. It is drawn after the room's
// render pass, into the same buffer and against the room's own depth (so a
// hacker standing at the front still covers the bottom of the wall), with the
// tone map applied in reverse — the output pass then maps it forward again
// and lands exactly on the source. The room's grade (vignette, grain) still
// sees it, which keeps the wall looking like part of the frame.
//
// Without a post chain (the low tier draws straight to the canvas) none of this
// is needed: `toneMapped: false` is honoured there, and the picture is drawn
// after the room with the reverse mapping switched off.
//
// The maths is here rather than in scene.ts because it is the part that can be
// wrong silently: a wrong inverse is a picture that is merely a different
// shade of wrong. The TypeScript reference below is what the tests hold the
// GLSL to.

import * as THREE from "three"
import { Pass } from "three/addons/postprocessing/Pass.js"

// three's ACESFilmicToneMapping, in matrices it applies column-major. The
// GLSL literals are column vectors; these are the same matrices row-major,
// which is what Matrix3.set takes.
const ACES_INPUT = new THREE.Matrix3().set(
  0.59719, 0.35458, 0.04823,
  0.07600, 0.90834, 0.01566,
  0.02840, 0.13383, 0.83777,
)
const ACES_OUTPUT = new THREE.Matrix3().set(
  1.60475, -0.53108, -0.07367,
  -0.10208, 1.10813, -0.00605,
  -0.00327, -0.07276, 1.07602,
)
const ACES_INPUT_INV = ACES_INPUT.clone().invert()
const ACES_OUTPUT_INV = ACES_OUTPUT.clone().invert()

/** RRT+ODT fit, per channel — the curve at the heart of three's ACES. */
function rrtAndOdtFit(v: number): number {
  const a = v * (v + 0.0245786) - 0.000090537
  const b = v * (0.983729 * v + 0.4329510) + 0.238081
  return a / b
}

/**
 * The curve run backwards. It is a ratio of quadratics, so the input is the
 * positive root of one; the output is clamped a hair under the curve's
 * ceiling (1/0.983729) first, or there is no root to find.
 */
function inverseRrtAndOdtFit(y: number): number {
  const t = Math.min(Math.max(y, 0), 1)
  const a = 1 - 0.983729 * t
  const b = 0.0245786 - 0.4329510 * t
  const c = -0.000090537 - 0.238081 * t
  return (-b + Math.sqrt(Math.max(b * b - 4 * a * c, 0))) / (2 * a)
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)

/** Reference for three's ACESFilmicToneMapping: linear scene colour in, display-linear out. */
export function acesFilmicToneMap(rgb: readonly [number, number, number], exposure: number): [number, number, number] {
  const v = new THREE.Vector3(...rgb).multiplyScalar(exposure / 0.6).applyMatrix3(ACES_INPUT)
  v.set(rrtAndOdtFit(v.x), rrtAndOdtFit(v.y), rrtAndOdtFit(v.z)).applyMatrix3(ACES_OUTPUT)
  return [clamp01(v.x), clamp01(v.y), clamp01(v.z)]
}

/**
 * The colour to hand the tone mapper so that it hands back `rgb`.
 *
 * Exact inside the curve's range. A channel the output matrix pushes above the
 * curve's ceiling — only the most saturated primaries — is clamped, so those
 * come back a touch less saturated rather than as NaN.
 */
export function inverseAcesFilmicToneMap(rgb: readonly [number, number, number], exposure: number): [number, number, number] {
  const v = new THREE.Vector3(...rgb).applyMatrix3(ACES_OUTPUT_INV)
  v.set(inverseRrtAndOdtFit(v.x), inverseRrtAndOdtFit(v.y), inverseRrtAndOdtFit(v.z))
    .applyMatrix3(ACES_INPUT_INV)
    .multiplyScalar(0.6 / exposure)
  return [Math.max(v.x, 0), Math.max(v.y, 0), Math.max(v.z, 0)]
}

export interface BroadcastPictureUniforms {
  /** 1 while the frame goes through the post chain's tone mapper, else 0. */
  uUndoToneMapping: { value: number }
  uToneMappingExposure: { value: number }
  uAcesInputInv: { value: THREE.Matrix3 }
  uAcesOutputInv: { value: THREE.Matrix3 }
}

export function broadcastPictureUniforms(exposure: number): BroadcastPictureUniforms {
  return {
    uUndoToneMapping: { value: 0 },
    uToneMappingExposure: { value: exposure },
    uAcesInputInv: { value: ACES_INPUT_INV },
    uAcesOutputInv: { value: ACES_OUTPUT_INV },
  }
}

/** Where the uniforms and the function are declared: with the map's own. */
export const PICTURE_PARS_ANCHOR = "#include <map_pars_fragment>"
/** Where the reverse mapping runs: right after the video texel lands in diffuseColor. */
export const PICTURE_MAP_ANCHOR = "#include <map_fragment>"

// The TypeScript above, line for line.
const PICTURE_PARS = /* glsl */ `
uniform float uUndoToneMapping;
uniform float uToneMappingExposure;
uniform mat3 uAcesInputInv;
uniform mat3 uAcesOutputInv;

vec3 inverseRrtAndOdtFit( vec3 y ) {
	vec3 t = clamp( y, 0.0, 1.0 );
	vec3 a = 1.0 - 0.983729 * t;
	vec3 b = 0.0245786 - 0.4329510 * t;
	vec3 c = -0.000090537 - 0.238081 * t;
	return ( -b + sqrt( max( b * b - 4.0 * a * c, vec3( 0.0 ) ) ) ) / ( 2.0 * a );
}

vec3 inverseAcesFilmicToneMap( vec3 color ) {
	color = uAcesOutputInv * color;
	color = inverseRrtAndOdtFit( color );
	color = uAcesInputInv * color;
	color *= 0.6 / uToneMappingExposure;
	return max( color, vec3( 0.0 ) );
}
`

const PICTURE_FRAGMENT = /* glsl */ `
	if ( uUndoToneMapping > 0.5 ) diffuseColor.rgb = inverseAcesFilmicToneMap( diffuseColor.rgb );
`

export interface PatchableShader {
  uniforms: Record<string, { value: unknown }>
  fragmentShader: string
}

/**
 * Patch the reverse tone mapping into a MeshBasicMaterial's shader — the body
 * of its `onBeforeCompile`.
 *
 * Returns false, and touches nothing, if the shader is not the one expected:
 * a picture a shade off is a far better failure than a shader that will not
 * compile and a wall that goes black.
 */
export function applyBroadcastPictureShader(
  shader: PatchableShader,
  uniforms: BroadcastPictureUniforms,
): boolean {
  const src = shader.fragmentShader
  if (!src.includes(PICTURE_PARS_ANCHOR) || !src.includes(PICTURE_MAP_ANCHOR)) return false
  Object.assign(shader.uniforms, uniforms)
  shader.fragmentShader = src
    .replace(PICTURE_PARS_ANCHOR, `${PICTURE_PARS_ANCHOR}\n${PICTURE_PARS}`)
    .replace(PICTURE_MAP_ANCHOR, `${PICTURE_MAP_ANCHOR}\n${PICTURE_FRAGMENT}`)
  return true
}

/**
 * Draws the picture's scene over the post chain's current buffer, against the
 * depth the room left there. Sits after the room's render pass and before the
 * output pass, so it is not tone mapped twice. Nothing is swapped or
 * cleared: it adds to the frame in place.
 */
export class BroadcastPicturePass extends Pass {
  constructor(
    private readonly pictureScene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    super()
    this.needsSwap = false
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    if (!this.pictureScene.children.some((child) => child.visible)) return
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer)
    renderer.render(this.pictureScene, this.camera)
    renderer.autoClear = autoClear
  }
}
