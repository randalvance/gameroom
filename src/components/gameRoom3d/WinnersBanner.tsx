// The flash over the room when the gamemaster reads out a place: the placing
// and the team's name, big, on every screen — whatever the player's camera
// happens to be pointed at.
//
// Same reasoning as PresentationBanner: the wall and the desk numeral carry
// the same news in the scene, but the point of the ceremony is that nobody
// in the room can miss who came third, so it is DOM, over the canvas.
import { useEffect, useState } from "react"
import { rankNumeralCssColor } from "./rank-numerals"
import {
  latestAnnouncement,
  podiumLabel,
  roomWinners,
  type PodiumPlace,
  type WinnersState,
} from "~/lib/winners-ceremony"

/** How long the flash stays up before settling into a corner chip. */
export const WINNERS_FLASH_MS = 6000

interface WinnersBannerProps {
  winners: WinnersState | null
  teams: readonly { id: string; name: string }[]
}

/** What the banner reads for a state, or null before the first place is out. */
export function winnersBannerText(
  winners: WinnersState | null,
  teams: readonly { id: string; name: string }[],
): { place: PodiumPlace; name: string } | null {
  if (!winners) return null
  const latest = latestAnnouncement(winners)
  if (!latest) return null
  const room = roomWinners(winners, teams)
  const entry = room?.podium.find((candidate) => candidate.place === latest.place)
  if (!entry) return null
  return { place: latest.place, name: teams[entry.teamIdx]?.name ?? "" }
}

export function WinnersBanner({ winners, teams }: WinnersBannerProps) {
  const text = winnersBannerText(winners, teams)
  // Keyed on the place so each announcement restarts the flash even when the
  // previous one had already settled.
  const key = text ? `${winners?.nonce}:${text.place}` : null
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (!key) return
    setFlashing(true)
    const timer = setTimeout(() => setFlashing(false), WINNERS_FLASH_MS)
    return () => clearTimeout(timer)
  }, [key])
  if (!text) return null
  const color = rankNumeralCssColor(text.place)

  return (
    <div
      data-testid="winners-banner"
      data-flashing={flashing ? "true" : "false"}
      data-place={text.place}
      aria-live="polite"
      style={{
        position: "absolute",
        left: "50%",
        top: flashing ? "34%" : 12,
        transform: flashing ? "translate(-50%, -50%) scale(1)" : "translate(-50%, 0) scale(0.62)",
        transformOrigin: "top center",
        zIndex: 12,
        pointerEvents: "none",
        textAlign: "center",
        padding: flashing ? "18px 34px" : "8px 18px",
        background: "rgba(2, 5, 16, 0.92)",
        border: `3px solid ${color}`,
        boxShadow: `6px 6px 0 #000, 0 0 ${flashing ? 42 : 12}px ${color}`,
        transition: "top 480ms ease, transform 480ms ease, padding 480ms ease, box-shadow 480ms ease",
        animation: flashing ? "winners-banner-flash 700ms steps(2, jump-none) 4" : undefined,
        maxWidth: "min(92vw, 720px)",
      }}
    >
      <style>{`@keyframes winners-banner-flash { from { filter: brightness(1); } to { filter: brightness(1.6); } }`}</style>
      <div style={{ fontFamily: "var(--font-display)", fontSize: flashing ? 12 : 8, color, letterSpacing: "0.12em" }}>
        {text.place === 1 ? "★ CHAMPIONS · " : "◆ "}{podiumLabel(text.place)}{text.place === 1 ? " ★" : " ◆"}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: flashing ? "clamp(22px, 4.6vw, 44px)" : 14,
          color: "#FFFFFF",
          marginTop: 8,
          lineHeight: 1.2,
          overflowWrap: "anywhere",
        }}
      >
        {text.name}
      </div>
    </div>
  )
}
