import { useEffect, useRef, useState } from "react"
import { PixelBtn } from "~/components/PixelBtn"
import { SCREEN_PAGES, type ScreenPage } from "~/components/gameRoom3d/screen-pages"
import { ANNOUNCEMENT_VOICES, DEFAULT_ANNOUNCEMENT_VOICE_ID } from "~/lib/announcement-voices"
import { DEFAULT_HOLD_SECONDS, MAX_HOLD_SECONDS, MIN_HOLD_SECONDS } from "~/lib/game-room-control"
import { ROOM_MUSIC_CHOICES, type RoomMusic } from "~/lib/game-room-music"
import {
  donePresenting,
  ordinal,
  PRESENTATION_DONE_CSS_COLOR,
  revealDurationMs,
  type PresentationState,
} from "~/lib/presentation-order"
import { nextPodiumPlace, placedTeamIds, podiumLabel, type WinnersState } from "~/lib/winners-ceremony"
import { rankNumeralCssColor } from "~/components/gameRoom3d/rank-numerals"
import {
  announceWinnerFn,
  broadcastRoomBulletinFn,
  clearPresentationFn,
  endWinnersFn,
  getPresentationFn,
  getWinnersFn,
  randomizePresentationFn,
  setPresentationDoneFn,
  setPresentationSpotlightFn,
  setRoomMusicFn,
  setRoomScreenFn,
  startWinnersFn,
  getAnnouncementPresetsFn,
  type AnnouncementPreset,
} from "~/server/game-room-control"

// ---------------------------------------------------------------------------
// GameRoomControlPanel — the GAME ROOM tab
// ---------------------------------------------------------------------------
// Drives what the room is looking at while the projector is up: replay one of
// the three filmed market-event broadcasts, pin the wall screen to a page for
// everyone, or put a typed message on it.
//
// NONE of this touches the exchange. Its `announcement` feed is the teams'
// bots' S1 signal, so a rehearsal replay or an ad-hoc notice would otherwise
// be indistinguishable from a real event and would move prices with it. These
// go down the room's own hub instead (server/game-room-control-store.ts). The
// ANNOUNCEMENTS card on the BOT CONTROL tab remains the one control that fires
// a real market event, impacts and all.
//
// The videos themselves stay admin-only, which is the room's existing rule
// rather than a new one: every screen shows the text banner, and only the
// signed-in admin's client resolves and plays the filmed clip.
//
// The preset texts come from the admin-guarded GET /admin/announcement-presets
// — deliberately not hardcoded here, so the event-day script never ships in
// the client bundle.
//
// PRESENTATION ORDER draws the running order for the 16:30 presentations and
// reveals it in the room — the house lights go down and a spotlight sweeps the
// desks first presenter to last, each desk's numeral becoming its slot as the
// light lands. While a team presents, SPOTLIGHT lights that desk alone and
// puts the team on the wall. DONE marks a team off once they have finished —
// the room greens that desk's slot and the wall ticks it, so a glance at
// either says how far down the order the afternoon has got. The hub holds the
// order, so this card reads it back on open rather than trusting what this
// tab last pressed.
//
// WINNER ANNOUNCEMENT is the end of the day. START turns every screen in the
// room to the wall and drops the sky to night; then the podium is read from
// the bottom up — 3RD, 2ND, 1ST — one press each, and each place puts the
// team on the wall, hangs its medal over the desk and fires a volley of
// fireworks over the city, the winner's being the finale. The hub enforces
// the order, so this card only ever offers the next place. END brings the
// lights and the clock back.

const PAGE_LABEL: Record<ScreenPage, string> = {
  countdown: "COUNTDOWN",
  leaderboard: "LEADERBOARD",
  "leaderboard-lower": "LEADERBOARD (LOWER)",
  "leaderboard-tail": "LEADERBOARD (TAIL)",
}

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

interface PresentationView {
  state: PresentationState | null
  teams: Array<{ id: string; name: string }>
}

interface WinnersView {
  state: WinnersState | null
  teams: Array<{ id: string; name: string }>
}

