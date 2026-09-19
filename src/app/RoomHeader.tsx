// The bar above the room. Entirely the host's: the library draws nothing up
// here, which is why <GameRoom> takes it as a prop.

export function RoomHeader({
  players,
  teams,
  onLeave,
}: {
  players: number
  teams: number
  onLeave: () => void
}) {
  const chip = (label: string, background: string, color: string) => (
    <span
      key={label}
      style={{
        fontFamily: "var(--font-display)",
        fontSize: 8,
        padding: "4px 7px",
        background,
        color,
        border: "2px solid #000",
        letterSpacing: "0.06em",
      }}
    >
      {label}
    </span>
  )

  return (
    <header
      style={{
        background: "#000",
        borderBottom: "4px solid var(--color-blue)",
        padding: "10px clamp(12px, 3vw, 24px)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onLeave}
        style={{
          background: "transparent",
          border: "2px solid var(--color-sky)",
          color: "var(--color-sky)",
          fontFamily: "var(--font-display)",
          fontSize: 9,
          letterSpacing: "0.06em",
          padding: "6px 10px",
          cursor: "pointer",
        }}
      >
        ← LEAVE
      </button>
      <div style={{ flex: 1, minWidth: 0 }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {chip(`${players} CHARACTERS`, "#9AA4D4", "#000")}
        {chip(`${teams} DESKS`, "var(--color-blue)", "#FFF")}
        {chip("◆ LIVE", "var(--color-neon)", "#000")}
      </div>
    </header>
  )
}
