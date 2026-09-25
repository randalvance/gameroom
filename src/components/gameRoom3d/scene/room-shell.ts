// The room's shell: the carpet, the glass curtain walls, the storeys of the
// tower falling away beneath the slab, and the aisle rugs.

import * as THREE from "three"
import { ROOM_CAMERA_MAX_PAN_SOUTH } from "../camera-pan"
import { NORTH_APRON, ROOM_D, ROOM_W, TABLE_ROWS, toZ, WALL_H } from "./layout"
import type { SceneDeps } from "./deps"
import { makeCarpetTexture, makeRugTexture } from "./textures"

export function buildRoomShell(scene: THREE.Scene, { track, surfaceMaterial }: SceneDeps) {
    const carpetTex = track(makeCarpetTexture())
    const floor = new THREE.Mesh(
        track(new THREE.PlaneGeometry(ROOM_W, ROOM_D)),
        track(surfaceMaterial({ map: carpetTex, roughness: 1, metalness: 0 })),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, 0, ROOM_D / 2)
    floor.receiveShadow = true
    scene.add(floor)
    const hatchOpeningMaterials: THREE.Material[] = [floor.material]

    // ---- glass curtain walls -------------------------------------------------
    const mullionMat = track(surfaceMaterial({ color: 0x343a46, roughness: 0.45, metalness: 0.6 }))
    const glassMat = track(surfaceMaterial({
        color: 0xa8c8e0, transparent: true, opacity: 0.13, roughness: 0.08,
        metalness: 0, side: THREE.DoubleSide, depthWrite: false,
    }))

    const buildGlassWall = (width: number, height: number): THREE.Group => {
        const g = new THREE.Group()
        const glass = new THREE.Mesh(track(new THREE.PlaneGeometry(width, height)), glassMat)
        glass.position.y = height / 2
        g.add(glass)
        const panes = Math.max(2, Math.round(width / 5))
        const postGeo = track(new THREE.BoxGeometry(0.14, height, 0.14))
        for (let i = 0; i <= panes; i++) {
            const post = new THREE.Mesh(postGeo, mullionMat)
            post.position.set(-width / 2 + (width / panes) * i, height / 2, 0)
            g.add(post)
        }
        const railGeo = track(new THREE.BoxGeometry(width, 0.12, 0.12))
        // The doubled wall gets a mid-height rail — floor, handrail, mid, cap —
        // so the upper glass doesn't read as one unbroken sheet.
        for (const ry of [0.08, 2.4, height * 0.55, height - 0.08]) {
            const rail = new THREE.Mesh(railGeo, mullionMat)
            rail.position.y = ry
            g.add(rail)
        }
        return g
    }

    // No glass on the front wall: floor to roof, that face is the screen and its
    // surround, and glazing behind an opaque panel is panes nobody can see.
    const leftGlass = buildGlassWall(ROOM_D, WALL_H)
    leftGlass.rotation.y = Math.PI / 2
    leftGlass.position.set(-ROOM_W / 2, 0, ROOM_D / 2)
    scene.add(leftGlass)
    const rightGlass = buildGlassWall(ROOM_D, WALL_H)
    rightGlass.rotation.y = -Math.PI / 2
    rightGlass.position.set(ROOM_W / 2, 0, ROOM_D / 2)
    scene.add(rightGlass)

    // ---- the rest of our own tower -------------------------------------------
    // With a real city outside, a floor plane ending in mid-air reads as a
    // mistake rather than a diorama. A fascia over the glass line and a few
    // storeys of the building falling away beneath the slab turn the cut-away
    // into a floor OF something. The top stays open — the camera looks down
    // into the room, so a ceiling would be all it ever saw.
    {
        const plateWest = -ROOM_W / 2
        const plateEast = ROOM_W / 2
        const plateNorth = -NORTH_APRON
        // The slab runs past the south glass line by as much as the camera may pan
        // that way (plus margin for the widest zoom), so panning down always lands
        // the bottom of the frame on structure. Without it, buying enough southward
        // pan to keep the last row's characters in frame would buy a view of the
        // tower's blank south face as well.
        const plateSouth = ROOM_D + ROOM_CAMERA_MAX_PAN_SOUTH + 3
        const plateW = plateEast - plateWest
        const plateD = plateSouth - plateNorth
        const plateX = (plateWest + plateEast) / 2
        const plateZ = (plateNorth + plateSouth) / 2

        const fasciaMat = track(surfaceMaterial({ color: 0x232733, roughness: 0.55, metalness: 0.35 }))
        // fascia band capping the glass, on the three walls that exist
        const fasciaSpans: Array<[w: number, x: number, z: number, rotY: number]> = [
            [ROOM_W + 0.7, 0, 0, 0],
            [ROOM_D + 0.7, -ROOM_W / 2, ROOM_D / 2, Math.PI / 2],
            [ROOM_D + 0.7, ROOM_W / 2, ROOM_D / 2, Math.PI / 2],
        ]
        for (const [w, x, z, rotY] of fasciaSpans) {
            const fascia = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.85, 0.5)), fasciaMat)
            fascia.position.set(x, WALL_H + 0.28, z)
            fascia.rotation.y = rotY
            scene.add(fascia)
        }

        // the slab edge itself, then two darker storeys stepping in and down —
        // enough to read as "building continues" before the haze takes over.
        // No storey's top may sit AT y=0 or flush against the box above: a face
        // coplanar with the floor planes z-fights them, which reads as mottled
        // carpet that shimmers whenever the camera moves. Each box instead starts
        // a little inside the one above, so every pair of surfaces has real
        // separation in depth.
        const storeys: Array<[inset: number, top: number, depth: number, color: number]> = [
            [0, -0.06, 1.1, 0x2e3340], // exposed floor slab, just under the carpet
            [0.35, -1.05, 5.5, 0x141824], // storey below, glass in shadow
            [0.9, -6.4, 7.7, 0x0b0e18], // and one more, sinking into the dark
        ]
        for (const [inset, top, depth, color] of storeys) {
            const storey = new THREE.Mesh(
                track(new THREE.BoxGeometry(plateW - inset * 2, depth, plateD - inset * 2)),
                track(surfaceMaterial({ color, roughness: 0.8, metalness: 0.1 })),
            )
            storey.position.set(plateX, top - depth / 2, plateZ)
            scene.add(storey)
            hatchOpeningMaterials.push(storey.material)
        }
    }


    // centre aisle rugs — one per gap between table rows, derived from the plan
    // so they follow the rows wherever the layout puts them
    const rugGeo = track(new THREE.PlaneGeometry(42, 3.4))
    const rugMat = track(surfaceMaterial({ map: track(makeRugTexture()), roughness: 1 }))
    for (let i = 0; i + 1 < TABLE_ROWS.length; i++) {
        const aisleZ = (toZ(TABLE_ROWS[i]!.bottom) + toZ(TABLE_ROWS[i + 1]!.top)) / 2
        const rug = new THREE.Mesh(rugGeo, rugMat)
        rug.rotation.x = -Math.PI / 2
        rug.position.set(0, 0.015, aisleZ)
        rug.receiveShadow = true
        scene.add(rug)
    }

    return { floor, hatchOpeningMaterials }
}
