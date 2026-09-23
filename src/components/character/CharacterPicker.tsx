// The character chooser: the sprite pool, and a zero-decision RANDOMLY PICK
// underneath.
//
// ONE UI, whoever is choosing. The host says where a pick is SAVED — that is
// the `choose` prop — so an admin assigning a character to somebody else picks
// from exactly what that person would have picked from, rather than from a
// second, thinner control that drifts from it.
//
// The grid SCROLLS INSIDE its panel (132 walking previews would otherwise make
// the page ~2000px tall, with the confirm button buried at the bottom —
// observed live before this layout) so PLAY AS THIS ONE is always in view.
//
// The event site this came from also had an AI generator column, backed by a
// ComfyUI pipeline and an asset store. That is server-side machinery a
// standalone component cannot carry, so it is not here; a host that has its
// own generator passes the finished sheet in as `spriteSheet` and the picker
// offers it alongside the pool.

import { useEffect, useState, type ReactNode } from "react"
import { track } from "~/lib/analytics"
import { SpriteWalkPreview } from "~/components/sprite/SpriteWalkPreview"
import { characterSheetUrl } from "~/components/gameRoom/assets"
import { CUSTOM_SPRITE_ID, SPRITE_COUNT, type SharedSpriteView } from "~/lib/sprites"
import { type SpriteWriteResult } from "~/lib/sprite-gen"

export interface CharacterPickerProps {
  /** Current sprite id — null when nothing has been chosen (or AUTO). */
  spriteId: number | null
  /** A sheet the host generated elsewhere and stored on the account, if any. */
  spriteSheet: string | null
  /** Persists a pick (and CUSTOM, where the caller's write accepts it). */
  choose: (spriteId: number) => Promise<SpriteWriteResult>
  /** Called after a successful save; `sheet` is set when a generated one landed. */
  onSaved: (spriteId: number, sheet: string | null) => void
  /** Extra controls under RANDOMLY PICK — the admin dialog's AUTO reset. */
  footer?: ReactNode
  /**
   * PUBLIC shared-library sheets, offered ahead of the stock pool. Exclusive
   * ones are never passed here — no character select shows them.
   */
  sharedSprites?: ReadonlyArray<SharedSpriteView>
}

const leadPanel: React.CSSProperties = {
  background: "#050813",
  border: "3px solid var(--color-card)",
  boxShadow: "8px 8px 0 #000",
}
const sidePanel: React.CSSProperties = {
  background: "transparent",
  border: "2px dashed #1A2450",
  boxShadow: "none",
}

