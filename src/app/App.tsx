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
// owns the room. The demo's agents come from a pretend runtime that changes
// them on a timer (demo-runtime.ts); a real host hands in its own list.

import { useCallback, useEffect, useState } from "react"
import { AudioProvider } from "~/components/SiteAudio"
import { GameRoom, type GameRoomHandle } from "~/gameroom/GameRoom"
import type { RoomBulletin } from "~/components/gameRoom3d/useBulletin"
import { countByStatus } from "~/lib/agents"
import { loadIdentity, publishIdentityCookie, saveIdentity, type Identity } from "./identity"
import { Wardrobe } from "./Wardrobe"
import { Console } from "./Console"
import { RoomHeader } from "./RoomHeader"
import { useDemoRuntime } from "./demo-runtime"

/** How long the demo's bulletin holds the wall. */
const BULLETIN_HOLD_SECONDS = 8

type Screen = "wardrobe" | "room" | "console"

export function App() {
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity())
  // The console is a screen you can deep-link to, so a second window can drive
  // the room in the first.
  const [screen, setScreen] = useState<Screen>(() =>
    window.location.hash === "#console" ? "console" : "wardrobe",
  )
  const [running, setRunning] = useState(true)
  const agents = useDemoRuntime(running)
  const [room, setRoom] = useState<GameRoomHandle | null>(null)
  // A bulletin is raised by handing in a new object; the room takes it down.
  const [bulletin, setBulletin] = useState<RoomBulletin | null>(null)
  const raiseBulletin = useCallback(() => {
    const { waiting, error } = countByStatus(agents)
    const text =
      waiting > 0
        ? `${waiting} ${waiting === 1 ? "agent is" : "agents are"} waiting for you.`
        : error > 0
          ? `${error} ${error === 1 ? "agent needs" : "agents need"} a look: something failed.`
          : `All ${agents.length} agents are fine. Nothing needs you right now.`
    setBulletin({ text, holdSeconds: BULLETIN_HOLD_SECONDS })
  }, [agents])

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
        bulletin={bulletin}
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
            agents={agents}
            running={running}
            onToggleRunning={() => setRunning((on) => !on)}
            onBulletin={raiseBulletin}
            onLeave={() => setScreen("wardrobe")}
          />
        }
      />
    </AudioProvider>
  )
}
