// The desks: tables, chairs, laptops, their hitboxes, and the two floor
// highlights (the selected desk's square, the interact outline).

import * as THREE from "three"
import { isHouseTable, PARTICIPANT_TABLES } from "../../gameRoom/constants"
import { tableLegColorFor, tableTopColorFor } from "../desks"
import { toX, toZ } from "./layout"
import type { SceneDeps } from "./deps"
import { makeCanvasTexture, makeHighlightTexture } from "./textures"

export function buildFurniture(scene: THREE.Scene, { track, surfaceMaterial }: SceneDeps) {
    const tableTopMaterials = new Map<number, THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>()
    const tableMaterial = (
        color: number,
        cache: Map<number, THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>,
        roughness = 0.8,
    ) => {
        let material = cache.get(color)
        if (!material) {
            material = track(surfaceMaterial({ color, roughness }))
            cache.set(color, material)
        }
        return material
    }
    const tableLegMaterials = new Map<number, THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>()
    const exhibitionAccentMat = track(surfaceMaterial({ color: 0x65d9c8, roughness: 0.38, metalness: 0.35 }))
    const chairMat = track(surfaceMaterial({ color: 0x223060, roughness: 0.75 }))
    const chairLegMat = track(surfaceMaterial({ color: 0x2b2f38, roughness: 0.6, metalness: 0.4 }))
    const tableTopGeo = track(new THREE.BoxGeometry(5.5, 0.24, 3))
    const tableLegGeo = track(new THREE.BoxGeometry(0.28, 1.45, 0.28))
    const chairSeatGeo = track(new THREE.BoxGeometry(0.85, 0.14, 0.85))
    const chairBackGeo = track(new THREE.BoxGeometry(0.85, 0.95, 0.12))
    const chairLegGeo = track(new THREE.BoxGeometry(0.1, 0.62, 0.1))
    const laptopBaseGeo = track(new THREE.BoxGeometry(0.78, 0.06, 0.55))
    const exhibitionInlayGeo = track(new THREE.BoxGeometry(4.85, 0.018, 0.075))
    const laptopAccentGeo = track(new THREE.BoxGeometry(0.26, 0.012, 0.045))
    const laptopScreenGeo = track(new THREE.PlaneGeometry(0.72, 0.48))
    const laptopBodyMat = track(surfaceMaterial({ color: 0x22283e, roughness: 0.4, metalness: 0.5 }))
    const laptopGlowMats = [0x54ffd8, 0x86ff6a, 0x6ab6ff].map((c) =>
        track(new THREE.MeshBasicMaterial({ color: c, toneMapped: false })),
    )
    const contactShadowTex = track(makeCanvasTexture(64, 64, (ctx) => {
        const g = ctx.createRadialGradient(32, 32, 6, 32, 32, 32)
        g.addColorStop(0, "rgba(0,0,0,0.42)")
        g.addColorStop(1, "rgba(0,0,0,0)")
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 64, 64)
    }))
    const contactShadowMat = track(new THREE.MeshBasicMaterial({ map: contactShadowTex, transparent: true, depthWrite: false }))
    const contactShadowGeo = track(new THREE.PlaneGeometry(1, 1))

    /**
     * The room furniture that stands between the camera and the wall screen —
     * the team tables. Framing the screen stands them down
     * so they stop covering the band the text is written in; backing out
     * puts them back. Collected as they are built rather than searched for by
     * name, so a new piece of furniture in front of the screen only has to be
     * pushed here.
     */
    const screenOccluders: THREE.Object3D[] = []
    const tableHitboxes: THREE.Mesh[] = []
    const hitboxGeo = track(new THREE.BoxGeometry(6.4, 2.6, 4))
    const hitboxMat = track(new THREE.MeshBasicMaterial({ visible: false }))

    const chairAt = (group: THREE.Group | THREE.Scene, dx: number, dz: number, rotY: number) => {
        const chair = new THREE.Group()
        const seat = new THREE.Mesh(chairSeatGeo, chairMat)
        seat.position.y = 0.66
        seat.castShadow = true
        chair.add(seat)
        const back = new THREE.Mesh(chairBackGeo, chairMat)
        back.position.set(0, 1.12, -0.38)
        back.castShadow = true
        chair.add(back)
        for (const [lx, lz] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]] as const) {
            const leg = new THREE.Mesh(chairLegGeo, chairLegMat)
            leg.position.set(lx, 0.31, lz)
            chair.add(leg)
        }
        chair.position.set(dx, 0, dz)
        chair.rotation.y = rotY
        group.add(chair)
    }

    PARTICIPANT_TABLES.forEach((tbl, ti) => {
        const cx = toX(tbl.x + tbl.w / 2)
        const cz = toZ(tbl.y + tbl.h / 2)
        const houseDesk = isHouseTable(ti)
        const group = new THREE.Group()
        group.position.set(cx, 0, cz)

        const top = new THREE.Mesh(tableTopGeo, tableMaterial(tableTopColorFor(ti), tableTopMaterials))
        top.position.y = 1.5
        top.castShadow = true
        top.receiveShadow = true
        group.add(top)
        // The house desks keep the same silhouette and lighting, with pale
        // furniture finishes plus a slim teal inlay and matching laptop marks.
        if (houseDesk) {
            const inlay = new THREE.Mesh(exhibitionInlayGeo, exhibitionAccentMat)
            inlay.position.set(0, 1.632, -1.28)
            group.add(inlay)
        }
        for (const [lx, lz] of [[-2.45, -1.2], [2.45, -1.2], [-2.45, 1.2], [2.45, 1.2]] as const) {
            const leg = new THREE.Mesh(tableLegGeo, tableMaterial(tableLegColorFor(ti), tableLegMaterials, 0.85))
            leg.position.set(lx, 0.72, lz)
            leg.castShadow = true
            group.add(leg)
        }

        // soft contact shadow to ground the table
        const cShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat)
        cShadow.rotation.x = -Math.PI / 2
        cShadow.scale.set(7.2, 4.6, 1)
        cShadow.position.y = 0.011
        group.add(cShadow)

            // two glowing laptops per table, angled toward each long side
            ;[[-1.25, 0.32, 1], [1.25, -0.32, -1]].forEach(([lx, lz, side], li) => {
                const base = new THREE.Mesh(laptopBaseGeo, laptopBodyMat)
                base.position.set(lx!, 1.65, lz!)
                base.rotation.y = side! > 0 ? 0.35 : Math.PI - 0.35
                group.add(base)
                if (houseDesk) {
                    const accent = new THREE.Mesh(laptopAccentGeo, exhibitionAccentMat)
                    accent.position.set(0, 0.037, side! * 0.15)
                    base.add(accent)
                }
                const scr = new THREE.Mesh(laptopScreenGeo, laptopGlowMats[(ti + li) % laptopGlowMats.length]!)
                scr.position.set(lx!, 1.9, lz! - side! * 0.26)
                scr.rotation.y = side! > 0 ? 0.35 : Math.PI - 0.35
                scr.rotation.x = -0.28 * side!
                group.add(scr)
            })

        chairAt(group, 0, -2.15, Math.PI)
        chairAt(group, 0, 2.15, 0)
        chairAt(group, -3.3, 0, Math.PI / 2)
        chairAt(group, 3.3, 0, -Math.PI / 2)

        const hit = new THREE.Mesh(hitboxGeo, hitboxMat)
        hit.position.y = 1.3
        hit.userData.tableIdx = ti
        group.add(hit)
        tableHitboxes.push(hit)
        screenOccluders.push(group)

        scene.add(group)
    })

    // gold highlight square under the selected table
    const highlight = new THREE.Mesh(
        track(new THREE.PlaneGeometry(7.4, 4.9)),
        track(new THREE.MeshBasicMaterial({ map: track(makeHighlightTexture()), transparent: true, depthWrite: false, toneMapped: false })),
    )
    highlight.rotation.x = -Math.PI / 2
    highlight.position.y = 0.02
    highlight.visible = false
    scene.add(highlight)

    // The proximity outline: what the interact button would answer right now.
    // A 1x1 plane scaled per target, so one mesh serves a desk footprint and a
    // plant's base alike. A character keeps the hover tag it already has, and
    // the wall screen is up on the wall rather than on the floor, so neither
    // gets an outline — this marks the things whose target is a floor patch.
    const interactHighlight = new THREE.Mesh(
        track(new THREE.PlaneGeometry(1, 1)),
        track(new THREE.MeshBasicMaterial({
            map: track(makeHighlightTexture()),
            transparent: true,
            depthWrite: false,
            toneMapped: false,
        })),
    )
    interactHighlight.rotation.x = -Math.PI / 2
    interactHighlight.position.y = 0.03
    interactHighlight.visible = false
    scene.add(interactHighlight)

    return { tableHitboxes, screenOccluders, highlight, interactHighlight, contactShadowTex }
}
