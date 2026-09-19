// The demo host: everything the library does NOT do, so what it does is
// obvious.
//
// Three screens, in the order a visitor meets them:
//
//   WARDROBE  pick a name and a character (the library's <CharacterPicker>).
//   ROOM      the room itself (<GameRoom>), with the games inside it.
//   CONSOLE   the gamemaster's controls (<GameRoomControlPanel>) — open it in
//             a second window and drive the room in the first.
//
// The host owns identity, persistence and routing. The room owns the room.

import { useCallback, useEffect, useMemo, useState } from "react"
import { AudioProvider } from "~/components/SiteAudio"
import { GameRoom } from "~/gameroom/GameRoom"
import { buildAllPlayers, type TeamDTO } from "~/lib/event-types"
import type { GameRoomMenuData } from "~/lib/game-room-menu"
import { loadIdentity, publishIdentityCookie, saveIdentity, type Identity } from "./identity"
import { Wardrobe } from "./Wardrobe"
import { Console } from "./Console"
import { RoomHeader } from "./RoomHeader"

type Screen = "wardrobe" | "room" | "console"

/** The demo's roster, straight from the hub. */
function useTeams(): TeamDTO[] | null {
  const [teams, setTeams] = useState<TeamDTO[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch("/api/roster")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: TeamDTO[]) => alive && setTeams(rows))
      // No hub, no roster: an empty room still renders, and the banner above
      // it says why.
      .catch(() => alive && setTeams([]))
    return () => {
      alive = false
    }
  }, [])
  return teams
}

export function App() {
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity())
  // The console is a screen you can deep-link to, so a second window can drive
  // the room in the first.
  const [screen, setScreen] = useState<Screen>(() =>
    window.location.hash === "#console" ? "console" : "wardrobe",
  )
  const teams = useTeams()

  const commit = useCallback((next: Identity) => {
    setIdentity(next)
    saveIdentity(next)
    publishIdentityCookie(next)
    // The hub seats a visitor it has been introduced to; one it has not is a
    // spectator. Told BEFORE the room opens its stream, so the first hello
    // already has a character in it.
    void fetch("/api/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next.name, role: next.role, spriteId: next.spriteId }),
    }).catch(() => {
      // Without a hub the room is single-player, which is a working room.
    })
  }, [])

  useEffect(() => {
    publishIdentityCookie(identity)
    // Mount only: the cookie is how the SSE stream is identified, and it has
    // to exist before anything connects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // What the pause menu shows. A demo visitor is a guest rather than a seated
  // student, so this is built by hand instead of being projected off a roster
  // row — the same shape either way.
  const menu = useMemo<GameRoomMenuData>(
    () => ({
      me: {
        id: identity.id,
        name: identity.name || "Visitor",
        role: identity.role,
        spriteId: identity.spriteId,
        spriteSheet: null,
        teamName: null,
        playerIdx: 0,
        teamIdx: 0,
      },
      peers: [],
    }),
    [identity],
  )

  if (screen === "console") {
    return (
      <Console
        teams={teams ?? []}
        onBack={() => {
          window.location.hash = ""
          setScreen("wardrobe")
        }}
      />
    )
  }

  if (screen === "wardrobe" || teams === null) {
    return (
      <Wardrobe
        identity={identity}
        loading={teams === null}
        onChange={commit}
        onEnter={() => setScreen("room")}
        onConsole={() => {
          window.location.hash = "console"
          setScreen("console")
        }}
      />
    )
  }

  return (
    <AudioProvider defaultMuted={false}>
      <GameRoom
        me={menu.me}
        teams={teams}
        menu={menu}
        arcadeUnlocked={identity.arcadeUnlocked}
        onArcadeUnlock={() => commit({ ...identity, arcadeUnlocked: true })}
        onExit={() => setScreen("wardrobe")}
        header={
          <RoomHeader
            players={buildAllPlayers(teams).length}
            teams={teams.length}
            onLeave={() => setScreen("wardrobe")}
          />
        }
      />
    </AudioProvider>
  )
}
