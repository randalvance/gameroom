import type { FightState } from "./fight-sim"
import { STAGE_WIDTH, RAIN_WIDTH, ORB_LIFETIME_MS, worldHitbox } from "./fight-sim"
import { breakingNewsGeometry, circleCenter, circleRadius, scanningBeamBox } from "./special-motion"
import type { EffectImages } from "./sprite-loader"

/** Effects use the simulation's sizes and locked target, so tells match hits. */
export function drawSpecialEffects(ctx: CanvasRenderingContext2D, state: FightState, now: number,
  px: (x: number) => number, py: (y: number) => number, layer: "back" | "front", images: EffectImages = {}) {
  if (state.phase !== "fight") return
  const frame = (image: HTMLImageElement | undefined, index: number, x: number, bottom: number, w: number, h: number) => {
    if (!image) return
    const sw = image.naturalWidth / 4
    ctx.drawImage(image, index * sw, 0, sw, image.naturalHeight, x - w / 2, bottom - h, w, h)
  }
  // The outline is the collision circle. Its center and radius stay fixed;
  // only the surface shimmer and lifetime ring animate. Draw the water over
  // the captured fighter with a dark center so their silhouette stays clear.
  for (const orb of state.orbs) {
    const x = px(orb.x), y = py(orb.y), radius = orb.radius
    ctx.save()
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2)
    if (layer === "back") {
      ctx.fillStyle = "rgba(24,132,211,0.15)"; ctx.fill()
    } else {
      ctx.save(); ctx.clip()
      if (images.orb) {
        ctx.globalCompositeOperation = "screen"
        ctx.globalAlpha = (orb.captured === null ? 0.68 : 0.85) + Math.sin(now / 180) * 0.04
        // The generated sphere has a small black margin around its rim.
        ctx.drawImage(images.orb, x - radius * 1.14, y - radius * 1.14, radius * 2.28, radius * 2.28)
      }
      ctx.restore()
      ctx.strokeStyle = orb.captured === null ? "#52cfff" : "#c5faff"; ctx.lineWidth = 2; ctx.stroke()
      ctx.beginPath(); ctx.arc(x, y, radius + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, orb.remainingMs / (orb.lifetimeMs ?? ORB_LIFETIME_MS)))
      ctx.strokeStyle = orb.owner === 0 ? "#9bffff" : "#ffd78d"; ctx.lineWidth = 3; ctx.stroke()
    }
    ctx.restore()
  }
  for (const rain of state.rain) {
    if (rain.ageMs < 0) continue
    const warning = rain.ageMs < rain.warningMs
    if ((warning && layer !== "back") || (!warning && layer !== "front")) continue
    ctx.save()
    const x = px(rain.x), width = RAIN_WIDTH
    if (warning) {
      const progress = rain.ageMs / rain.warningMs
      ctx.fillStyle = `rgba(255,45,62,${0.06 + progress * 0.1})`
      ctx.fillRect(x - width / 2, 0, width, py(0))
      ctx.strokeStyle = "#ff6b77"; ctx.lineWidth = 2; ctx.setLineDash([8, 7])
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, py(0)); ctx.stroke(); ctx.setLineDash([])
      ctx.strokeStyle = "#ffc4c9"; ctx.lineWidth = 3
      ctx.beginPath(); ctx.ellipse(x, py(0), width / 2, 9, 0, 0, Math.PI * 2); ctx.stroke()
    } else {
      const fade = Math.max(0, 1 - (rain.ageMs - rain.warningMs) / rain.activeMs)
      ctx.globalAlpha = fade; ctx.fillStyle = "rgba(255,20,45,0.45)"; ctx.fillRect(x - width / 2, 0, width, py(0))
      ctx.fillStyle = "#ff294e"; ctx.fillRect(x - 8, 0, 16, py(0))
      ctx.fillStyle = "#fff0ee"; ctx.fillRect(x - 2, 0, 4, py(0))
    }
    ctx.restore()
  }
  for (const f of state.fighters) {
    const move = f.move
    if (f.state !== "attack" || !move) continue
    const activeEnd = move.startup + move.active
    const fade = Math.max(0, 1 - Math.max(0, f.moveMs - activeEnd) / Math.max(1, move.recovery))
    const x = px(f.x), feet = py(f.y)
    ctx.save()
    if (layer === "back") {
      if (move.kind === "circle") {
        const radius = circleRadius(f), center = circleCenter(f), cx = px(center.x), cy = py(center.y)
        ctx.globalAlpha = fade * (f.moveMs < move.startup ? 0.45 : 1)
        ctx.fillStyle = "rgba(76,235,215,0.08)"
        ctx.strokeStyle = "#7af9e3"; ctx.lineWidth = 2
        for (const r of [radius, radius * 0.85]) {
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
        }
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill()
        if (f.id === "bernard" && radius > 0) {
          ctx.save(); ctx.globalCompositeOperation = "screen"
          ctx.strokeStyle = "rgba(108,255,211,0.24)"; ctx.lineWidth = 10
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(0, radius - 5), 0, Math.PI * 2); ctx.stroke()
          ctx.strokeStyle = "#e9fff2"; ctx.lineWidth = 1
          ctx.beginPath(); ctx.arc(cx, cy, radius * 0.85, 0, Math.PI * 2); ctx.stroke()
          ctx.restore()
        }
        // A rotating triangle and equation glyphs keep it visibly mathematical.
        ctx.beginPath()
        for (let i = 0; i <= 3; i++) {
          const a = i * Math.PI * 2 / 3 + f.moveMs / 700
          const tx = cx + Math.cos(a) * radius * 0.82, ty = cy + Math.sin(a) * radius * 0.82
          if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty)
        }
        ctx.stroke()
        ctx.font = "bold 16px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#ffe08a"
        const glyphs = ["Σ", "∫", "π", "∞", "Δ", "x²"]
        glyphs.forEach((glyph, i) => {
          const a = i * Math.PI / 3 - f.moveMs / 1000
          ctx.fillText(glyph, cx + Math.cos(a) * radius * 0.93, cy + Math.sin(a) * radius * 0.93)
        })
      }
      if (move.kind === "dash" && f.moveMs >= move.startup && f.moveMs < activeEnd) {
        ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.95
        frame(images.fire, Math.floor(f.animationMs / 70) % 4, x, feet + 12, f.def.width * (f.id === "bernard" ? 3.3 : 2.7), f.def.height * (f.id === "bernard" ? 1.75 : 1.55))
      }
    } else {
      if (move.kind === "iceSlam" && f.moveMs >= move.startup) {
        const impactX = px(f.special?.targetX ?? f.x)
        ctx.globalAlpha = fade; ctx.globalCompositeOperation = "screen"
        const index = Math.min(3, Math.floor((f.moveMs - move.startup) / 100))
        if (f.id === "bernard") {
          const box = worldHitbox(f, move.hitbox)
          ctx.beginPath(); ctx.rect(px(box.x), py(box.y + box.h), box.w, box.h); ctx.clip()
          frame(images.ice, index, px(box.x + box.w / 2), py(box.y), box.w, box.h)
        } else {
          frame(images.ice, index, impactX, py(0) + 5, move.hitbox.w + 40, 140)
        }
      }
      if (move.kind === "dash" && f.moveMs >= move.startup && f.moveMs < activeEnd) {
        ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.65
        frame(images.fire, Math.floor(f.animationMs / 70 + 1) % 4, x, feet + 8, f.def.width * 2.1, f.def.height * 1.35)
      }
      if (move.kind === "beam" && f.id === "bernard" && f.moveMs >= move.startup && f.moveMs < activeEnd) {
        const box = scanningBeamBox(f)
        const left = px(box.x), top = py(box.y + box.h)
        // The scan pose's eye sits above the duckable ribbon. Join them
        // within Bernard's own silhouette (28px < his 31px half-width),
        // before any opponent can touch the unobstructed live hitbox.
        const eyeX = px(f.x + f.facing * 18), eyeY = py(f.y + 128)
        const joinX = px(f.x + f.facing * 28), centerY = py(box.y + box.h / 2)
        // The outer red band is the exact live hitbox. Its bright core
        // scans with that band; there is no extra damaging-looking tail.
        ctx.globalCompositeOperation = "screen"
        ctx.save()
        ctx.beginPath()
        ctx.rect(f.facing === 1 ? joinX : left, top, box.w - 10, box.h)
        ctx.clip()
        ctx.fillStyle = "rgba(255,30,62,0.6)"; ctx.fillRect(left, top, box.w, box.h)
        ctx.fillStyle = "#ff546c"; ctx.fillRect(left, top + box.h * 0.2, box.w, box.h * 0.6)
        ctx.fillStyle = "#fff3e8"; ctx.fillRect(left, top + box.h * 0.42, box.w, box.h * 0.16)
        ctx.restore()
        ctx.lineCap = "butt"
        for (const [width, color] of [[box.h, "rgba(255,30,62,0.6)"], [box.h * 0.6, "#ff546c"], [box.h * 0.16, "#fff3e8"]] as const) {
          ctx.strokeStyle = color; ctx.lineWidth = width
          ctx.beginPath(); ctx.moveTo(eyeX, eyeY); ctx.lineTo(joinX, centerY); ctx.stroke()
        }
        ctx.fillStyle = "#fff3e8"
        ctx.beginPath(); ctx.arc(eyeX, eyeY, 2.5, 0, Math.PI * 2); ctx.fill()
      }
      if (move.kind === "beam" && f.id !== "bernard" && f.moveMs >= move.startup && f.moveMs < activeEnd + 70) {
        const cy = feet - (move.hitbox.y + move.hitbox.h / 2)
        const source = x + f.facing * move.hitbox.x
        ctx.fillStyle = "#99f8ff"
        ctx.globalAlpha = f.moveMs < move.startup ? 0.4 + 0.6 * f.moveMs / move.startup : fade
        ctx.beginPath(); ctx.arc(source, cy, 5 + 2 * Math.sin(now / 35), 0, Math.PI * 2); ctx.fill()
        if (f.moveMs >= move.startup && f.moveMs < activeEnd + 70) {
          const end = px(f.facing === 1 ? STAGE_WIDTH : 0)
          ctx.strokeStyle = "#43dbff"; ctx.lineWidth = move.hitbox.h
          ctx.beginPath(); ctx.moveTo(source, cy); ctx.lineTo(end, cy); ctx.stroke()
          ctx.strokeStyle = "#edffff"; ctx.lineWidth = 3
          ctx.beginPath(); ctx.moveTo(source, cy); ctx.lineTo(end, cy); ctx.stroke()
        }
      }
    }
    if (move.kind === "breakingNews") {
      const geometry = breakingNewsGeometry(f)
      const { explosion, safeColumn, phase } = geometry
      if (layer === "back" && phase !== "recovery") {
        if (phase === "charge" || phase === "flight") {
          ctx.fillStyle = `rgba(255,92,65,${0.22 + Math.sin(now / 110) * 0.08})`
          ctx.fillRect(px(explosion.x), py(0) - 8, explosion.w, 8)
          ctx.strokeStyle = "#ffc86b"; ctx.lineWidth = 2; ctx.setLineDash([8, 6])
          ctx.strokeRect(px(explosion.x), py(explosion.y + explosion.h), explosion.w, explosion.h)
          ctx.setLineDash([])
        }
        ctx.fillStyle = "rgba(83,255,188,0.09)"
        ctx.fillRect(px(safeColumn.x), py(safeColumn.y + safeColumn.h), safeColumn.w, safeColumn.h)
        ctx.fillStyle = "#8affce"; ctx.fillRect(px(safeColumn.x), py(0) - 5, safeColumn.w, 5)
        ctx.font = "bold 11px monospace"; ctx.textAlign = "center"
        ctx.fillText("SAFE", px(safeColumn.x + safeColumn.w / 2), py(0) + 19)
      }
      if (layer === "front" && (phase === "charge" || phase === "flight")) {
        const bx = px(geometry.ballX), by = py(geometry.ballY), radius = geometry.radius
        ctx.globalCompositeOperation = "screen"
        // Concentric translucent shells make a glow without blurring the
        // pixel art. The exact radius is always one of the visible rings.
        for (const [scale, color] of [[1.16, "rgba(255,64,28,0.12)"], [1, "#fd6b35"], [0.84, "#ffb74e"], [0.6, "#ffe292"], [0.32, "#fffbe1"]] as const) {
          ctx.fillStyle = color
          ctx.beginPath(); ctx.arc(bx, by, radius * scale, 0, Math.PI * 2); ctx.fill()
        }
        ctx.strokeStyle = "#fff3b9"; ctx.lineWidth = 2
        for (let ray = 0; ray < 8; ray++) {
          const angle = ray * Math.PI / 4 + now / 700
          ctx.beginPath()
          ctx.moveTo(bx + Math.cos(angle) * radius * 0.82, by + Math.sin(angle) * radius * 0.82)
          ctx.lineTo(bx + Math.cos(angle + 0.12) * radius * 1.12, by + Math.sin(angle + 0.12) * radius * 1.12)
          ctx.stroke()
        }
        if (phase === "charge") {
          ctx.font = "bold 15px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#fff3b9"
          ctx.fillText("BREAKING NEWS", bx, by - radius - 15)
        }
      }
      if (layer === "front" && (phase === "explosion" || phase === "recovery")) {
        const left = px(explosion.x), top = py(explosion.y + explosion.h)
        const center = left + explosion.w / 2, ground = py(explosion.y)
        const progress = geometry.progress
        const opacity = phase === "recovery" ? (1 - progress) ** 2 : 1
        // The sprite's footprint stays inside the real blast, preserving the
        // safe space beneath Bernard. Recovery shows only fading embers.
        ctx.beginPath(); ctx.rect(left, top, explosion.w, explosion.h); ctx.clip()
        ctx.globalCompositeOperation = "screen"
        if (images.explosion) {
          const image = images.explosion, sw = image.naturalWidth / 2, sh = image.naturalHeight / 2
          const position = phase === "recovery" ? 3 : progress * 3
          const index = Math.min(3, Math.floor(position)), blend = position - index
          // Four cells in a 2×2 atlas. Ground contact is at 74% of each cell;
          // align that point with the floor instead of floating on its gutter.
          const drawFrame = (cell: number, alpha: number) => {
            if (alpha <= 0) return
            ctx.globalAlpha = opacity * alpha
            ctx.drawImage(image, cell % 2 * sw, Math.floor(cell / 2) * sh, sw, sh,
              left, top, explosion.w, explosion.h / 0.74)
          }
          drawFrame(index, 1 - blend)
          if (index < 3) drawFrame(index + 1, blend)
        } else {
          // Keep a shaped blast if the asset has not loaded: jagged nested
          // flame silhouettes, never an opaque rectangle or a reused charge.
          ctx.globalAlpha = opacity
          for (const [scale, color] of [[1, "#f25a20"], [0.76, "#ffbb43"], [0.4, "#fff4c1"]] as const) {
            ctx.fillStyle = color; ctx.beginPath()
            for (let i = 0; i <= 32; i++) {
              const angle = i * Math.PI / 16
              const edge = (i % 2 ? 0.72 : 1) * scale
              const bx = center + Math.cos(angle) * explosion.w * 0.48 * edge
              const by = ground - explosion.h * 0.45 + Math.sin(angle) * explosion.h * 0.45 * edge
              if (i === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by)
            }
            ctx.closePath(); ctx.fill()
          }
        }
        if (phase === "explosion") {
          ctx.globalAlpha = (1 - progress) * 0.8
          ctx.strokeStyle = "#fff1b0"; ctx.lineWidth = 3
          ctx.beginPath(); ctx.ellipse(center, ground - 4, explosion.w * (0.25 + progress * 0.24), 8 + progress * 14, 0, 0, Math.PI * 2); ctx.stroke()
        }
      }
    }
    ctx.restore()
  }
}
