import { useState } from "react"
import { PixelBtn } from "~/components/PixelBtn"
import { DEFAULT_HOLD_SECONDS, MAX_HOLD_SECONDS, MIN_HOLD_SECONDS } from "~/lib/game-room-control"
import { ROOM_MUSIC_CHOICES, type RoomMusic } from "~/lib/game-room-music"
import { broadcastRoomBulletinFn, setRoomMusicFn } from "~/server/game-room-control"

// ---------------------------------------------------------------------------
// GameRoomControlPanel — the gamemaster's card
// ---------------------------------------------------------------------------
// Two controls, both commands to the hub rather than to this page: put a
// message on every screen in the room for a while, and put music on the
// projector and viewer screens (or stop it).

const musicLabel = (track: string): string =>
  ROOM_MUSIC_CHOICES.find((choice) => choice.track === track)?.label ?? track

const LABEL = {
  fontFamily: "var(--font-display)",
  fontSize: 10,
  color: "var(--color-sky)",
  letterSpacing: "0.08em",
} as const

const FIELD = {
  background: "#000",
  border: "2px solid var(--color-card)",
  padding: "10px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 14,
  color: "var(--color-neon)",
  outline: "none",
  width: "100%",
} as const

export function GameRoomControlPanel({ onToast }: { onToast: (msg: string, color?: string) => void }) {
  const [busy, setBusy] = useState(false)
  // The PA screens' music, mirrored from the last accepted press. The hub is
  // the authority, but the console is the only thing that ever writes it.
  const [roomMusic, setRoomMusic] = useState<RoomMusic>(null)
  const [musicBusy, setMusicBusy] = useState(false)
  const [message, setMessage] = useState("")
  // A setting for the DESK rather than for one message: a gamemaster who
  // picked 45 seconds means it for the next one too, so it survives a send.
  const [holdSeconds, setHoldSeconds] = useState(String(DEFAULT_HOLD_SECONDS))

  const putMusic = async (music: RoomMusic) => {
    if (musicBusy) return
    setMusicBusy(true)
    try {
      await setRoomMusicFn({ data: { music } })
      setRoomMusic(music)
      onToast(
        music === null
          ? "Music handed back to the room's playlist"
          : music.mode === "stop"
            ? "Music stopped on the projector and viewer screens"
            : `Playing ${musicLabel(music.track)} on the projector and viewer screens`,
      )
    } catch (e) {
      onToast(`Music control failed: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setMusicBusy(false)
    }
  }

  const send = async () => {
    if (!message.trim() || busy) return
    setBusy(true)
    try {
      await broadcastRoomBulletinFn({
        data: { message, holdSeconds: Number(holdSeconds) || DEFAULT_HOLD_SECONDS },
      })
      onToast("📢 Message on every screen in the room", "var(--color-neon)")
      // The message is deliberately NOT cleared: resending is a normal next
      // action, for a room that missed it or a word nudged and sent again.
    } catch (e) {
      onToast(`Send failed: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* --------------------------------------------------------- message */}
      <section data-testid="room-bulletin" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={LABEL}>&gt; MESSAGE TO THE ROOM — on every screen, and the cameras turn to it</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message for the wall…"
          rows={3}
          maxLength={500}
          style={{ ...FIELD, resize: "vertical", boxShadow: "4px 4px 0 #000" }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ ...LABEL, display: "flex", alignItems: "center", gap: 8 }}>
            HOLD
            <input
              type="number"
              min={MIN_HOLD_SECONDS}
              max={MAX_HOLD_SECONDS}
              value={holdSeconds}
              onChange={(e) => setHoldSeconds(e.target.value)}
              style={{ ...FIELD, width: 90 }}
            />
            SECONDS
          </label>
          <PixelBtn variant="coin" disabled={!message.trim() || busy} onClick={() => void send()}>
            📢 SEND TO THE ROOM
          </PixelBtn>
        </div>
      </section>

      {/* ------------------------------------------------------------ music */}
      <section data-testid="room-music" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={LABEL}>&gt; MUSIC — on the projector and viewer screens only</span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          <PixelBtn variant={roomMusic === null ? "primary" : "ghost"} active={roomMusic === null} disabled={musicBusy} onClick={() => void putMusic(null)}>
            PLAYLIST
          </PixelBtn>
          {ROOM_MUSIC_CHOICES.map(({ track, label }) => {
            const playing = roomMusic?.mode === "track" && roomMusic.track === track
            return (
              <PixelBtn key={track} variant={playing ? "primary" : "ghost"} active={playing} disabled={musicBusy} onClick={() => void putMusic({ mode: "track", track })}>
                {label}
              </PixelBtn>
            )
          })}
          <PixelBtn variant="dangerGhost" active={roomMusic?.mode === "stop"} disabled={musicBusy || roomMusic?.mode === "stop"} onClick={() => void putMusic({ mode: "stop" })}>
            STOP
          </PixelBtn>
        </div>
        <span data-testid="room-music-state" style={{ ...LABEL, color: roomMusic ? "var(--color-coin)" : "var(--color-sky)" }}>
          {roomMusic === null
            ? "THE ROOM'S OWN PLAYLIST"
            : roomMusic.mode === "stop"
              ? "SILENT — until PLAYLIST or a track"
              : `LOOPING: ${musicLabel(roomMusic.track)} — until PLAYLIST or STOP`}
        </span>
      </section>
    </div>
  )
}
