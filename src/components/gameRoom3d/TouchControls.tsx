// On-screen game-pad for touch devices: a D-pad on the lower left and an
// interact button (with zoom) on the lower right. In walk mode the pad and
// button mirror WASD and Space for the local character; in pan mode they
// drive the spectator camera and centre-select. Rendered only for coarse
// pointers — a mouse user keeps the keyboard legend instead.
import { useEffect, useRef, useState } from "react"
import type { RoomCameraPanAction } from "./camera-pan"
import { TOUCH_PAN_REPEAT_MS } from "./touch-controls"

export type TouchPadDirection = "up" | "down" | "left" | "right"

/** One press on the pad, as the Konami-code listener hears it: a D-pad
 * direction, or the A button (TALK / INTERACT). */
export type TouchPadPress = TouchPadDirection | "talk"

/** True on touch-first devices, where the on-screen pad replaces the keyboard. */
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)")
}

/** True while the viewport is taller than it is wide. */
export function useIsPortrait(): boolean {
  return useMediaQuery("(orientation: portrait)")
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])
  return matches
}

/**
 * Full-screen "turn your phone" gate for touch devices held in portrait: the
 * room is a wide diorama and the D-pad + interact cluster need the width. A
 * web page cannot truly lock orientation (iOS has no lock API; elsewhere it
 * needs fullscreen), so the room makes a best-effort lock attempt and
 * otherwise blocks with this prompt until the phone turns.
 */
export function RotateToLandscape() {
  // Best-effort native lock — rejects outside fullscreen/PWA; the overlay is
  // the mechanism that actually works everywhere.
  useEffect(() => {
    try {
      (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
        .lock?.("landscape").catch(() => {})
    } catch { /* no lock API */ }
  }, [])
  return (
    <div
      role="alert"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "#020510",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div aria-hidden style={{ fontSize: 44, color: "#5070E0", transform: "rotate(90deg)" }}>⟳</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "#FFF", letterSpacing: "0.08em" }}>
        &gt; ROTATE YOUR PHONE
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 9, color: "#9AA4D4", letterSpacing: "0.06em", lineHeight: 1.8 }}>
        THE GAME ROOM PLAYS IN LANDSCAPE
      </div>
    </div>
  )
}

const PAD_BUTTON_BASE: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  color: "#9AA4D4",
  border: "2px solid #5070E0",
  boxShadow: "3px 3px 0 #000",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTapHighlightColor: "transparent",
  cursor: "pointer",
}

function PadButton({
  label,
  ariaLabel,
  onPressStart,
  onPressEnd,
  style,
}: {
  label: React.ReactNode
  ariaLabel: string
  onPressStart: () => void
  /** Omitted for one-shot buttons that fire entirely on press. */
  onPressEnd?: () => void
  style?: React.CSSProperties
}) {
  const [pressed, setPressed] = useState(false)
  const release = () => {
    setPressed(false)
    onPressEnd?.()
  }
  return (
    <button
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        // Best-effort: capture keeps a hold alive if the finger slides off,
        // but a fast tap can land here after its pointer is already gone, and
        // that must not swallow the press.
        try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* inactive pointer */ }
        setPressed(true)
        onPressStart()
      }}
      onPointerUp={release}
      onPointerCancel={release}
      // Belt and braces for a held button: whatever ends the press — lift,
      // cancel, capture loss, or the pointer wandering off — stops the hold.
      onLostPointerCapture={release}
      onPointerLeave={release}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        ...PAD_BUTTON_BASE,
        background: pressed ? "#2840A8" : "rgba(2, 5, 16, 0.85)",
        color: pressed ? "#FFF" : "#9AA4D4",
        ...style,
      }}
    >
      {label}
    </button>
  )
}

interface RoomTouchControlsProps {
  /**
   * Walking the local character: the D-pad holds a movement input (the sim
   * loop does the moving) and the A button talks. Otherwise the pad steps the
   * spectator camera on a repeat timer and A selects.
   */
  walkMode: boolean
  onWalk: (direction: TouchPadDirection, active: boolean) => void
  onPan: (action: RoomCameraPanAction) => void
  onZoom: (action: "in" | "out") => void
  onInteract: () => void
  /**
   * Every discrete press on the D-pad or the A button, once per press however
   * long it is held — the room's Konami-code listener, which has no keyboard
   * to hear on a phone. Independent of walk/pan mode.
   */
  onPadPress?: (press: TouchPadPress) => void
}

export function RoomTouchControls({ walkMode, onWalk, onPan, onZoom, onInteract, onPadPress }: RoomTouchControlsProps) {
  // One repeater is enough: a second finger on another arrow simply takes
  // over, and every release stops it. Walking needs none — held state is
  // continuous by itself — but a release must still clear a stale repeater
  // when control arrives mid-hold.
  const repeatRef = useRef<number | null>(null)
  const stopRepeat = () => {
    if (repeatRef.current !== null) {
      clearInterval(repeatRef.current)
      repeatRef.current = null
    }
  }
  useEffect(() => stopRepeat, [])

  const pressDir = (direction: TouchPadDirection) => {
    onPadPress?.(direction)
    if (walkMode) {
      onWalk(direction, true)
      return
    }
    stopRepeat()
    onPan(direction)
    repeatRef.current = window.setInterval(() => onPan(direction), TOUCH_PAN_REPEAT_MS)
  }
  const releaseDir = (direction: TouchPadDirection) => {
    onWalk(direction, false)
    stopRepeat()
  }

  const arrow = (direction: TouchPadDirection, label: string, gridArea: string) => (
    <PadButton
      key={direction}
      label={label}
      ariaLabel={`${walkMode ? "Walk" : "Pan"} ${direction}`}
      onPressStart={() => pressDir(direction)}
      onPressEnd={() => releaseDir(direction)}
      style={{ gridArea, width: 52, height: 52, fontSize: 16 }}
    />
  )

  const bottom = "calc(16px + env(safe-area-inset-bottom))"
  return (
    <>
      <div
        aria-label={walkMode ? "Walk pad" : "Camera pan pad"}
        style={{
          position: "absolute",
          bottom,
          left: 14,
          zIndex: 12,
          display: "grid",
          gridTemplateAreas: `". up ." "left down right"`,
          gap: 6,
        }}
      >
        {arrow("up", "▲", "up")}
        {arrow("left", "◀", "left")}
        {arrow("down", "▼", "down")}
        {arrow("right", "▶", "right")}
      </div>

      <div
        style={{
          position: "absolute",
          bottom,
          right: 14,
          zIndex: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <PadButton
            label="−"
            ariaLabel="Zoom out"
            onPressStart={() => onZoom("out")}
            style={{ width: 44, height: 44, fontSize: 18 }}
          />
          <PadButton
            label="+"
            ariaLabel="Zoom in"
            onPressStart={() => onZoom("in")}
            style={{ width: 44, height: 44, fontSize: 18 }}
          />
        </div>
        <PadButton
          label={
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <span style={{ fontSize: 20 }}>A</span>
              <span style={{ fontSize: 7, letterSpacing: "0.08em" }}>{walkMode ? "TALK" : "INTERACT"}</span>
            </span>
          }
          ariaLabel={walkMode ? "Talk to who you are facing" : "Interact with what is in front of you"}
          onPressStart={() => {
            onPadPress?.("talk")
            onInteract()
          }}
          style={{ width: 64, height: 64, borderRadius: "50%", border: "3px solid #5070E0" }}
        />
      </div>
    </>
  )
}
