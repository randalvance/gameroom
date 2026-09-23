// The gamemaster's console.
//
// One card: put music on the PA and push a bulletin at the room. Every
// button is a command to the hub, so what it changes is the ROOM — open this
// in a second window and watch the first one obey.
//
// The host supplies the frame and the toasts; the panel supplies the controls.

import { useEffect, useState } from "react"
import { GameRoomControlPanel } from "~/components/gamemasterConsole/GameRoomControlPanel"
import type { Agent } from "~/lib/agents"

interface Toast {
  id: number
  message: string
  color: string
}

/** How long a toast stays up. Long enough to read a refusal. */
const TOAST_MS = 6000

export function Console({ agents, onBack }: { agents: readonly Agent[]; onBack: () => void }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    if (toasts.length === 0) return
    const id = window.setTimeout(() => setToasts((all) => all.slice(1)), TOAST_MS)
    return () => window.clearTimeout(id)
  }, [toasts])

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--color-ink)",
        padding: "clamp(16px, 3vw, 32px)",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            background: "transparent",
            border: "2px solid var(--color-sky)",
            color: "var(--color-sky)",
            fontFamily: "var(--font-display)",
            fontSize: 9,
            letterSpacing: "0.06em",
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          ← BACK
        </button>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 14,
            color: "var(--color-coin)",
            letterSpacing: "0.08em",
            margin: 0,
          }}
        >
          GAMEMASTER · GAME ROOM
        </h1>
        <span style={{ color: "#5D6699", fontSize: 14 }}>
          {agents.length} agents in the room · drives every screen in it
        </span>
      </header>

      <GameRoomControlPanel
        onToast={(message, color) =>
          setToasts((all) => [...all, { id: Date.now() + all.length, message, color: color ?? "var(--color-neon)" }])
        }
      />

      <div style={{ position: "fixed", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 50 }}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            style={{
              background: "#000",
              border: `2px solid ${toast.color}`,
              color: toast.color,
              boxShadow: "6px 6px 0 #000",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              padding: "10px 14px",
              maxWidth: 420,
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </main>
  )
}
