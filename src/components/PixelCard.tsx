import type { CSSProperties, ReactNode } from "react"

type PixelCardProps = {
  featured?: boolean
  children: ReactNode
  style?: CSSProperties
}

export function PixelCard({ featured, children, style }: PixelCardProps) {
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: "3px solid #000",
        boxShadow: "6px 6px 0 #000",
        padding: "16px 18px",
        position: "relative",
        color: "#FFF",
        ...style,
      }}
    >
      {featured && (
        <div
          style={{
            position: "absolute",
            top: -3,
            left: -3,
            right: -3,
            height: 6,
            background: "var(--color-neon)",
          }}
        />
      )}
      {children}
    </div>
  )
}
