// The arcade cabinet that appears beside Primey when the Konami code lands.
//
// A private prop: it exists only in the scene of whoever entered the code,
// so like Primey it is NOT in lib/gameRoomNet/objects.ts — nothing about it
// is hub-owned, and a key that escaped would be an unknown idx rather than
// someone else's target. Built on reveal, out of primitives and one canvas
// texture; the mini-game itself is behind a separate dynamic import in the
// route and is never a scene dependency.

import * as THREE from "three"
import { TILE } from "../gameRoom/constants"
import { PRIMEY_POINT } from "./primey-npc"

type Track = <T extends { dispose(): void }>(resource: T) => T

/**
 * The cabinet's interact key. Clear of the hub's object range (100_000+),
 * the wall screen (200_000) and Primey (300_000).
 */
export const ARCADE_IDX = 400_000

/**
 * Where the cabinet stands, in room-plan px: two carpet tiles east of Primey
 * on the same row, so "right next to Primey" is literal and it never buries
 * the mascot in the interact probe (which takes the nearest candidate).
 */
export const ARCADE_POINT = {
  x: PRIMEY_POINT.x + 4 * TILE,
  y: PRIMEY_POINT.y,
} as const

/** The plane the cabinet's marquee texture is drawn on. */
const MARQUEE_W = 256
const MARQUEE_H = 64

function drawScreen(): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#05060f"
  ctx.fillRect(0, 0, 128, 128)
  // a tiny two-fighter silhouette with health bars, as attract mode would show
  ctx.fillStyle = "#ffd166"
  ctx.fillRect(8, 10, 46, 6)
  ctx.fillRect(74, 10, 46, 6)
  ctx.fillStyle = "#c8382e"
  ctx.fillRect(28, 60, 18, 40)
  ctx.beginPath(); ctx.arc(37, 52, 9, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#2f4bd6"
  ctx.fillRect(82, 58, 22, 42)
  ctx.beginPath(); ctx.arc(93, 49, 10, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#bfff5e"
  ctx.font = "bold 13px monospace"
  ctx.textAlign = "center"
  ctx.fillText("INSERT COIN", 64, 118)
  ctx.fillStyle = "rgba(255,255,255,0.08)"
  for (let y = 0; y < 128; y += 3) ctx.fillRect(0, y, 128, 1)
  return canvas
}

function drawMarquee(): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = MARQUEE_W
  canvas.height = MARQUEE_H
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#2840a8"
  ctx.fillRect(0, 0, MARQUEE_W, MARQUEE_H)
  ctx.fillStyle = "#ffd166"
  ctx.font = "bold 26px monospace"
  ctx.textAlign = "center"
  ctx.fillText("IMPACT HACKERS", MARQUEE_W / 2, 42)
  return canvas
}

/** Small prop: a stand-up cabinet, screen facing south (toward the camera). */
export function createArcadeCabinet(track: Track): THREE.Group {
  const cabinet = new THREE.Group()
  const shell = track(new THREE.MeshLambertMaterial({ color: 0x1b2450 }))
  const trim = track(new THREE.MeshLambertMaterial({ color: 0x5070e0 }))
  const dark = track(new THREE.MeshLambertMaterial({ color: 0x0b0f2c }))
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), material)
    mesh.name = name
    mesh.position.set(x, y, z)
    cabinet.add(mesh)
    return mesh
  }
  // body: a lower pedestal, a slanted control deck, an upright head
  box("pedestal", 1.6, 1.4, 1.2, 0, 0.7, 0, shell)
  box("deck", 1.7, 0.2, 0.9, 0, 1.5, 0.25, trim)
  box("head", 1.6, 1.6, 0.9, 0, 2.5, -0.15, shell)
  box("side-l", 0.08, 3.3, 1.25, -0.84, 1.65, -0.05, trim)
  box("side-r", 0.08, 3.3, 1.25, 0.84, 1.65, -0.05, trim)
  box("kick", 1.5, 0.15, 1.1, 0, 0.08, 0, dark)
  // joystick + buttons on the deck
  const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6)), trim)
  stick.position.set(-0.4, 1.75, 0.3)
  cabinet.add(stick)
  const ball = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 8, 6)), track(new THREE.MeshLambertMaterial({ color: 0xff5d5d })))
  ball.position.set(-0.4, 1.92, 0.3)
  cabinet.add(ball)
  const buttonMats = [0xffd166, 0xbfff5e, 0x8fd3ff].map((color) => track(new THREE.MeshLambertMaterial({ color })))
  buttonMats.forEach((material, i) => {
    const button = new THREE.Mesh(track(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8)), material)
    button.position.set(0.05 + i * 0.25, 1.62, 0.3)
    cabinet.add(button)
  })
  // the screen: a glowing plane inset in the head, facing +z (south)
  const screenTex = track(new THREE.CanvasTexture(drawScreen()))
  const screen = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1.25, 1.1)),
    track(new THREE.MeshBasicMaterial({ map: screenTex })),
  )
  screen.name = "arcade-screen"
  screen.position.set(0, 2.55, 0.31)
  cabinet.add(screen)
  // marquee above the screen
  const marqueeTex = track(new THREE.CanvasTexture(drawMarquee()))
  const marquee = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1.5, 0.38)),
    track(new THREE.MeshBasicMaterial({ map: marqueeTex })),
  )
  marquee.position.set(0, 3.15, 0.31)
  cabinet.add(marquee)
  // floating prompt, the same style as the hatch's sign
  const label = document.createElement("canvas")
  label.width = 512
  label.height = 96
  const lctx = label.getContext("2d")!
  lctx.fillStyle = "#111a4d"
  lctx.fillRect(0, 0, 512, 96)
  lctx.fillStyle = "#ffd166"
  lctx.font = "bold 25px monospace"
  lctx.textAlign = "center"
  lctx.fillText("★ IMPACT HACKERS", 256, 37)
  lctx.font = "20px monospace"
  lctx.fillText("SPACE / E / A · INSERT COIN", 256, 73)
  const labelTex = track(new THREE.CanvasTexture(label))
  const sign = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: labelTex, depthTest: false })))
  sign.name = "arcade-sign"
  sign.scale.set(5.4, 1.02, 1)
  sign.position.set(0, 4.1, 0)
  cabinet.add(sign)
  return cabinet
}
