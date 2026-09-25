// The room's lights: the palette's three (ambient bounce, key, rim) and the
// warm pools over the desk rows.

import * as THREE from "three"
import { deskLightPlan } from "../quality-tier"
import type { skyPalette } from "../time-of-day"
import { TABLE_COL_CENTERS, TABLE_ROWS, toX, toZ } from "./layout"

export interface LightingDeps {
    shadowMapSize: number
    /** The time-of-day palette in force, or null before the first frame. */
    getPalette: () => ReturnType<typeof skyPalette> | null
    registerCleanup: (cleanup: () => void) => void
}

export function buildLighting(scene: THREE.Scene, { shadowMapSize, getPalette, registerCleanup }: LightingDeps) {
    // Ambient bounce, key and rim all start at arbitrary values — the palette
    // overwrites colour and intensity before the first frame, so the interior
    // light always agrees with whatever the city outside is doing.
    const hemi = new THREE.HemisphereLight(0x8fb0d8, 0x3a3d42, 0.75)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff2dd, 1.1)
    key.position.set(14, 30, 44)
    key.castShadow = true
    key.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    // Frustum sized for the doubled floor plate, not the old half-depth room.
    key.shadow.camera.left = -36
    key.shadow.camera.right = 36
    key.shadow.camera.top = 48
    key.shadow.camera.bottom = -30
    key.shadow.camera.far = 140
    key.shadow.bias = -0.002
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x4060ff, 0.5)
    rim.position.set(0, 14, -16)
    scene.add(rim)

    // Warm pools over the desk rows. The pendant fixtures these hung from are
    // gone — cords dangling from an open sky read wrong once the room got a
    // real backdrop — but the pools they cast stay, as unseen sources. One rank
    // per table row, centred on the row, so every row gets its pools.
    //
    // This rank is the room's single largest GPU cost: three.js is a forward
    // renderer, so all sixteen are evaluated per fragment of every Standard
    // material in the room. The cheap tiers merge columns into fewer, wider,
    // brighter pools — hence the rebuild rather than a fixed rig.
    const deskLights: THREE.PointLight[] = []
    const buildDeskLights = (perRow: number) => {
        for (const light of deskLights) {
            scene.remove(light)
            light.dispose()
        }
        deskLights.length = 0
        for (const row of TABLE_ROWS) {
            const lz = toZ(row.center)
            for (const plan of deskLightPlan(TABLE_COL_CENTERS, perRow)) {
                const pt = new THREE.PointLight(0xffb066, plan.intensity, plan.distance, 2)
                pt.position.set(toX(plan.x), 5.4, lz)
                // Its full brightness, so the house lights can dim and come back.
                pt.userData.baseIntensity = plan.intensity
                scene.add(pt)
                deskLights.push(pt)
            }
        }
        applyLightLevel()
    }

    // ---- house lights ---------------------------------------------------------
    // The palette's three lights and the desk pools, retuned whenever the
    // clock outside moves.
    const applyLightLevel = () => {
        const palette = getPalette()
        if (palette) {
            hemi.intensity = palette.hemiIntensity
            key.intensity = palette.keyIntensity
            rim.intensity = palette.rimIntensity
        }
        for (const light of deskLights) light.intensity = light.userData.baseIntensity as number
    }
    registerCleanup(() => {
        for (const light of deskLights) light.dispose()
    })

    return { hemi, key, rim, deskLights, buildDeskLights, applyLightLevel }
}
