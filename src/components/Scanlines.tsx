export function Scanlines() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
        background:
          "repeating-linear-gradient(to bottom, transparent 0, transparent 3px, rgba(0,0,0,0.28) 3px, rgba(0,0,0,0.28) 4px)",
        mixBlendMode: "multiply",
      }}
    />
  )
}
