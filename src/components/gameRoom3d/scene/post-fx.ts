// The frame's final grade: exposure, vignette and grain.

import type * as THREE from "three"

/**
 * How much light the tone mapper lets through. Under 1 the whole frame reads
 * dimmer — the room is a lit interior at dusk, and at full exposure the floor
 * and desktops washed out to a flat glare that the warm point-light pools had
 * nothing left to stand out against.
 */
export const ROOM_EXPOSURE = 0.78

// The frame's final grade. It used to be a tilt-shift — a 12-tap circular blur
// that let go of everything away from a focus band — but the miniature effect
// cost more legibility than it bought charm, so only the vignette and the grain
// remain.
export const RoomGradeShader = {
    uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
    fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      // gentle vignette
      vec2 vc = vUv - 0.5;
      float vig = 1.0 - smoothstep(0.42, 0.95, length(vc) * 1.18) * 0.5;
      col *= vig;
      // faint film grain keeps large flat areas alive
      col += (hash(vUv * (401.0 + fract(uTime))) - 0.5) * 0.028;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}
