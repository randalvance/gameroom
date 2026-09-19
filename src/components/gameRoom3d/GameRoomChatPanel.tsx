// The room's chat, lower right: a short scrollable stream of what everyone
// has said, and — for players with a character — an input that opens on
// Enter. A sent line comes back on the SSE stream as a `chat` event, which is
// what appends it here and floats the bubble over the speaker; there is no
// local echo, so the stream shows exactly what the room saw.

import { useEffect, useRef, useState } from "react"
import { CHAT_MAX_LEN } from "~/lib/gameRoomNet/protocol"
import { useCoarsePointer } from "./TouchControls"
import type { GameRoomChatLine } from "./useGameRoomNet"

/** Keep the collapsed stream to roughly this many lines; the rest scroll. */
const STREAM_MAX_HEIGHT = 132

export function GameRoomChatPanel({
  log,
  canChat,
  onSend,
}: {
  log: GameRoomChatLine[]
  canChat: boolean
  onSend: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Touch has no Enter key: the chat affordance is a tap target, and the
  // panel sits above the on-screen game-pad instead of on top of it.
  const coarsePointer = useCoarsePointer()
  const inputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  // Follow new messages only while the reader is at the bottom — scrolling up
  // to re-read must not be yanked back down by the next line.
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const el = streamRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [log])

  // Enter opens the chat box. Window-level like the movement keys: the canvas
  // never holds focus, and the guards keep other text fields unaffected.
  useEffect(() => {
    if (!canChat) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.altKey || e.ctrlKey || e.metaKey) return
      const t = e.target
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [canChat])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const send = () => {
    const text = inputRef.current?.value.trim() ?? ""
    if (text) onSend(text)
    setOpen(false)
  }

  if (log.length === 0 && !canChat) return null

  return (
    <div
      style={{
        position: "absolute",
        right: 14,
        // Leave breathing room above the screen edge, or, on touch, clear the
        // interact/zoom cluster.
        bottom: coarsePointer ? "calc(148px + env(safe-area-inset-bottom))" : 64,
        zIndex: 12,
        width: 300,
        maxWidth: "calc(100vw - 28px)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {log.length > 0 && (
        <div
          ref={streamRef}
          aria-label="Room chat"
          onScroll={(e) => {
            const el = e.currentTarget
            stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          style={{
            maxHeight: STREAM_MAX_HEIGHT,
            overflowY: "auto",
            background: "rgba(2, 5, 16, 0.82)",
            border: "2px solid #2840A8",
            boxShadow: "4px 4px 0 #000",
            padding: "7px 9px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {log.map((line) => (
            <div key={line.seq} style={{ fontSize: 13, lineHeight: 1.35, color: "#C8CEEF", overflowWrap: "anywhere" }}>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 8,
                  letterSpacing: "0.05em",
                  color: line.self ? "var(--color-neon)" : "#FFD040",
                  marginRight: 6,
                }}
              >
                {line.name.toUpperCase()}
              </span>
              {line.text}
            </div>
          ))}
        </div>
      )}

      {canChat && (open ? (
        <input
          ref={inputRef}
          type="text"
          maxLength={CHAT_MAX_LEN}
          placeholder="Say something…"
          aria-label="Chat message"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              send()
            } else if (e.key === "Escape") {
              e.preventDefault()
              setOpen(false)
            }
          }}
          onBlur={() => setOpen(false)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "rgba(2, 5, 16, 0.94)",
            border: "2px solid #5070E0",
            boxShadow: "4px 4px 0 #000",
            outline: "none",
            padding: "8px 10px",
            fontFamily: "var(--font-body)",
            fontSize: 15,
            color: "#FFF",
          }}
        />
      ) : (
        <button
          onClick={() => setOpen(true)}
          style={{
            alignSelf: "flex-end",
            fontFamily: "var(--font-display)",
            fontSize: 8,
            letterSpacing: "0.06em",
            color: "#5D6699",
            textShadow: "1px 1px 0 #000",
            background: "transparent",
            border: "none",
            padding: coarsePointer ? "6px 4px" : 0,
            cursor: "pointer",
          }}
        >
          {coarsePointer ? "TAP → CHAT" : "ENTER → CHAT"}
        </button>
      ))}
    </div>
  )
}
