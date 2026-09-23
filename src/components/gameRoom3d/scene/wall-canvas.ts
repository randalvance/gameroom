// What the wall screen shows, drawn onto a canvas: the board, or a bulletin.

import { roomTitle } from "../room-branding"
import { BOARD_MAX_LINES, type RoomBoard } from "../wall"
import { TEXT_BRIGHT } from "./textures"

// The wall-spanning screen: canvas keeps the plane's ~4:1 aspect at a
// resolution where the countdown digits survive the bigger surface.
export const SCREEN_TEX_W = 1920
export const SCREEN_TEX_H = 468

/**
 * How far down the canvas the readable content may run.
 *
 * The screen reaches the roof, but its bottom edge runs down behind the
 * surround's plinth and the near rows of the room, so anything below this
 * line is read by nobody. Everything legible lives above it; the band
 * underneath is deliberately empty panel.
 */
const SCREEN_CONTENT_BOTTOM = 330

/** Greedy word wrap into at most `maxLines` lines; a longer text is elided. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    for (const word of words) {
        const at = lines.length - 1
        const candidate = at < 0 ? word : `${lines[at]} ${word}`
        if (at < 0 || ctx.measureText(candidate).width > maxWidth) lines.push(word)
        else lines[at] = candidate
    }
    const visible = lines.slice(0, maxLines)
    if (lines.length > visible.length && visible.length > 0) {
        visible[visible.length - 1] = `${visible[visible.length - 1]!.replace(/[.…]+$/, "")}…`
    }
    return visible
}

/**
 * The wall: a bulletin while one is up, otherwise the board — the host's
 * title and lines, or the room's own title over an empty band.
 */
export function drawScreenCanvas(ctx: CanvasRenderingContext2D, board: RoomBoard | null, bulletin: string | null) {
    const W = SCREEN_TEX_W, H = SCREEN_TEX_H
    ctx.fillStyle = "#020510"
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = "#3050c8"
    ctx.lineWidth = 8
    ctx.strokeRect(8, 8, W - 16, H - 16)
    ctx.textAlign = "center"
    if (bulletin) {
        ctx.fillStyle = "#A51F32"
        ctx.fillRect(12, 12, W - 24, 88)
        ctx.fillStyle = "#FFF4F4"
        ctx.font = "bold 56px 'Courier New', monospace"
        ctx.fillText("◆ ANNOUNCEMENT ◆", W / 2, 75)
        ctx.fillStyle = TEXT_BRIGHT
        ctx.font = "bold 46px 'Courier New', monospace"
        // Three lines from here still finish above SCREEN_CONTENT_BOTTOM.
        wrapLines(ctx, bulletin, W - 180, 3).forEach((line, index) => ctx.fillText(line, W / 2, 175 + index * 60, W - 180))
        return
    }
    ctx.fillStyle = TEXT_BRIGHT
    ctx.font = "bold 96px 'Courier New', monospace"
    // The camera's usual framing clips the top of the panel, so the title
    // sits a little lower than the panel's own centre line would put it.
    ctx.fillText(board?.title ?? roomTitle(), W / 2, 150, W - 160)
    ctx.fillStyle = "#2840A8"
    ctx.fillRect(90, 188, W - 180, 5)
    ctx.fillStyle = "#A0B8FF"
    ctx.font = "44px 'Courier New', monospace"
    const lines = (board?.lines ?? []).slice(0, BOARD_MAX_LINES)
    lines.forEach((line, index) => ctx.fillText(line, W / 2, 238 + index * 46, W - 180))
    // The panel below the content fades out rather than ending on a hard edge,
    // so the part down by the plinth reads as screen, not as a gap.
    const skirt = ctx.createLinearGradient(0, SCREEN_CONTENT_BOTTOM + 24, 0, H)
    skirt.addColorStop(0, "rgba(40,64,168,0.20)")
    skirt.addColorStop(1, "rgba(4,8,24,0)")
    ctx.fillStyle = skirt
    ctx.fillRect(12, SCREEN_CONTENT_BOTTOM + 24, W - 24, H - SCREEN_CONTENT_BOTTOM - 36)
}
