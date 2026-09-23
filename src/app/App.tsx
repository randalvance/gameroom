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
// The host owns identity, persistence, routing — and the agents. The room
// owns the room.

import { useCallback, useEffect, useState } from "react"
import { AudioProvider } from "~/components/SiteAudio"
import { GameRoom, type GameRoomHandle } from "~/gameroom/GameRoom"
import type { Agent } from "~/lib/agents"
import { loadIdentity, publishIdentityCookie, saveIdentity, type Identity } from "./identity"
import { Wardrobe } from "./Wardrobe"
import { Console } from "./Console"
import { RoomHeader } from "./RoomHeader"
import { demoAgents } from "./demo-agents"

type Screen = "wardrobe" | "room" | "console"

export function App() {
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity())
  // The console is a screen you can deep-link to, so a second window can drive
  // the room in the first.
  const [screen, setScreen] = useState<Screen>(() =>
    window.location.hash === "#console" ? "console" : "wardrobe",
  )
  const [agents] = useState<Agent[]>(() => demoAgents())
  const [room, setRoom] = useState<GameRoomHandle | null>(null)

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

  if (screen === "console") {
    return (
      <Console
        agents={agents}
        onBack={() => {
          window.location.hash = ""
          setScreen("wardrobe")
        }}
      />
    )
  }

  if (screen === "wardrobe") {
    return (
      <Wardrobe
        identity={identity}
        loading={false}
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
        agents={agents}
        hub
        me={{ id: identity.id, name: identity.name || "Visitor", role: identity.role, spriteId: identity.spriteId }}
        onReady={setRoom}
        onAgentInteract={(agent) => {
          // The host decides what a conversation with an agent is. The demo
          // has the agent say what it is doing.
          room?.say(agent.id, agent.activity ? `${agent.name}: ${agent.activity}` : `${agent.name} is ${agent.status}.`)
        }}
        arcadeUnlocked={identity.arcadeUnlocked}
        onArcadeUnlock={() => commit({ ...identity, arcadeUnlocked: true })}
        onExit={() => setScreen("wardrobe")}
        header={
          <RoomHeader
            agents={agents.length}
            onLeave={() => setScreen("wardrobe")}
          />
        }
      />
    </AudioProvider>
  )
}
