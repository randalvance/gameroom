// The flash over the room when the gamemaster puts a team under the
// spotlight: the team's slot and name, big, on every screen — whatever the
// player's camera happens to be pointed at.
//
// The 3D scene does the same on the wall and over the desk, but the wall is
// behind the near rows from most cameras and the desk numeral is a few pixels
// tall from across the room. The point of the flash is that nobody in the
// room can miss whose turn it is, so it is DOM, over the canvas, and it does
// not care where you are standing.
import { useEffect, useState } from "react"
import { ordinal, PRESENTATION_CSS_COLOR, roomPresentation, type PresentationState } from "~/lib/presentation-order"

/** How long the flash stays up before settling into a corner chip. */
export const BANNER_FLASH_MS = 4000

interface PresentationBannerProps {
  presentation: PresentationState | null
  teams: readonly { id: string; name: string }[]
}

/** What the banner reads for a state, or null when nobody is on stage. */
export function bannerText(
  presentation: PresentationState | null,
  teams: readonly { id: string; name: string }[],
): { slot: number; total: number; name: string } | null {
  const room = roomPresentation(presentation, teams)
  if (!presentation || !room || room.spotlightTeamIdx === null) return null
  const slot = room.order.indexOf(room.spotlightTeamIdx) + 1
  if (slot === 0) return null
  return { slot, total: room.order.length, name: teams[room.spotlightTeamIdx]?.name ?? "" }
}

export function PresentationBanner({ presentation, teams }: PresentationBannerProps) {
  const text = bannerText(presentation, teams)
  // Keyed on the team so a new spotlight restarts the flash even when the
  // previous one had already settled.
  const key = text ? `${presentation?.nonce}:${presentation?.spotlight}` : null
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (!key) return
    setFlashing(true)
    const timer = setTimeout(() => setFlashing(false), BANNER_FLASH_MS)
    return () => clearTimeout(timer)
  }, [key])
  if (!text) return null

  return (
    <div
      data-testid="presentation-banner"
      data-flashing={flashing ? "true" : "false"}
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
        border: `3px solid ${PRESENTATION_CSS_COLOR}`,
        boxShadow: `6px 6px 0 #000, 0 0 ${flashing ? 42 : 12}px ${PRESENTATION_CSS_COLOR}`,
        transition: "top 480ms ease, transform 480ms ease, padding 480ms ease, box-shadow 480ms ease",
        animation: flashing ? "presentation-banner-flash 700ms steps(2, jump-none) 4" : undefined,
        maxWidth: "min(92vw, 720px)",
      }}
    >
      <style>{`@keyframes presentation-banner-flash { from { filter: brightness(1); } to { filter: brightness(1.6); } }`}</style>
      <div style={{ fontFamily: "var(--font-display)", fontSize: flashing ? 12 : 8, color: PRESENTATION_CSS_COLOR, letterSpacing: "0.12em" }}>
        NOW PRESENTING · {ordinal(text.slot)} OF {text.total}
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