export function CharacterPicker({
  spriteId,
  spriteSheet,
  choose,
  onSaved,
  footer,
  sharedSprites = [],
}: CharacterPickerProps) {
  const [picked, setPicked] = useState<number | null>(
    spriteId !== null &&
      (spriteId < SPRITE_COUNT || sharedSprites.some((s) => s.spriteId === spriteId))
      ? spriteId
      : null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The library list can arrive after mount (the admin dialog fetches it), so
  // a current shared pick is highlighted once its tile exists.
  useEffect(() => {
    if (picked === null && spriteId !== null && sharedSprites.some((s) => s.spriteId === spriteId)) {
      setPicked(spriteId)
    }
  }, [sharedSprites, spriteId, picked])

  // A host-supplied sheet is shown whenever one EXISTS, not only while it is
  // the active choice: someone who took a pool character after arriving with
  // their own should be able to go back to it in one click.
  const usingStored = spriteId === CUSTOM_SPRITE_ID && spriteSheet !== null

  // One save path for every button: the only difference is where the id comes
  // from, and none of them may leave with users.sprite_id still NULL.
  const save = async (id: number) => {
    setBusy(true)
    setError(null)
    try {
      const result = await choose(id)
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (id === CUSTOM_SPRITE_ID) track("sprite.custom_sprite_used", { source: "stored" })
      onSaved(id, null)
    } catch {
      setError("Could not save that character. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const confirmPicked = () => {
    if (picked === null) return
    void save(picked)
  }

  // The zero-decision way in. Random over the WHOLE pool rather than the
  // derived hash the room would otherwise fall back to: this writes a real
  // sprite id, so two people skipping in the same second should not reliably
  // land on the same character.
  const pickRandom = () => {
    void save(Math.floor(Math.random() * SPRITE_COUNT))
  }

  return (
    <>
      {error && (
        <div style={{ color: "#FF5C5C", fontSize: 12, marginBottom: 16 }}>{error}</div>
      )}

      {/* A container, so the OR between the columns can answer the width the
          columns themselves answer to. Keyed off the viewport it was wrong on
          any page whose padding differs from this one's. */}
      <div
        className="@container"
        style={{
          display: "flex",
          gap: 24,
          alignItems: "stretch",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {/* The host's own sheet, when there is one: one tile, one button. */}
        {spriteSheet && (
          <section
            style={{
              ...sidePanel,
              flex: "0 1 280px",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
            }}
            aria-label="Your own character"
          >
            <div style={cardTitle}>YOUR OWN</div>
            {/* Same white backing as the pool tiles — this is the one sprite on
                the page a player looks at longest. */}
            <div style={{ background: "#FFF", border: "2px solid #1034A6", padding: 10 }}>
              <SpriteWalkPreview src={spriteSheet} scale={3} label="Your walking animation" />
            </div>
            <span style={{ fontSize: 11, color: "#5D6699" }}>
              {usingStored ? "The current character." : "Yours — not in use."}
            </span>
            {!usingStored && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(CUSTOM_SPRITE_ID)}
                style={{
                  background: "#000",
                  border: "2px solid var(--color-coin)",
                  color: "var(--color-coin)",
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  padding: "10px 18px",
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                {busy ? "SAVING…" : "USE THIS ONE →"}
              </button>
            )}
          </section>
        )}

        {/* The pool. The grid scrolls inside the panel so the confirm button
            never leaves the screen. */}
        <section
          style={{
            ...leadPanel,
            flex: "1 1 480px",
            maxWidth: 620,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
          aria-label="Pick a stock character"
        >
          <div style={cardTitle}>PICK A CHARACTER</div>
          <p style={{ fontSize: 12, color: "#5D6699", margin: 0 }}>
            Take one of these and carry on into the room.
          </p>

          <div
            role="radiogroup"
            aria-label="Characters"
            style={{
              overflowY: "auto",
              // Capped against the DYNAMIC viewport too: on a phone a fixed
              // 420px pushed PLAY AS THIS ONE under the fold, which was the
              // exact bug this layout exists to fix. 40dvh leaves room for
              // the header above and the button below on an iPhone SE.
              maxHeight: "min(420px, 40dvh)",
              border: "1px solid #131A33",
              padding: 8,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
              gap: 8,
              alignContent: "start",
            }}
          >
            {[
              // Shared-library characters lead, so a new one is not buried
              // under the 132 that were always there.
              ...sharedSprites.map((s) => ({ id: s.spriteId, src: s.url, name: s.label })),
              ...Array.from({ length: SPRITE_COUNT }, (_, sheet) => ({
                id: sheet,
                src: characterSheetUrl(sheet),
                name: `Character ${sheet + 1}`,
              })),
            ].map(({ id: sheet, src, name }) => (
              <button
                key={sheet}
                type="button"
                role="radio"
                aria-checked={picked === sheet}
                aria-label={name}
                disabled={busy}
                onClick={() => setPicked(sheet)}
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: 8,
                  // White, because the sheets are keyed transparent and a lot
                  // of the pool wears black — a gakuran on a black tile is very
                  // nearly invisible. Selection now reads off the neon border
                  // plus a faint neon wash, since both fills are light.
                  background: picked === sheet ? "#E8FFE2" : "#FFF",
                  border: `2px solid ${picked === sheet ? "var(--color-neon)" : "#1034A6"}`,
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                <SpriteWalkPreview src={src} scale={2} rows={[0]} label={`${name} walking`} />
              </button>
            ))}
          </div>

          {/* Outside the scroll container on purpose — always visible. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              disabled={busy || picked === null}
              onClick={confirmPicked}
              style={{
                background: "#000",
                border: `2px solid ${picked === null ? "#1A1F38" : "var(--color-coin)"}`,
                color: picked === null ? "#5D6699" : "var(--color-coin)",
                fontFamily: "var(--font-display)",
                fontSize: 10,
                letterSpacing: "0.06em",
                padding: "10px 18px",
                cursor: busy || picked === null ? "default" : "pointer",
              }}
            >
              {busy ? "SAVING…" : "PLAY AS THIS ONE →"}
            </button>
            {picked === null && (
              <span style={{ fontSize: 11, color: "#5D6699" }}>
                Pick a character above to continue.
              </span>
            )}
          </div>
        </section>
      </div>

      {/* The zero-decision exit, under the pool: no pick required. Everyone
          has to leave here with SOME character, so the fastest honest way out
          is one that chooses for you. */}
      <div
        style={{
          marginTop: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        }}
      >
        <button
          type="button"
          disabled={busy}
          onClick={pickRandom}
          style={{
            background: "#000",
            border: "2px solid #1A2450",
            color: "#9AA4D4",
            fontFamily: "var(--font-display)",
            fontSize: 10,
            letterSpacing: "0.06em",
            padding: "10px 18px",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "SAVING…" : "RANDOMLY PICK →"}
        </button>
        {footer}
      </div>

    </>
  )
}

const cardTitle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "var(--color-coin)",
}

const orWord: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "#5D6699",
}
