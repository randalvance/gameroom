import * as THREE from 'three'

type Track = <T extends { dispose(): void }>(resource: T) => T
export const HATCH_WIDTH = 2.2
export const HATCH_DEPTH = 2.7

/** Cut the carpet and building slab without changing their UVs or outside edges. */
export function maskHatchOpening(material: THREE.Material, x: number, z: number, open: { value: number }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hatchOpen = open
    shader.uniforms.hatchBounds = { value: new THREE.Vector4(x, z, HATCH_WIDTH / 2, HATCH_DEPTH / 2) }
    shader.vertexShader = 'varying vec3 hatchWorldPosition;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nhatchWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = 'uniform float hatchOpen;\nuniform vec4 hatchBounds;\nvarying vec3 hatchWorldPosition;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (hatchOpen > 0.5 && abs(hatchWorldPosition.x - hatchBounds.x) < hatchBounds.z && abs(hatchWorldPosition.z - hatchBounds.y) < hatchBounds.w) discard;`)
  }
  material.customProgramCacheKey = () => 'backrooms-floor-opening-v1'
  material.needsUpdate = true
}

/** Small upstairs prop. No textures or mini-game dependencies; built on reveal. */
export function createBackroomsHatch(track: Track): THREE.Group {
  const hatch = new THREE.Group()
  const steel = track(new THREE.MeshLambertMaterial({ color: 0xd8af55 }))
  const frame = track(new THREE.MeshLambertMaterial({ color: 0x635944 }))
  const liner = track(new THREE.MeshLambertMaterial({ color: 0x494538 }))
  const dark = track(new THREE.MeshBasicMaterial({ color: 0x080908 }))
  function box(name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), material)
    mesh.name = name; mesh.position.set(x, y, z); hatch.add(mesh); return mesh
  }
  // A deep, closed shaft: its side walls occlude the lower rungs as the view moves.
  box('shaft-bottom', HATCH_WIDTH, .12, HATCH_DEPTH, 0, -3, 0, dark)
  for (const side of [-1, 1]) {
    box('shaft-side', .12, 3, HATCH_DEPTH, side * (HATCH_WIDTH / 2 + .06), -1.5, 0, liner)
    box('shaft-end', HATCH_WIDTH, 3, .12, 0, -1.5, side * (HATCH_DEPTH / 2 + .06), liner)
    box('raised-rim', .18, .18, HATCH_DEPTH + .36, side * (HATCH_WIDTH / 2 + .09), .09, 0, frame)
    box('raised-rim', HATCH_WIDTH, .18, .18, 0, .09, side * (HATCH_DEPTH / 2 + .09), frame)
  }
  function bar(name: string, start: THREE.Vector3, end: THREE.Vector3, radius: number) {
    const direction = end.clone().sub(start)
    const mesh = new THREE.Mesh(track(new THREE.CylinderGeometry(radius, radius, direction.length(), 8)), steel)
    mesh.name = name; mesh.position.copy(start).add(end).multiplyScalar(.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    hatch.add(mesh)
  }
  for (const x of [-.7, .7]) bar('ladder-rail', new THREE.Vector3(x, -2.8, -.75), new THREE.Vector3(x, .75, .7), .085)
  for (let i = 0; i < 8; i++) {
    const y = .25 - i * .4, z = -.75 + (y + 2.8) / 3.55 * 1.45
    bar('ladder-rung', new THREE.Vector3(-.7, y, z), new THREE.Vector3(.7, y, z), .07)
  }
  // Hinged lid standing open behind the shaft, with visible thickness and bracing.
  const lid = new THREE.Group(); lid.position.set(0, .12, -HATCH_DEPTH / 2 - .15); lid.rotation.x = -.18
  const panel = new THREE.Mesh(track(new THREE.BoxGeometry(HATCH_WIDTH + .25, 2.3, .14)), frame)
  panel.position.y = 1.15; lid.add(panel)
  for (const y of [.35, 1.9]) {
    const brace = new THREE.Mesh(track(new THREE.BoxGeometry(HATCH_WIDTH, .1, .09)), steel)
    brace.position.set(0, y, .11); lid.add(brace)
  }
  lid.name = 'open-lid'; hatch.add(lid)
  return hatch
}