export function GameRoomControlPanel({ onToast }: { onToast: (msg: string, color?: string) => void }) {
  const [presets, setPresets] = useState<AnnouncementPreset[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selectedId, setSelectedId] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // What this console last pinned. The hub is the authority, but the console is
  // the only thing that ever writes it, so mirroring the last accepted press is
  // enough — and a gamemaster who cannot see that the wall is still theirs will
  // walk away leaving it pinned.
  const [forcedPage, setForcedPage] = useState<ScreenPage | null>(null)
  // The PA screens' music, mirrored the same way and for the same reason.
  const [roomMusic, setRoomMusic] = useState<RoomMusic>(null)
  const [musicBusy, setMusicBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [symbol, setSymbol] = useState("")
  // Settings for the DESK rather than for one message: a gamemaster who picked
  // 45 seconds means it for the next announcement too, so unlike the message
  // these survive a send.
  const [voiceId, setVoiceId] = useState(DEFAULT_ANNOUNCEMENT_VOICE_ID)
  const [holdSeconds, setHoldSeconds] = useState(String(DEFAULT_HOLD_SECONDS))
  const dropdownRef = useRef<HTMLDivElement>(null)
  // The running order as the hub holds it. Null until the first read lands;
  // a state of null inside it means no order has been drawn.
  const [presentation, setPresentation] = useState<PresentationView | null>(null)
  const [presentationBusy, setPresentationBusy] = useState(false)
  // The ceremony as the hub holds it, same shape: null until read, and a
  // state of null inside it means none is running.
  const [winners, setWinners] = useState<WinnersView | null>(null)
  const [winnersBusy, setWinnersBusy] = useState(false)
  // The team picked for the next place. Cleared once a place goes out, so
  // the same team cannot be sent twice by a second press.
  const [winnerPick, setWinnerPick] = useState("")

  useEffect(() => {
    let cancelled = false
    getWinnersFn()
      .then((view) => {
        if (!cancelled) setWinners(view)
      })
      .catch((e) => {
        if (!cancelled) onToast(`Failed to read the winner announcement: ${(e as Error).message}`, "var(--color-danger)")
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    getPresentationFn()
      .then((view) => {
        if (!cancelled) setPresentation(view)
      })
      .catch((e) => {
        if (!cancelled) onToast(`Failed to read the presentation order: ${(e as Error).message}`, "var(--color-danger)")
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    getAnnouncementPresetsFn()
      .then((data) => {
        if (!cancelled) setPresets(data)
      })
      .catch((e) => {
        if (cancelled) return
        setLoadError(true)
        onToast(`Failed to load market events: ${(e as Error).message}`, "var(--color-danger)")
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const selected = presets?.find((p) => p.id === selectedId) ?? null

  const replay = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      await broadcastRoomBulletinFn({
        data: {
          message: selected.message,
          affectedSymbol: selected.affectedSymbol,
          // The clip opens on its own titles and its anchor reads the
          // headline. A second voice over that talks across the video — and
          // bills for the privilege.
          spoken: false,
          holdSeconds: Number(holdSeconds) || DEFAULT_HOLD_SECONDS,
        },
      })
      onToast(`▶ ${selected.label} playing in the room — no price impact`, "var(--color-neon)")
    } catch (e) {
      onToast(`Replay failed: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setBusy(false)
    }
  }

  // The local mirror moves only once the hub has accepted the press — a failed
  // push must not leave the panel claiming a wall it never took.
  const pin = async (page: ScreenPage | null) => {
    if (busy) return
    setBusy(true)
    try {
      await setRoomScreenFn({ data: { page } })
      setForcedPage(page)
      onToast(page ? `Wall pinned to ${PAGE_LABEL[page]}` : "Wall released to the players")
    } catch (e) {
      onToast(`Screen control failed: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setBusy(false)
    }
  }

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
      const result = await broadcastRoomBulletinFn({
        data: {
          message,
          affectedSymbol: symbol,
          spoken: true,
          voiceId,
          holdSeconds: Number(holdSeconds) || DEFAULT_HOLD_SECONDS,
        },
      })
      // A send that went out unspoken because the VENDOR failed is worth
      // saying, with its status — otherwise the only way to learn the voice is
      // off is for someone in the room to mention the silence. A deployment
      // with no ElevenLabs credentials is not a failure and is not shouted at.
      if (result?.voiceError) {
        onToast(`📢 Sent — voice failed: ${result.voiceError}`, "var(--color-coin)")
      } else {
        onToast("📢 Message on every screen in the room", "var(--color-neon)")
      }
      // The message is deliberately NOT cleared. Resending is a normal next
      // action at a live event — a room that missed it, or a word nudged and
      // sent again — and the server does not charge the vendor twice for
      // identical text, so there is nothing to protect by wiping it.
    } catch (e) {
      onToast(`Send failed: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setBusy(false)
    }
  }

  const order = presentation?.state ?? null
  const doneIds = order ? donePresenting(order) : []
  const teamName = (id: string) => presentation?.teams.find((team) => team.id === id)?.name ?? id

  const randomize = async () => {
    if (presentationBusy) return
    setPresentationBusy(true)
    try {
      const view = await randomizePresentationFn()
      setPresentation(view)
      const seconds = Math.ceil(revealDurationMs(view.state?.order.length ?? 0) / 1000)
      onToast(`🎲 Order drawn — the room is revealing it over the next ${seconds}s`, "var(--color-neon)")
    } catch (e) {
      onToast(`Randomize failed: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setPresentationBusy(false)
    }
  }

  const spotlight = async (teamId: string | null) => {
    if (presentationBusy) return
    setPresentationBusy(true)
    try {
      const view = await setPresentationSpotlightFn({ data: { teamId } })
      setPresentation(view)
      if (teamId) {
        const slot = (view.state?.order.indexOf(teamId) ?? -1) + 1
        onToast(`🔦 Spotlight on ${teamName(teamId)} — ${ordinal(slot)} to present`, "var(--color-neon)")
      } else {
        onToast("💡 House lights up")
      }
    } catch (e) {
      onToast(`Spotlight failed: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setPresentationBusy(false)
    }
  }

  const markDone = async (teamId: string, done: boolean) => {
    if (presentationBusy) return
    setPresentationBusy(true)
    try {
      const view = await setPresentationDoneFn({ data: { teamId, done } })
      setPresentation(view)
      onToast(
        done ? `✓ ${teamName(teamId)} has presented` : `${teamName(teamId)} put back on the list`,
        done ? PRESENTATION_DONE_CSS_COLOR : undefined,
      )
    } catch (e) {
      onToast(`Could not mark the team: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setPresentationBusy(false)
    }
  }

  const endPresentations = async () => {
    if (presentationBusy) return
    setPresentationBusy(true)
    try {
      setPresentation(await clearPresentationFn())
      onToast("Presentations over — the desks are back to their placings")
    } catch (e) {
      onToast(`Could not end presentations: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setPresentationBusy(false)
    }
  }

  const ceremony = winners?.state ?? null
  const nextPlace = ceremony ? nextPodiumPlace(ceremony) : null
  const winnerName = (id: string) => winners?.teams.find((team) => team.id === id)?.name ?? id
  const unplacedTeams = ceremony
    ? winners!.teams.filter((team) => !placedTeamIds(ceremony).includes(team.id))
    : []

  const startWinners = async () => {
    if (winnersBusy) return
    setWinnersBusy(true)
    try {
      setWinners(await startWinnersFn())
      setWinnerPick("")
      onToast("🏆 Winner announcement started — the room turns to the wall and night falls", "var(--color-neon)")
    } catch (e) {
      onToast(`Could not start the announcement: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setWinnersBusy(false)
    }
  }

  const announce = async () => {
    if (winnersBusy || !nextPlace || !winnerPick) return
    setWinnersBusy(true)
    try {
      const view = await announceWinnerFn({ data: { place: nextPlace, teamId: winnerPick } })
      setWinners(view)
      setWinnerPick("")
      onToast(`🎆 ${podiumLabel(nextPlace)}: ${winnerName(winnerPick)} — fireworks over the room`, rankNumeralCssColor(nextPlace))
    } catch (e) {
      onToast(`Announcement failed: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setWinnersBusy(false)
    }
  }

  const endWinners = async () => {
    if (winnersBusy) return
    setWinnersBusy(true)
    try {
      setWinners(await endWinnersFn())
      setWinnerPick("")
      onToast("Announcement over — the room's lights and clock are back")
    } catch (e) {
      onToast(`Could not end the announcement: ${(e as Error).message}`, "var(--color-danger)")
    } finally {
      setWinnersBusy(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* ------------------------------------------------ replay a broadcast */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={LABEL}>&gt; REPLAY MARKET EVENT — plays in the room, moves nothing</span>
        {presets === null ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: loadError ? "var(--color-danger)" : "var(--color-sky)",
            }}
          >
            {loadError ? "Failed to load market events — reload the page to retry." : "Loading market events…"}
          </span>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
            <div ref={dropdownRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                style={{
                  ...FIELD,
                  border: "2px solid var(--color-neon)",
                  padding: "12px 14px",
                  color: selected ? "var(--color-neon)" : "var(--color-sky)",
                  boxShadow: "4px 4px 0 #000",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  textAlign: "left",
                }}
              >
                <span>{selected ? selected.label : "— SELECT MARKET EVENT —"}</span>
                <span style={{ fontSize: 10, color: "var(--color-sky)" }}>{open ? "▲" : "▼"}</span>
              </button>
              {open && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    background: "#000",
                    border: "2px solid var(--color-neon)",
                    boxShadow: "4px 4px 0 #000",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(p.id)
                        setOpen(false)
                      }}
                      style={{
                        background: p.id === selectedId ? "var(--color-neon)" : "transparent",
                        border: "none",
                        borderBottom: "1px solid var(--color-card)",
                        padding: "12px 14px",
                        fontFamily: "var(--font-mono)",
                        fontSize: 14,
                        color: p.id === selectedId ? "#000" : "var(--color-neon)",
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <PixelBtn variant="coin" disabled={!selected || busy} onClick={replay}>
              ▶ PLAY ON WALL
            </PixelBtn>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- the wall page */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={LABEL}>&gt; WALL SCREEN — pinned for every screen in the room</span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          {SCREEN_PAGES.map((page) => (
            <PixelBtn
              key={page}
              variant={forcedPage === page ? "primary" : "ghost"}
              active={forcedPage === page}
              disabled={busy}
              onClick={() => void pin(page)}
            >
              {PAGE_LABEL[page]}
            </PixelBtn>
          ))}
          <PixelBtn variant="dangerGhost" disabled={busy || forcedPage === null} onClick={() => void pin(null)}>
            RELEASE
          </PixelBtn>
        </div>
        <span data-testid="forced-page" style={{ ...LABEL, color: forcedPage ? "var(--color-coin)" : "var(--color-sky)" }}>
          {forcedPage
            ? `HOLDING: ${forcedPage} — the room cannot turn the page`
            : "PLAYERS OWN THE WALL — it cycles, and interact turns it"}
        </span>
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
            ? "THE ROOM'S OWN PLAYLIST — ambient tracks and songs, alternating"
            : roomMusic.mode === "stop"
              ? "STOPPED — the projector and viewer screens are silent"
              : `LOOPING: ${musicLabel(roomMusic.track)} — until PLAYLIST or STOP`}
        </span>
      </section>

      {/* --------------------------------------------------- presentations */}
      <section data-testid="presentation-order" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={LABEL}>&gt; PRESENTATION ORDER — drawn at random, revealed desk by desk in the room</span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          <PixelBtn
            variant="coin"
            disabled={presentationBusy || presentation === null}
            onClick={() => void randomize()}
          >
            {order ? "🎲 RE-RANDOMIZE ORDER" : "🎲 RANDOMIZE ORDER"}
          </PixelBtn>
          <PixelBtn
            variant="ghost"
            disabled={presentationBusy || !order || order.spotlight === null}
            onClick={() => void spotlight(null)}
          >
            💡 LIGHTS UP
          </PixelBtn>
          <PixelBtn variant="dangerGhost" disabled={presentationBusy || !order} onClick={() => void endPresentations()}>
            END PRESENTATIONS
          </PixelBtn>
        </div>
        {order ? (
          <ol
            data-testid="presentation-list"
            style={{ display: "flex", flexDirection: "column", gap: 6, margin: 0, padding: 0, listStyle: "none" }}
          >
            {order.order.map((teamId, index) => {
              const live = order.spotlight === teamId
              const done = doneIds.includes(teamId)
              return (
                <li
                  key={teamId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    background: live
                      ? "rgba(255,106,213,0.18)"
                      : done
                        ? "rgba(47,156,90,0.16)"
                        : "#000",
                    border: `2px solid ${live ? "#ff6ad5" : done ? PRESENTATION_DONE_CSS_COLOR : "var(--color-card)"}`,
                  }}
                >
                  <span
                    style={{
                      ...LABEL,
                      color: done ? PRESENTATION_DONE_CSS_COLOR : "#ff6ad5",
                      width: 40,
                    }}
                  >
                    {ordinal(index + 1)}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 14,
                      color: done ? "var(--color-sky)" : "var(--color-neon)",
                      flex: 1,
                      whiteSpace: "nowrap",
                      textDecoration: done ? "line-through" : undefined,
                    }}
                  >
                    {teamName(teamId)}
                  </span>
                  {live && <span style={{ ...LABEL, color: "#ff6ad5", whiteSpace: "nowrap" }}>ON STAGE</span>}
                  {/* A finished team is not one you spotlight again, so the
                      light button stands down and DONE becomes the undo. */}
                  {!done && (
                    <PixelBtn
                      variant={live ? "primary" : "ghost"}
                      active={live}
                      disabled={presentationBusy || live}
                      onClick={() => void spotlight(teamId)}
                    >
                      🔦 SPOTLIGHT
                    </PixelBtn>
                  )}
                  <PixelBtn
                    variant={done ? "dangerGhost" : "secondary"}
                    disabled={presentationBusy}
                    onClick={() => void markDone(teamId, !done)}
                  >
                    {done ? "UNDO DONE" : "✓ DONE"}
                  </PixelBtn>
                </li>
              )
            })}
          </ol>
        ) : (
          <span style={{ ...LABEL, color: "var(--color-sky)" }}>
            {presentation === null
              ? "Reading the running order…"
              : "NO ORDER DRAWN — the desks show their placings"}
          </span>
        )}
        {order && (
          <span data-testid="presentation-progress" style={{ ...LABEL, color: PRESENTATION_DONE_CSS_COLOR }}>
            {doneIds.length} OF {order.order.length} PRESENTED
          </span>
        )}
      </section>

      {/* ------------------------------------------------ winner announcement */}
      <section data-testid="winner-announcement" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={LABEL}>&gt; WINNER ANNOUNCEMENT — the podium, read 3RD to 1ST, fireworks over the city</span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          <PixelBtn variant="coin" disabled={winnersBusy || winners === null} onClick={() => void startWinners()}>
            {ceremony ? "🏆 RESTART ANNOUNCEMENT" : "🏆 START WINNER ANNOUNCEMENT"}
          </PixelBtn>
          <PixelBtn variant="dangerGhost" disabled={winnersBusy || !ceremony} onClick={() => void endWinners()}>
            END ANNOUNCEMENT
          </PixelBtn>
        </div>
        {ceremony ? (
          <>
            <ol
              data-testid="podium-list"
              style={{ display: "flex", flexDirection: "column", gap: 6, margin: 0, padding: 0, listStyle: "none" }}
            >
              {ceremony.podium.map((entry) => (
                <li
                  key={entry.place}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    background: "#000",
                    border: `2px solid ${rankNumeralCssColor(entry.place)}`,
                  }}
                >
                  <span style={{ ...LABEL, color: rankNumeralCssColor(entry.place), width: 110 }}>
                    {podiumLabel(entry.place)}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--color-neon)", flex: 1 }}>
                    {winnerName(entry.teamId)}
                  </span>
                </li>
              ))}
            </ol>
            {nextPlace ? (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, width: 260 }}>
                  <span style={{ ...LABEL, color: rankNumeralCssColor(nextPlace) }}>{podiumLabel(nextPlace)}</span>
                  <select
                    data-testid="winner-pick"
                    value={winnerPick}
                    onChange={(e) => setWinnerPick(e.target.value)}
                    style={FIELD}
                  >
                    <option value="">— SELECT TEAM —</option>
                    {unplacedTeams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </label>
                <PixelBtn variant="primary" disabled={winnersBusy || !winnerPick} onClick={() => void announce()}>
                  🎆 ANNOUNCE {podiumLabel(nextPlace)}
                </PixelBtn>
              </div>
            ) : (
              <span data-testid="podium-complete" style={{ ...LABEL, color: rankNumeralCssColor(1) }}>
                PODIUM COMPLETE — END ANNOUNCEMENT brings the room back
              </span>
            )}
          </>
        ) : (
          <span style={{ ...LABEL, color: "var(--color-sky)" }}>
            {winners === null
              ? "Reading the winner announcement…"
              : "NOT STARTED — the room is on its own clock and the desks show their placings"}
          </span>
        )}
      </section>

      {/* ------------------------------------------------------ typed message */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={LABEL}>&gt; MESSAGE TO THE ROOM — the room only, never the teams' bots</span>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={LABEL}>MESSAGE</span>
          <textarea
            value={message}
            maxLength={500}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
            style={{ ...FIELD, resize: "vertical" }}
          />
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, width: 160 }}>
            <span style={LABEL}>SYMBOL (OPTIONAL)</span>
            <input value={symbol} maxLength={8} onChange={(e) => setSymbol(e.target.value)} style={FIELD} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, width: 200 }}>
            <span style={LABEL}>VOICE</span>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} style={FIELD}>
              {ANNOUNCEMENT_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, width: 150 }}>
            <span style={LABEL}>HOLD (SECONDS)</span>
            <input
              type="number"
              value={holdSeconds}
              min={MIN_HOLD_SECONDS}
              max={MAX_HOLD_SECONDS}
              onChange={(e) => setHoldSeconds(e.target.value)}
              style={FIELD}
            />
          </label>
          {/* Generating a voice that has not been used before takes tens of
              seconds. A button that just sits there reads as a dead console,
              and the gamemaster presses it again. */}
          <PixelBtn variant="coin" disabled={!message.trim() || busy} onClick={send}>
            {busy ? "GENERATING…" : "📢 SEND TO ROOM"}
          </PixelBtn>
        </div>
      </section>
    </div>
  )
}
