// The wall-spanning screen on the front wall: its canvas texture, the
// surround it sits in, and the pair of glows it throws into the room.

import * as THREE from "three"
import type { RoomBoard } from "../wall"
import { ROOM_W, WALL_H } from "./layout"
import type { SceneDeps } from "./deps"
import { pixelTexture } from "./textures"
import { drawScreenCanvas, SCREEN_TEX_H, SCREEN_TEX_W } from "./wall-canvas"

export function buildBigScreen(scene: THREE.Scene, { track, surfaceMaterial }: SceneDeps) {
    // The screen spans the whole front wall — no suspension rods; it IS the
    // wall face, sitting in a full-width surround that runs floor to roof line,
    // where the fascia band caps it. The lit glass starts a unit up, so the
    // surround reads as a plinth rather than the picture bleeding into the
    // carpet.
    const SCREEN_BOTTOM = 1
    const SCREEN_H = WALL_H - SCREEN_BOTTOM
    const SCREEN_W = ROOM_W - 0.8
    const SCREEN_CY = SCREEN_BOTTOM + SCREEN_H / 2
    const screenCanvas = document.createElement("canvas")
    screenCanvas.width = SCREEN_TEX_W
    screenCanvas.height = SCREEN_TEX_H
    const screenCtx = screenCanvas.getContext("2d")!
    drawScreenCanvas(screenCtx, null, null)
    const screenTex = track(pixelTexture(new THREE.CanvasTexture(screenCanvas)) as THREE.CanvasTexture)
    /** Redraw the wall: a bulletin while one is up, otherwise the board. */
    const draw = (board: RoomBoard | null, bulletin: string | null) => {
        drawScreenCanvas(screenCtx, board, bulletin)
        screenTex.needsUpdate = true
    }
    // The surround runs from the floor to the wall head: it is the only thing
    // standing on this face now, so anything it fails to cover is a gap onto
    // the empty world outside. The top is flush with the wall head rather than
    // floating above the roof.
    const frameBottom = 0
    const frameH = WALL_H - frameBottom
    const screenFrame = new THREE.Mesh(
        track(new THREE.BoxGeometry(ROOM_W, frameH, 0.3)),
        track(surfaceMaterial({ color: 0x10162e, roughness: 0.5, metalness: 0.4 })),
    )
    screenFrame.position.set(0, frameBottom + frameH / 2, 0.16)
    scene.add(screenFrame)
    const screen = new THREE.Mesh(
        track(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H)),
        track(new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false })),
    )
    screen.position.set(0, SCREEN_CY, 0.33)
    scene.add(screen)

    // Twice the glass, twice the throw: a pair of glows so the wall-wide screen
    // lights the room's front end evenly instead of one hot centre pool.
    const screenGlowLights = [-ROOM_W / 4, ROOM_W / 4].map((gx) => {
        const screenGlow = new THREE.PointLight(0x6090ff, 34, 20, 2)
        screenGlow.position.set(gx, SCREEN_CY + 0.6, 2.8)
        scene.add(screenGlow)
        return screenGlow
    })

    return { SCREEN_W, SCREEN_H, SCREEN_CY, screen, draw, screenGlowLights }
}
