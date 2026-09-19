// The city outside the glass.
//
// The room sits on a high floor, and the camera pitches ~30° downward, so the
// void around the diorama is not sky — it is the rest of the CBD, below us,
// falling away into haze. Three concentric cylinders of city silhouette wrap
// the room at increasing radius; because they sit at genuinely different
// depths, the ±18-unit camera pan produces real parallax with no per-layer
// scroll factors to tune. A fourth, much larger cylinder is the atmosphere
// itself: a vertical haze gradient that everything else sinks into.
//
// The silhouettes are pure white PNGs (or procedural stand-ins) tinted per
// minute by the time-of-day palette, so one set of assets serves the whole
// day. Window lights are never authored: each layer's light mask is scattered
// onto the silhouette's own alpha channel at load, which keeps every lit
// window on a building by construction.
import * as THREE from "three"
import type { SkyPalette } from "./time-of-day"

export interface BackdropHandle {
  /** Retint every layer. Called whenever the palette moves. */
  applyPalette(p: SkyPalette): void
}

interface RingSpec {
  key: "near" | "mid" | "far"
  radius: number
  /** How many times the texture wraps around the full circle. */
  repeats: number
  /** Texture canvas size; width is fixed, height varies per layer. */
  texHeight: number
  /** World y of the texture's top edge — the tallest possible rooftop. */
  top: number
  /** Lit-window size in texture pixels. */
  window: { w: number; h: number } | null
}

// Radii are chosen against the camera geometry, not taste: with the camera at
// y≈21 pitched 30° down, the highest visible point is ~+9 at r=90, ~-3 at
// r=180 and ~-24 at r=340 — so each ring's rooftops are set just under what
// the frame can show at its distance, and the layers stack down the screen
// instead of hiding behind one another.
const RINGS: RingSpec[] = [
  { key: "near", radius: 90, repeats: 4, texHeight: 1024, top: 20, window: { w: 7, h: 11 } },
  { key: "mid", radius: 180, repeats: 6, texHeight: 768, top: 2, window: { w: 4, h: 6 } },
  // Far towers get single-pixel-cluster lights, not grids — a window grid at
  // that distance aliases into shimmer.
  { key: "far", radius: 340, repeats: 8, texHeight: 512, top: -20, window: null },
]

const TEX_WIDTH = 2048
const HAZE_RADIUS = 520

// Deterministic PRNG, same shape as the one the scene's floor noise uses, so
// the skyline is identical on every load.
function mulberry(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- silhouettes

/**
 * A stand-in skyline for a layer whose PNG has not been shipped yet: white
 * boxes on transparency, tileable by construction (anything drawn past the
 * right edge is redrawn wrapped at the left).
 *
 * The near layer's distinguishing feature is deliberate EMPTINESS: wide
 * floor-to-ceiling gaps between tower clusters. They are what the mid and far
 * rings are seen through — without them the nearest ring is an opaque wall and
 * the whole parallax rig is invisible.
 */
function proceduralSilhouette(spec: RingSpec, seed: number): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = TEX_WIDTH
  c.height = spec.texHeight
  const ctx = c.getContext("2d")!
  const rnd = mulberry(seed)
  ctx.fillStyle = "#ffffff"

  const box = (x: number, w: number, h: number) => {
    ctx.fillRect(x, spec.texHeight - h, w, h)
    if (x + w > TEX_WIDTH) ctx.fillRect(x - TEX_WIDTH, spec.texHeight - h, w, h)
  }

  if (spec.key === "near") {
    // A few big confident towers per cluster, then a gap of open air.
    const GAPS = 4
    const cluster = TEX_WIDTH / GAPS
    for (let g = 0; g < GAPS; g++) {
      const gapW = 160 + rnd() * 160
      let x = g * cluster + gapW
      const clusterEnd = (g + 1) * cluster
      while (x < clusterEnd) {
        const w = 130 + rnd() * 170
        const h = spec.texHeight * (0.55 + rnd() * 0.55) // some run off the top
        box(x, Math.min(w, clusterEnd - x), Math.min(h, spec.texHeight))
        // occasional setback: a narrower upper storey on the same footprint
        if (rnd() > 0.5) box(x + w * 0.25, Math.min(w, clusterEnd - x) * 0.5, Math.min(h * 1.18, spec.texHeight))
        x += w + 20 + rnd() * 60
      }
    }
  } else {
    const dense = spec.key === "far"
    let x = Math.floor(rnd() * 40)
    while (x < TEX_WIDTH) {
      const w = dense ? 24 + rnd() * 46 : 60 + rnd() * 110
      const h = spec.texHeight * (dense ? 0.25 + rnd() * 0.5 : 0.3 + rnd() * 0.55)
      box(x, w, h)
      // leave sky-gaps between mid-layer clusters so the far ring shows through
      x += w + (dense ? 4 + rnd() * 18 : rnd() > 0.75 ? 90 + rnd() * 140 : 8 + rnd() * 30)
    }
  }
  return c
}

