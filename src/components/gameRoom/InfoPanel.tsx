// Selection-info UI for the game room.
// FF1-style bottom panel showing what was clicked: an agent, or a desk.
import { useCoarsePointer } from "~/components/gameRoom3d/TouchControls"
import { bubbleTextFor, effectiveStatus, styleFor, type Agent, type StatusStyleOverrides } from "~/lib/agents"
import type { RoomSelection } from "~/components/gameRoom3d/selection"

export type { RoomSelection }

function FF1Panel({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  // The touch game-pad floats over the panel's lower-left corner — pad the
  // content up clear of it so a short character card is not hidden behind it.
  const coarsePointer = useCoarsePointer()
  return (
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "#020814", borderTop: "3px solid #2840A8", boxShadow: "0 -4px 0 #5070E0 inset", padding: coarsePointer ? "12px 16px calc(132px + env(safe-area-inset-bottom))" : "12px 16px 14px", zIndex: 10, maxHeight: coarsePointer ? "60%" : "42%", overflowY: "auto" }}>
      {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([rx, ry], i) => (
        <div key={i} style={{ position: "absolute", [rx ? "right" : "left"]: 4, [ry ? "bottom" : "top"]: 4, width: 8, height: 8,
          borderTop: ry ? "none" : "2px solid #5070E0", borderBottom: ry ? "2px solid #5070E0" : "none",
          borderLeft: rx ? "none" : "2px solid #5070E0", borderRight: rx ? "2px solid #5070E0" : "none" }} />
      ))}
      <button onClick={onClose} style={{ position: "absolute", top: 8, right: 14, fontFamily: "var(--font-display)", fontSize: 9, background: "transparent", border: "1px solid #2840A8", color: "#5070E0", cursor: "pointer", padding: "2px 6px", letterSpacing: "0.06em" }}>✕ CLOSE</button>
      {children}
    </div>
  )
}

const D: React.CSSProperties = { fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: "0.06em" }
const B: React.CSSProperties = { fontFamily: "var(--font-body)", fontSize: 18, lineHeight: 1.3 }

interface RoomInfoPanelProps {
  selected: RoomSelection
  agents: readonly Agent[]
  statusStyles?: StatusStyleOverrides
  onClose: () => void
}

export function RoomInfoPanel({ selected, agents, statusStyles, onClose }: RoomInfoPanelProps) {
  if (!selected || selected.type !== "agent") return null
  const agent = agents.find((candidate) => candidate.id === selected.id)
  if (!agent) return null
  const status = effectiveStatus(agent, agents)
  const style = styleFor(status, statusStyles)
  const line = bubbleTextFor(agent, style)
  const parent = agent.parentId ? agents.find((candidate) => candidate.id === agent.parentId) : undefined
  return (
    <FF1Panel onClose={onClose}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 auto" }}>
          <div style={{ ...D, color: "#FFD040", marginBottom: 6 }}>&gt; AGENT</div>
          <div data-testid="info-agent-name" style={{ ...D, fontSize: 13, color: "#FFF", marginBottom: 4 }}>{agent.name.toUpperCase()}</div>
          <div data-testid="info-agent-status" style={{ ...B, color: style.halo ?? "#7080C0", fontSize: 16 }}>
            {status.toUpperCase()}
            {status !== agent.status ? ` (${agent.status.toUpperCase()}, A SUB-AGENT IS WORKING)` : ""}
          </div>
          {line && <div style={{ ...B, color: "#A0B8FF", fontSize: 16 }}>{line}</div>}
          {parent && <div style={{ ...B, color: "#7080C0", fontSize: 14 }}>FOLLOWS {parent.name.toUpperCase()}</div>}
        </div>
      </div>
    </FF1Panel>
  )
}
