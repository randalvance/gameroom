import type { ReactNode } from "react"

type PixelTagProps = {
  children: ReactNode
  color?: string
  fg?: string
  /** "sm" is for dense rows — a bot card's five stock tags — where the
      standard size does not fit on one line. */
  size?: "md" | "sm"
}

export function PixelTag({
  children,
  color = "var(--color-card)",
  fg = "var(--color-sky)",
  size = "md",
}: PixelTagProps) {
  const sm = size === "sm"
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: sm ? 9 : 11,
        padding: sm ? "3px 6px" : "4px 8px",
        border: `1px solid ${fg}`,
        background: color,
        color: fg,
      }}
    >
      {children}
    </span>
  )
}
