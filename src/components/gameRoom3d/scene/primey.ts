// Primey, the mascot, as a billboard in the arrivals band.

import * as THREE from "three"
import { PRIMEY_POINT, PRIMEY_STRIP, primeyCenterY, primeyPlaneSize } from "../primey-npc"
import { toX, toZ } from "./layout"
import type { SceneDeps } from "./deps"
import { loadTexture } from "./textures"

export async function buildPrimey(scene: THREE.Scene, loader: THREE.TextureLoader, { track }: SceneDeps) {
    // The mascot, standing in the arrivals band as a billboard. The idle strip
    // is one row of square cells, so a 1/frames-wide texture repeat picks the
    // cell and the tick below walks the offset along it — no per-frame texture
    // upload, just a uniform.
    //
    // Basic, not Lambert: Primey is a lit screen on legs, and a mascot that
    // dims with the room's evening palette reads as switched off rather than as
    // the one thing in here you can ask a question.
    const primeySize = primeyPlaneSize()
    const primeyTex = track(await loadTexture(loader, PRIMEY_STRIP.url))
    primeyTex.repeat.set(1 / PRIMEY_STRIP.frames, 1)
    const primeyMat = track(new THREE.MeshBasicMaterial({
        map: primeyTex,
        transparent: true,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
    }))
    const primeyMesh = new THREE.Mesh(
        track(new THREE.PlaneGeometry(primeySize.width, primeySize.height)),
        primeyMat,
    )
    primeyMesh.position.set(toX(PRIMEY_POINT.x), primeyCenterY(), toZ(PRIMEY_POINT.y))
    scene.add(primeyMesh)

    return { primeyMesh, primeyTex }
}
