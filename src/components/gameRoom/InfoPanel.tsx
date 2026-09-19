// Selection-info UI for the game room.
// FF1-style bottom panel showing character / team details.
import { useEffect, useState } from "react"
import { useCoarsePointer } from "~/components/gameRoom3d/TouchControls"
import { type FlatPlayer, type TeamDTO } from "~/lib/event-types"

export type RoomSelection = { type: "player"; idx: number } | { type: "team"; idx: number } | null

type FbEntry = { mentorName: string; gip: boolean; comment: string; ts: number }
export type FbStore = Record<string, FbEntry[]>

export function useLocalFeedbacks(): FbStore {
  const [feedbacks, setFeedbacks] = useState<FbStore>({})
  useEffect(() => {
    try {
      const s = localStorage.getItem("c2i_feedback")
      if (s) setFeedbacks(JSON.parse(s))
    } catch { /* ignore */ }
  }, [])
  return feedbacks
}

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
  teams: TeamDTO[]
  allPlayers: FlatPlayer[]
  feedbacks: FbStore
  onClose: () => void
}

export function RoomInfoPanel({ selected, teams, allPlayers, feedbacks, onClose }: RoomInfoPanelProps) {
  if (!selected) return null
  if (selected.type === "player") {
    const p = allPlayers[selected.idx]
    if (!p) return null
    const team = teams[p.teamIdx]
    if (!team) return null
    return (
      <FF1Panel onClose={onClose}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ ...D, color: "#FFD040", marginBottom: 6 }}>&gt; CHARACTER INFO</div>
            <div style={{ ...D, fontSize: 13, color: "#FFF", marginBottom: 4 }}>{p.name.toUpperCase()}</div>
            <div style={{ ...B, color: "#7080C0", fontSize: 16 }}>{team.name}</div>
          </div>
        </div>
      </FF1Panel>
    )
  }
  const team = teams[selected.idx]
  if (!team) return null
  return (
    <FF1Panel onClose={onClose}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 auto" }}>
          <div style={{ ...D, color: "#FFD040", marginBottom: 6 }}>&gt; TEAM INFO</div>
          <div style={{ ...D, fontSize: 13, color: "#FFF", marginBottom: 4 }}>{team.name}</div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ ...D, color: "#3050C8", marginBottom: 6 }}>&gt; ROSTER</div>
          {team.players.map((p) => {
            const pE = feedbacks[p.id] ?? []
            const gy = pE.filter((e) => e.gip).length
            return (
              <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 5, padding: "4px 6px", background: "#080C1E", border: "1px solid #1A2050" }}>
                <span style={{ ...B, fontSize: 17, color: "#FFF", flex: 1 }}>{p.name}</span>
                {gy > 0 && <span style={{ ...D, fontSize: 8, color: "#39FF14" }}>★{gy}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </FF1Panel>
  )
}
