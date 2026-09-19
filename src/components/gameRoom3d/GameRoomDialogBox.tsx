// The RPG conversation box: fixed to the lower part of the room, speaker's
// name in the top-left tab, text revealed word by word. Shown only to the two
// participants of a conversation (spectators get the small in-world bubble);
// while it is open, both characters stand frozen — the hub enforces that, the
// scene mirrors it, and this is the player's explanation of why.
//
// Once the text has finished, the interact button (Space/E) dismisses the
// conversation early for both sides instead of waiting out the timer.
// (Enter deliberately doesn't: it opens the chat box.)

import { useEffect, useMemo, useState } from "react"
import { DIALOG_WORD_INTERVAL_MS } from "~/lib/gameRoomNet/protocol"
import { useCoarsePointer } from "./TouchControls"
import type { GameRoomDialog } from "./useGameRoomNet"

export function GameRoomDialogBox({
  dialog,
  onDismiss,
}: {
  dialog: GameRoomDialog | null
  onDismiss?: () => void
}) {
  if (!dialog) return null
  return <TypewriterPanel key={dialog.seq} dialog={dialog} onDismiss={onDismiss} />
}

function TypewriterPanel({ dialog, onDismiss }: { dialog: GameRoomDialog; onDismiss?: () => void }) {
  const words = useMemo(() => dialog.text.split(/\s+/).filter(Boolean), [dialog.text])
  const [shown, setShown] = useState(1)
  const done = shown >= words.length
  // Touch has no Space: the finished box itself becomes the dismiss button,
  // and it sits above the on-screen game-pad instead of on top of it.
  const coarsePointer = useCoarsePointer()

  useEffect(() => {
    if (done) return
    const timer = setInterval(
      () => setShown((n) => Math.min(words.length, n + 1)),
      DIALOG_WORD_INTERVAL_MS,
    )
    return () => clearInterval(timer)
  }, [done, words.length])

  // The interact button closes a finished dialog. Registered only once the
  // text is done, so mid-typewriter presses keep doing nothing.
  useEffect(() => {
    if (!done || !onDismiss) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const key = e.key.toLowerCase()
      if (key !== " " && key !== "e") return
      e.preventDefault()
      onDismiss()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [done, onDismiss])

  return (
    <div
      role="dialog"
      aria-label={`${dialog.name} says`}
      onClick={done ? onDismiss : undefined}
      style={{
        position: "absolute",
        bottom: coarsePointer ? "calc(150px + env(safe-area-inset-bottom))" : 22,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(680px, calc(100% - 28px))",
        zIndex: 12,
        // Mid-typewriter the box stays transparent to input, like the keys.
        pointerEvents: done && onDismiss ? "auto" : "none",
        cursor: done && onDismiss ? "pointer" : "default",
      }}
    >
      <div
        style={{
          position: "relative",
          background: "rgba(2, 5, 16, 0.94)",
          border: "3px solid #5070E0",
          outline: "2px solid #04081A",
          boxShadow: "6px 6px 0 #000",
          padding: "18px 16px 14px",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: -12,
            left: 10,
            padding: "3px 8px",
            background: "#2840A8",
            border: "2px solid #5070E0",
            color: "#FFD040",
            fontFamily: "var(--font-display)",
            fontSize: 9,
            letterSpacing: "0.08em",
          }}
        >
          {dialog.name.toUpperCase()}
        </span>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 19,
            lineHeight: 1.45,
            color: "#FFF",
            minHeight: "2.9em",
          }}
        >
          {words.slice(0, shown).join(" ")}
          {done && <BlinkCue />}
        </div>
        {done && (
          <span
            style={{
              position: "absolute",
              bottom: -10,
              right: 10,
              padding: "2px 7px",
              background: "#04081A",
              border: "2px solid #2840A8",
              color: "#5D6699",
              fontFamily: "var(--font-display)",
              fontSize: 8,
              letterSpacing: "0.06em",
            }}
          >
            {coarsePointer ? "TAP ▸" : "SPACE ▸"}
          </span>
        )}
      </div>
    </div>
  )
}

function BlinkCue() {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const timer = setInterval(() => setOn((v) => !v), 450)
    return () => clearInterval(timer)
  }, [])
  return (
    <span aria-hidden style={{ color: "#FFD040", marginLeft: 8, opacity: on ? 1 : 0 }}>
      ▼
    </span>
  )
}
