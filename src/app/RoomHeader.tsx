// The bar above the room. Entirely the host's: the library draws nothing up
// here, which is why <GameRoom> takes it as a prop. The demo uses it for the
// runtime's own controls — pause the pretend agents, raise a bulletin — and
// a live count of what needs a human.

import { countByStatus, type Agent } from "~/lib/agents"

export function RoomHeader({
  agents,
  running,
  onToggleRunning,
  onBulletin,
  onLeave,
}: {
  agents: readonly Agent[]
  /** The pretend runtime is changing agents on a timer. */
  running: boolean
  onToggleRunning: () => void
  /** Put the room's headline on the wall. */
  onBulletin: () => void
  onLeave: () => void
}) {
  const counts = countByStatus(agents)
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
  const button = (label: string, onClick: () => void, color = "var(--color-sky)") => (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: `2px solid ${color}`,
        color,
        fontFamily: "var(--font-display)",
        fontSize: 9,
        letterSpacing: "0.06em",
        padding: "6px 10px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
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
      {button("← LEAVE", onLeave)}
      <div style={{ flex: 1, minWidth: 0 }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {chip(`${agents.length} AGENTS`, "var(--color-blue)", "#FFF")}
        {chip(`${counts.working} WORKING`, "var(--color-neon)", "#000")}
        {counts.waiting > 0 && chip(`${counts.waiting} WAITING FOR YOU`, "#FFB020", "#000")}
        {counts.error > 0 && chip(`${counts.error} IN TROUBLE`, "var(--color-danger)", "#FFF")}
        {button("◆ BULLETIN", onBulletin, "var(--color-coin)")}
        {button(running ? "❚❚ PAUSE" : "▶ RESUME", onToggleRunning)}
      </div>
    </header>
  )
}
