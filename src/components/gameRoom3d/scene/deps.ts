// What the room's builders need from the scene that is assembling them.

import type * as THREE from "three"

export interface SceneDeps {
    /** Register a disposable with the scene's cleanup, and hand it back. */
    track: <T extends { dispose(): void }>(disposable: T) => T
    /** A lit surface, in the material the current quality tier can afford. */
    surfaceMaterial: (params: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial | THREE.MeshLambertMaterial
}
