import type { CSSProperties, ReactNode } from "react"

type BadgeProps = {
  color?: string
  fg?: string
  children: ReactNode
  style?: CSSProperties
}

export function Badge({
  color = "var(--color-neon)",
  fg = "#000",
  children,
  style,
}: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-display)",
        fontSize: 10,
        letterSpacing: "0.06em",
        padding: "5px 8px",
        background: color,
        color: fg,
        border: "2px solid #000",
        ...style,
      }}
    >
      {children}
    </span>
  )
}
