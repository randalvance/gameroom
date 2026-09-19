import { useState, type CSSProperties, type ReactNode } from "react"

export type PixelBtnVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost" | "skyGhost" | "coin"

const PALETTE: Record<PixelBtnVariant, { bg: string; fg: string; sh: string; border: string }> = {
  primary:     { bg: "var(--color-neon)",   fg: "#000",                sh: "#000",                border: "#000" },
  secondary:   { bg: "var(--color-blue)",   fg: "#FFF",                sh: "#000",                border: "#000" },
  ghost:       { bg: "transparent",         fg: "var(--color-neon)",   sh: "#1FAA00",             border: "var(--color-neon)" },
  danger:      { bg: "var(--color-danger)", fg: "#FFF",                sh: "#000",                border: "#000" },
  dangerGhost: { bg: "transparent",         fg: "var(--color-danger)", sh: "#B00000",             border: "var(--color-danger)" },
  skyGhost:    { bg: "transparent",         fg: "var(--color-sky)",    sh: "#27408B",             border: "var(--color-sky)" },
  coin:        { bg: "var(--color-coin)",   fg: "#000",                sh: "#000",                border: "#000" },
}

type PixelBtnProps = {
  variant?: PixelBtnVariant
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  style?: CSSProperties
  type?: "button" | "submit" | "reset"
  /** Tooltip and accessible name. Required for an icon-only button, which
      otherwise has no name a screen reader can announce. */
  title?: string
}

export function PixelBtn({
  variant = "primary",
  children,
  onClick,
  disabled,
  active,
  style,
  type = "button",
  title,
}: PixelBtnProps) {
  const p = PALETTE[variant]
  const [hover, setHover] = useState(false)
  const [pressed, setPressed] = useState(false)
  return (
    <button
      type={type}
      title={title}
      aria-label={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--font-display)",
        fontSize: 12,
        letterSpacing: "0.05em",
        padding: "12px 18px",
        border: `4px solid ${active ? "var(--color-coin)" : p.border}`,
        background: active ? "#1A1500" : p.bg,
        color: active ? "var(--color-coin)" : p.fg,
        boxShadow: pressed ? `0 0 0 ${p.sh}` : hover ? `6px 6px 0 ${p.sh}` : `4px 4px 0 ${p.sh}`,
        transform: pressed ? "translate(4px,4px)" : hover ? "translate(-2px,-2px)" : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "transform 60ms steps(2), box-shadow 60ms steps(2)",
        textTransform: "uppercase",
        userSelect: "none",
        ...style,
      }}
    >
      {children}
    </button>
  )
}
