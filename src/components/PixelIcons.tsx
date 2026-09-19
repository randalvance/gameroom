// Bare icon buttons and the stroke icons they hold, shared by the console's
// bot cards and session controls.
//
// IconBtn has none of PixelBtn's chrome — no fill, border or shadow — so the
// icon is the whole affordance. That is what lets a control sit beside a
// 22px timer bar or inside a five-across bot card without towering over it.
// Feedback is in the stroke: dimmed at rest, full on hover, and it steps down
// a pixel on press the way the pixel buttons do. 28px square keeps a
// finger-sized target around a 16px glyph without a visible box.
//
// Icons are outlines on a 16px grid, drawn with currentColor so each inherits
// its button's colour — the colour IS the state signal (neon to arm, red to
// disarm or end), so a screen reader gets the same fact from the title.
import { useId, useState, type CSSProperties, type ReactNode } from "react"

export function IconBtn({ title, color, disabled, onClick, style, children }: {
  title: string
  color: string
  disabled?: boolean
  onClick: () => void
  style?: CSSProperties
  children: ReactNode
}) {
  const [hover, setHover] = useState(false)
  const [pressed, setPressed] = useState(false)
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, padding: 0,
        background: "transparent", border: "none", boxShadow: "none",
        color,
        opacity: disabled ? 0.3 : hover ? 1 : 0.75,
        transform: pressed ? "translate(1px,1px)" : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "opacity 60ms steps(2)",
        ...style,
      }}
    >
      {children}
    </button>
  )
}

const ICON = {
  width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
  stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round",
} as const

export function FloppyIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M2.5 2.5h8.5l2.5 2.5v8.5h-11z" />
      <path d="M5 2.5v3.5h5v-3.5" />
      <path d="M4.5 13.5v-4.5h7v4.5" />
    </svg>
  )
}

export function MegaphoneIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M2.5 6.5h3l6-3.5v10l-6-3.5h-3z" />
      <path d="M4.5 9.5v3.5h2.5v-2.5" />
      <path d="M13.5 6.5v3" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  )
}

export function PlayIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
  )
}

export function PauseIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="3" y="2.5" width="3.5" height="11" />
      <rect x="9.5" y="2.5" width="3.5" height="11" />
    </svg>
  )
}

export function StopIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" />
    </svg>
  )
}

export function NotepadIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="3" y="2.5" width="10" height="11" />
      <path d="M5.5 1.5v2M8 1.5v2M10.5 1.5v2" />
      <path d="M5.5 7h5M5.5 10h3.5" />
    </svg>
  )
}

// A question mark that opens a popup on hover. A native title tooltip is
// the wrong tool for this: browsers delay it, keep it tiny, and flatten
// newlines into one run — ten parameter descriptions came out as a
// paragraph. This renders the lines itself, in the console's own style.
//
// It is an image with a label, not a button: hovering (or focusing, for a
// keyboard) is the whole interaction, and role="img" plus aria-label is what
// a screen reader announces; the popup content is aria-describedby so it is
// read too.
export function HelpIcon({ label, lines, width = 340 }: { label: string; lines: string[]; width?: number }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span
      role="img"
      aria-label={label}
      aria-describedby={open ? id : undefined}
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={{ position: "relative", display: "inline-flex", color: "var(--color-sky)", cursor: "help", lineHeight: 0 }}
    >
      <svg {...ICON} width={12} height={12}>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M6.2 6.3a1.9 1.9 0 0 1 3.7.5c0 1.2-1.9 1.4-1.9 2.6" />
        <path d="M8 11.6h.01" />
      </svg>
      {open && (
        <div
          id={id}
          role="tooltip"
          data-testid="help-popup"
          style={{
            position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 30,
            width, padding: "10px 12px",
            background: "#000", border: "2px solid var(--color-card)", boxShadow: "4px 4px 0 #000",
            fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.5, letterSpacing: 0,
            color: "#E8ECFF", textTransform: "none", whiteSpace: "normal",
            display: "flex", flexDirection: "column", gap: 4,
          }}
        >
          {lines.map((line) => {
            // "Name — what it does": the name in sky, the rest in white.
            const [name, ...rest] = line.split(" — ")
            return (
              <div key={line}>
                <span style={{ color: "var(--color-sky)" }}>{name}</span>
                {rest.length > 0 && <span> — {rest.join(" — ")}</span>}
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}
