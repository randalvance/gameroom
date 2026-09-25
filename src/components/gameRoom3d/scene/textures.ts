// The canvas-drawn textures the room is dressed in: carpet, rugs, name tags,
// speech bubbles, the highlight square — and the pixel-art texture settings
// every sheet loads with.

import * as THREE from "three"
import { ROOM_D, ROOM_W } from "./layout"

export function pixelTexture(tex: THREE.Texture): THREE.Texture {
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

export function makeCanvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    const ctx = c.getContext("2d")!
    draw(ctx)
    const tex = new THREE.CanvasTexture(c)
    return pixelTexture(tex) as THREE.CanvasTexture
}

// deterministic tiny PRNG so the floor/wood noise is stable
export function mulberry(seed: number) {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** A soft round spot for dust motes: bright core, feathered edge. */
export function makeSparkTexture(): THREE.CanvasTexture {
    const size = 32
    const c = document.createElement("canvas")
    c.width = c.height = size
    const ctx = c.getContext("2d")!
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, "rgba(255,255,255,1)")
    g.addColorStop(0.35, "rgba(255,255,255,0.7)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

export function makeCarpetTexture(): THREE.CanvasTexture {
    const rnd = mulberry(7)
    const tones = ["#63666c", "#6a6d73", "#5e6167", "#666a70"]
    const tex = makeCanvasTexture(128, 128, (ctx) => {
        // grey carpet tiles with fibre speckle
        for (let ty = 0; ty < 4; ty++) {
            for (let tx = 0; tx < 4; tx++) {
                ctx.fillStyle = tones[Math.floor(rnd() * tones.length)]!
                ctx.fillRect(tx * 32, ty * 32, 32, 32)
                ctx.fillStyle = "rgba(0,0,0,0.16)"
                ctx.fillRect(tx * 32, ty * 32, 32, 1)
                ctx.fillRect(tx * 32, ty * 32, 1, 32)
                for (let i = 0; i < 170; i++) {
                    ctx.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.09)"
                    ctx.fillRect(tx * 32 + Math.floor(rnd() * 32), ty * 32 + Math.floor(rnd() * 32), 1, 1)
                }
            }
        }
    })
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(ROOM_W / 8, ROOM_D / 8)
    return tex
}

export function makeRugTexture(): THREE.CanvasTexture {
    return makeCanvasTexture(128, 64, (ctx) => {
        ctx.fillStyle = "#1a2350"
        ctx.fillRect(0, 0, 128, 64)
        ctx.strokeStyle = "#c8a040"
        ctx.lineWidth = 2
        ctx.strokeRect(4, 4, 120, 56)
        ctx.strokeStyle = "#2c3a78"
        ctx.strokeRect(9, 9, 110, 46)
        const rnd = mulberry(21)
        for (let i = 0; i < 220; i++) {
            ctx.fillStyle = "rgba(0,0,0,0.14)"
            ctx.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 64), 1, 1)
        }
    })
}

/**
 * The brightest any text in the room is allowed to be drawn.
 *
 * Pure white (#FFFFFF) made the wall screen's headline, the team names and
 * the floating name tags read as lit signage rather than lettering. This
 * off-white sits near 0.67 linear luminance, so text is drawn and not lit.
 */
export const TEXT_BRIGHT = "#CBD6EC"

export function makeNameTagTexture(name: string): THREE.CanvasTexture {
    const label = (name.split(" ")[0] ?? name).toUpperCase()
    return makeCanvasTexture(256, 64, (ctx) => {
        ctx.font = "bold 26px 'Courier New', monospace"
        const tw = Math.min(210, ctx.measureText(label).width)
        const bw = tw + 44
        const x0 = (256 - bw) / 2
        ctx.fillStyle = "rgba(4,8,24,0.92)"
        ctx.fillRect(x0, 10, bw, 42)
        ctx.strokeStyle = "#3050c8"
        ctx.lineWidth = 3
        ctx.strokeRect(x0, 10, bw, 42)
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillStyle = TEXT_BRIGHT
        ctx.fillText(label, 128, 33, 210)
    })
}

export function makeSpeechTexture(text: string): THREE.CanvasTexture {
    const W = 384, H = 112
    return makeCanvasTexture(W, H, (ctx) => {
        ctx.font = "bold 21px 'Courier New', monospace"
        // Greedy word wrap into at most three lines; anything longer is elided.
        const words = text.split(/\s+/)
        const lines: string[] = []
        let line = ""
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word
            if (ctx.measureText(candidate).width <= W - 48 || !line) {
                line = candidate
                continue
            }
            lines.push(line)
            line = word
            if (lines.length === 3) break
        }
        if (lines.length < 3 && line) lines.push(line)
        else if (line && lines[2]) lines[2] = `${lines[2]}…`

        const boxH = 26 * lines.length + 18
        const boxY = H - 14 - boxH
        ctx.fillStyle = "rgba(4,8,24,0.94)"
        ctx.fillRect(10, boxY, W - 20, boxH)
        ctx.strokeStyle = "#FFD040"
        ctx.lineWidth = 3
        ctx.strokeRect(12, boxY + 2, W - 24, boxH - 4)
        // the little tail that points the bubble at its speaker
        ctx.fillStyle = "#FFD040"
        ctx.beginPath()
        ctx.moveTo(W / 2 - 9, H - 14)
        ctx.lineTo(W / 2 + 9, H - 14)
        ctx.lineTo(W / 2, H - 2)
        ctx.closePath()
        ctx.fill()
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillStyle = TEXT_BRIGHT
        lines.forEach((l, i) => {
            ctx.fillText(l, W / 2, boxY + 22 + i * 26, W - 56)
        })
    })
}

export function makeHighlightTexture(): THREE.CanvasTexture {
    return makeCanvasTexture(128, 128, (ctx) => {
        ctx.strokeStyle = "#FFD040"
        ctx.lineWidth = 5
        ctx.strokeRect(6, 6, 116, 116)
        ctx.strokeStyle = "rgba(255,208,64,0.35)"
        ctx.lineWidth = 12
        ctx.strokeRect(12, 12, 104, 104)
    })
}

export async function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
    const tex = await loader.loadAsync(url)
    return pixelTexture(tex)
}
