// The way in: a name, a character, and a door.
//
// The picker is the library's <CharacterPicker> — the same component the event
// site handed students, and the same one an organizer used to assign a
// character to somebody else. All the host provides is where a pick is SAVED,
// which here is localStorage.

import { useState } from "react"
import { CharacterPicker } from "~/components/character/CharacterPicker"
import type { Identity } from "./identity"

export function Wardrobe({
  identity,
  loading,
  onChange,
  onEnter,
  onConsole,
}: {
  identity: Identity
  /** The roster is still on its way from the hub. */
  loading: boolean
  onChange: (identity: Identity) => void
  onEnter: () => void
  onConsole: () => void
}) {
  const [name, setName] = useState(identity.name)
  const ready = identity.spriteId !== null && name.trim().length > 0

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--color-ink)",
        padding: "clamp(16px, 4vw, 40px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
      }}
    >
      <header style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10 }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(14px, 3vw, 22px)",
            color: "var(--color-coin)",
            letterSpacing: "0.08em",
            margin: 0,
          }}
        >
          THE GAME ROOM
        </h1>
        <p style={{ color: "#9AA4D4", margin: 0, fontSize: 16 }}>
          Pick a character, walk in, and see what the agents are up to.
          Three things in there are not signposted — that is the point.
        </p>
      </header>

      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 10, color: "var(--color-sky)" }}>
          NAME
        </span>
        <input
          value={name}
          maxLength={24}
          placeholder="What everyone calls you"
          onChange={(event) => {
            setName(event.target.value)
            onChange({ ...identity, name: event.target.value })
          }}
          style={{
            background: "#000",
            border: "2px solid var(--color-card)",
            color: "#FFF",
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            padding: "8px 10px",
            minWidth: 240,
          }}
        />
      </label>

      <div style={{ width: "min(1100px, 100%)" }}>
        <CharacterPicker
          spriteId={identity.spriteId}
          spriteSheet={null}
          choose={async (spriteId) => {
            onChange({ ...identity, spriteId })
            return { ok: true as const }
          }}
          onSaved={() => {}}
          footer={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                disabled={!ready || loading}
                onClick={onEnter}
                style={{
                  background: ready && !loading ? "var(--color-neon)" : "#000",
                  border: `3px solid ${ready && !loading ? "var(--color-neon)" : "#1A1F38"}`,
                  color: ready && !loading ? "#000" : "#5D6699",
                  fontFamily: "var(--font-display)",
                  fontSize: 12,
                  letterSpacing: "0.08em",
                  padding: "14px 26px",
                  cursor: ready && !loading ? "pointer" : "default",
                }}
              >
                {loading ? "SEATING THE ROOM…" : "ENTER THE ROOM →"}
              </button>
              {!ready && (
                <span style={{ fontSize: 11, color: "#5D6699" }}>
                  A name and a character, then the door opens.
                </span>
              )}
              <button
                type="button"
                onClick={onConsole}
                style={{
                  background: "transparent",
                  border: "2px solid #1A2450",
                  color: "#9AA4D4",
                  fontFamily: "var(--font-display)",
                  fontSize: 9,
                  letterSpacing: "0.06em",
                  padding: "8px 14px",
                  cursor: "pointer",
                }}
              >
                GAMEMASTER CONSOLE →
              </button>
            </div>
          }
        />
      </div>
    </main>
  )
}
