// Animated walk-cycle preview of a character sheet. Each requested row
// (facing direction) plays its walk frames on a pixelated canvas: the
// 0→1→2→1 ping-pong across the three walk columns, leaving the attack and
// hurt columns out of the loop. See sheetFormatFor().
//
// `src` is any image the browser can load — a stored data URL, or a path like
// /assets/room/characters/char_0.png. Same-origin either way, so the canvas
// never taints.

import { useEffect, useRef, useState } from "react"
import { sheetFormatFor, type SheetFormat } from "~/components/gameRoom/spriteIndex"
import { SPRITE_CELL_H, SPRITE_CELL_W } from "~/lib/sprite-gen"

const STEP_MS = 160
const GAP = 8
const ALL_ROWS = [0, 1, 2, 3]

/**
 * Canvas pixel size, both before the sheet decodes and after. The pre-decode
 * guess is the sheet CONTRACT rather than a square cell, so for a conforming
 * sheet the two agree and React never rewrites width/height — which matters
 * beyond avoiding a reflow: rewriting either one resets the 2D context and
 * turns image smoothing back on underneath the running draw loop. Exported so
 * that agreement is testable without a canvas.
 */
export function previewCanvasSize(
  format: SheetFormat | null,
  rows: number[],
  scale: number,
): { width: number; height: number } {
  const cellW = (format?.cellW ?? SPRITE_CELL_W) * scale
  const cellH = (format?.cellH ?? SPRITE_CELL_H) * scale
  const drawn = format ? rows.filter((r) => r >= 0 && r < format.rows).length : rows.length
  const shown = Math.max(1, drawn)
  return { width: shown * cellW + (shown - 1) * GAP, height: cellH }
}

export function SpriteWalkPreview({
  src,
  scale = 3,
  rows = ALL_ROWS,
  label = "Walking animation preview",
}: {
  /** Sheet image — a transparent (already keyed) data URL, or a URL. */
  src: string
  /** Integer upscale per cell. */
  scale?: number
  /** Which direction rows to animate, left to right. Rows the sheet does not
   * have are skipped, so a 4-row request against a 3-row legacy strip simply
   * draws three. */
  rows?: number[]
  label?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Canvas dimensions follow the sheet, so they are only known after decode.
  const [format, setFormat] = useState<SheetFormat | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf = 0
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const fmt = sheetFormatFor(img.width, img.height)
      setFormat(fmt)
      const cellW = fmt.cellW * scale
      const cellH = fmt.cellH * scale
      const start = performance.now()
      const draw = (now: number) => {
        // Re-asserted EVERY frame, not once before the loop starts. Setting
        // canvas.width/height resets the 2D context to its defaults —
        // smoothing back ON — and this canvas is sized from React state that
        // lands one render AFTER the image decodes that starts this loop. Set
        // once up front, the very next resize silently un-sharpened every
        // subsequent frame, which is exactly how the preview went blurry.
        ctx.imageSmoothingEnabled = false
        const step = Math.floor((now - start) / STEP_MS)
        const frame = fmt.walkFrame(step)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        rows.forEach((row, i) => {
          if (row < 0 || row >= fmt.rows) return
          ctx.drawImage(
            img,
            frame * fmt.cellW,
            row * fmt.cellH,
            fmt.cellW,
            fmt.cellH,
            i * (cellW + GAP),
            0,
            cellW,
            cellH,
          )
        })
        raf = requestAnimationFrame(draw)
      }
      raf = requestAnimationFrame(draw)
    }
    img.src = src
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
    // rows by content, not identity — callers pass fresh literals each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, scale, rows.join(",")])

  const { width, height } = previewCanvasSize(format, rows, scale)
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      width={width}
      height={height}
      style={{ imageRendering: "pixelated" }}
    />
  )
}