/** A smaller copy of a canvas, for work whose cost is per-pixel. */
function downscale(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const out = document.createElement("canvas")
  out.width = Math.max(1, Math.round(src.width * scale))
  out.height = Math.max(1, Math.round(src.height * scale))
  out.getContext("2d")!.drawImage(src, 0, 0, out.width, out.height)
  return out
}

/** The layer's PNG from /assets/room/sky, or null if it is not there. */
function loadSilhouette(spec: RingSpec): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = TEX_WIDTH
      c.height = spec.texHeight
      c.getContext("2d")!.drawImage(img, 0, 0, TEX_WIDTH, spec.texHeight)
      resolve(c)
    }
    img.onerror = () => resolve(null)
    img.src = `/assets/room/sky/city-${spec.key}.png`
  })
}

// ---------------------------------------------------------------- lights

/**
 * Scatter lit windows over a silhouette, writing only where the silhouette is
 * solid — which is what keeps the mask aligned with hand-drawn art as well as
 * with the procedural stand-ins, and why no `-lights` asset exists to drift.
 *
 * Lighting is clustered per building column (whole bright floors, dark bands)
 * rather than uniform: uniform random reads as noise, buildings read as rows.
 */
function lightsFor(
  silhouette: HTMLCanvasElement,
  spec: RingSpec,
  seed: number,
  /**
   * Fraction of the silhouette's resolution to work at. This is the room's
   * biggest load-time stall — a synchronous `getImageData` scan over 2048×h
   * followed by thousands of `fillRect`s, three times over — and it is all
   * main-thread, before the first frame. Halving it is a 4× cut in both that
   * work and the texture it uploads, at a distance where the windows are a
   * couple of pixels across anyway.
   */
  scale = 1,
): HTMLCanvasElement {
  const sil = scale < 1 ? downscale(silhouette, scale) : silhouette
  const w = sil.width
  const h = sil.height
  const detail = w / silhouette.width
  const alpha = sil.getContext("2d")!.getImageData(0, 0, w, h).data
  const solid = (x: number, y: number) =>
    x >= 0 && x < w && y >= 0 && y < h && alpha[(y * w + x) * 4 + 3]! > 200

  const out = document.createElement("canvas")
  out.width = w
  out.height = h
  const ctx = out.getContext("2d")!
  ctx.fillStyle = "#ffffff"
  const rnd = mulberry(seed)

  if (!spec.window) {
    // far ring: sparse single dots. Density is per unit of texture AREA, so
    // a half-scale pass scatters a quarter as many and the skyline keeps the
    // same number of lights per building rather than four times as many.
    const dots = Math.max(1, Math.round(2600 * detail * detail))
    for (let i = 0; i < dots; i++) {
      const x = Math.floor(rnd() * w)
      const y = Math.floor(rnd() * h)
      if (solid(x, y) && solid(x, y - Math.max(1, Math.round(3 * detail))) && rnd() > 0.45) {
        ctx.fillRect(x, y, Math.max(1, Math.round(2 * detail)), Math.max(1, Math.round(2 * detail)))
      }
    }
    return out
  }

  const ww = Math.max(1, Math.round(spec.window.w * detail))
  const wh = Math.max(1, Math.round(spec.window.h * detail))
  const gapX = ww + Math.max(3, Math.round(ww * 0.8))
  const gapY = wh + Math.max(4, Math.round(wh * 0.7))
  for (let x0 = 0; x0 < w; x0 += gapX) {
    // one brightness temperament per column of windows, so vertical runs of
    // the same building light together
    const columnBias = rnd()
    for (let y0 = Math.floor(rnd() * gapY); y0 < h; y0 += gapY) {
      // a floor is lit as a band: neighbours in y agree via the row seed
      const rowRoll = mulberry(seed * 31 + Math.floor(y0 / gapY) * 7 + Math.floor(x0 / (gapX * 6)))()
      const lit = (rowRoll * 0.6 + columnBias * 0.4 + rnd() * 0.35) > 0.72
      if (!lit) continue
      // keep every lit pixel on the building: corners of the window must be solid
      if (solid(x0, y0) && solid(x0 + ww, y0) && solid(x0, y0 + wh) && solid(x0 + ww, y0 + wh)) {
        ctx.fillRect(x0, y0, ww, wh)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- haze shell

const HazeShader = {
  uniforms: {
    uHaze: { value: new THREE.Color(0x05070f) },
    uHazeTop: { value: new THREE.Color(0x101a30) },
    uGlow: { value: new THREE.Color(0x1a2440) },
    uGlowStrength: { value: 0.1 },
  },
  vertexShader: /* glsl */ `
    varying float vY;
    void main() {
      vY = (modelMatrix * vec4(position, 1.0)).y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // The gradient runs on WORLD height, not texture v, so the shell's size can
  // change without retuning: deep haze below the city, brightening toward the
  // (off-screen) horizon, with the sun's warmth mixed into the top band only.
  fragmentShader: /* glsl */ `
    uniform vec3 uHaze;
    uniform vec3 uHazeTop;
    uniform vec3 uGlow;
    uniform float uGlowStrength;
    varying float vY;
    void main() {
      float t = smoothstep(-90.0, 30.0, vY);
      vec3 rim = mix(uHazeTop, uGlow, uGlowStrength * smoothstep(-20.0, 30.0, vY));
      gl_FragColor = vec4(mix(uHaze, rim, t), 1.0);
    }
  `,
}

// ---------------------------------------------------------------- fog skirts

/**
 * Ground fog wrapped just inside each silhouette ring. The silhouette
 * textures end in a hard horizontal line where the canvas does, and the
 * camera's downward pitch can see that line — a city that stops dead. The
 * skirt is a vertical alpha gradient in the palette's haze colour: solid over
 * the cut, thinning to nothing partway up the towers, so the buildings sink
 * into fog instead of ending.
 */
const SkirtShader = {
  uniforms: {
    uColor: { value: new THREE.Color(0x05070f) },
    uBottom: { value: 0 },
    uTop: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying float vY;
    void main() {
      vY = (modelMatrix * vec4(position, 1.0)).y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uBottom;
    uniform float uTop;
    varying float vY;
    void main() {
      gl_FragColor = vec4(uColor, 1.0 - smoothstep(uBottom, uTop, vY));
    }
  `,
}

// ---------------------------------------------------------------- assembly

/**
 * Builds the whole backdrop, centred on the camera's home position so the
 * rings stay put while the camera pans inside them.
 *
 * `track` is the scene's disposal register — every geometry/material/texture
 * made here goes through it, same as the rest of the scene graph.
 */
export async function createBackdrop(
  scene: THREE.Scene,
  center: { x: number; z: number },
  track: <T extends { dispose(): void }>(resource: T) => T,
  opts: {
    /**
     * Everything the camera can see of the room must fit inside the nearest
     * ring, measured from `center`. Assignment mode pushes the camera far
     * enough back that the far wall would otherwise poke through the skyline
     * and vanish behind a tower; the rings (and the haze shell behind them)
     * scale out together to keep the whole diorama inside the city.
     */
    clearRadius?: number
    /**
     * Resolution multiplier for the generated lit-window layers (1 = full).
     * The cheap tiers turn this down: see `lightsFor`, where it decides how
     * many pixels the main thread has to scan before the room can open.
     */
    lightsScale?: number
  } = {},
): Promise<BackdropHandle> {
  const ringScale = Math.max(1, (opts.clearRadius ?? 0) / RINGS[0]!.radius)
  const group = new THREE.Group()
  group.position.set(center.x, 0, center.z)
  scene.add(group)

  const cityMats: Record<string, THREE.MeshBasicMaterial> = {}
  const lightMats: THREE.MeshBasicMaterial[] = []
  const skirtMats: THREE.ShaderMaterial[] = []

  const silhouettes = await Promise.all(
    RINGS.map(async (spec, i) => (await loadSilhouette(spec)) ?? proceduralSilhouette(spec, 40 + i * 17)),
  )

  RINGS.forEach((spec, i) => {
    const sil = silhouettes[i]!
    const radius = spec.radius * ringScale
    const circumference = 2 * Math.PI * radius
    // World height follows from the wrap count: each repeat covers
    // circumference/repeats units of arc, and the texture keeps its aspect.
    const height = (circumference / spec.repeats) * (spec.texHeight / TEX_WIDTH)
    const geo = track(new THREE.CylinderGeometry(radius, radius, height, 96, 1, true))

    const asTexture = (canvas: HTMLCanvasElement) => {
      const tex = track(new THREE.CanvasTexture(canvas))
      tex.wrapS = THREE.RepeatWrapping
      tex.repeat.x = spec.repeats
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    }

    // Silhouette: white texture × material colour = the palette's tint.
    const mat = track(new THREE.MeshBasicMaterial({
      map: asTexture(sil),
      side: THREE.BackSide,
      transparent: true,
      alphaTest: 0.35,
      fog: false,
    }))
    cityMats[spec.key] = mat
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = spec.top - height / 2
    group.add(mesh)

    // Window lights: additive overlay on a fractionally smaller ring. Not
    // tone-mapped, so at full strength the towers' windows stay bright against
    // the dusk.
    const lightGeo = track(new THREE.CylinderGeometry(radius - 0.5, radius - 0.5, height, 96, 1, true))
    const lightMat = track(new THREE.MeshBasicMaterial({
      map: asTexture(lightsFor(sil, spec, 90 + i * 13, opts.lightsScale ?? 1)),
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
      color: 0xffc584,
      toneMapped: false,
      fog: false,
    }))
    lightMats.push(lightMat)
    const lightMesh = new THREE.Mesh(lightGeo, lightMat)
    lightMesh.position.y = spec.top - height / 2
    group.add(lightMesh)

    // Fog skirt over the ring's lower reach — from below its hard bottom cut
    // to partway up the towers. A fraction inside the light ring so it veils
    // both the silhouette and its windows.
    const skirtBottom = spec.top - height - 8
    const skirtTop = spec.top - height * 0.55
    const skirtGeo = track(new THREE.CylinderGeometry(
      radius - 1.5, radius - 1.5, skirtTop - skirtBottom, 96, 1, true,
    ))
    const skirtMat = track(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(SkirtShader.uniforms),
      vertexShader: SkirtShader.vertexShader,
      fragmentShader: SkirtShader.fragmentShader,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    }))
    skirtMat.uniforms["uBottom"]!.value = skirtBottom + 4
    skirtMat.uniforms["uTop"]!.value = skirtTop
    skirtMats.push(skirtMat)
    const skirt = new THREE.Mesh(skirtGeo, skirtMat)
    skirt.position.y = (skirtBottom + skirtTop) / 2
    group.add(skirt)
  })

  // The atmosphere shell behind everything. Its bottom edge and the scene
  // background are the same colour, so wherever the frame looks past it the
  // haze simply continues.
  const hazeGeo = track(new THREE.CylinderGeometry(HAZE_RADIUS * ringScale, HAZE_RADIUS * ringScale, 640, 64, 1, true))
  const hazeMat = track(new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(HazeShader.uniforms),
    vertexShader: HazeShader.vertexShader,
    fragmentShader: HazeShader.fragmentShader,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  }))
  const haze = new THREE.Mesh(hazeGeo, hazeMat)
  haze.position.y = 60 - 320
  haze.renderOrder = -1
  group.add(haze)

  return {
    applyPalette(p: SkyPalette) {
      cityMats["near"]!.color.setHex(p.cityNear)
      cityMats["mid"]!.color.setHex(p.cityMid)
      cityMats["far"]!.color.setHex(p.cityFar)
      // Nearer windows read brighter through less air.
      lightMats.forEach((m, i) => { m.opacity = p.windowLights * [0.95, 0.7, 0.5][i]! })
      skirtMats.forEach((m) => { (m.uniforms["uColor"]!.value as THREE.Color).setHex(p.haze) })
      hazeMat.uniforms["uHaze"]!.value.setHex(p.haze)
      hazeMat.uniforms["uHazeTop"]!.value.setHex(p.hazeTop)
      hazeMat.uniforms["uGlow"]!.value.setHex(p.horizonGlow)
      hazeMat.uniforms["uGlowStrength"]!.value = p.glowStrength
    },
  }
}
