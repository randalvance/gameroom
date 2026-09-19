# gameroom

A 3D pixel-art **game room** you can drop into a React app: a floor of desks,
a character per person, multiplayer walking and talking, a wall-wide screen the
gamemaster drives — and three games hidden inside it that nothing signposts.

It was lifted out of the event site it was built for and cut loose from it:
no sign-in, no database, no exchange. You hand it who is playing and which
teams are seated; it does the rest.

![the room](docs/room.png)

## Run the demo

```bash
bun install
bun run dev          # the app on :3000, the room hub on :8787
```

Open <http://localhost:3000>, pick a character, walk in (`WASD`, `E` to talk,
`Tab` for the menu, `Enter` to chat). Open a second window to meet yourself.
The gamemaster's console is at <http://localhost:3000/#console>.

Node 20+ or Bun 1.2+. The hub is a Bun script; everything else runs anywhere.

## Embed it

```tsx
import { GameRoom, AudioProvider, configureGameRoomApi } from "@gameroom/react"
import "@gameroom/react/styles.css"

configureGameRoomApi({ baseUrl: "" })   // where your room hub lives

<AudioProvider defaultMuted={false}>
  <GameRoom
    me={{ id: "u1", name: "Wei Ming", role: "student", spriteId: 7,
          spriteSheet: null, teamName: "SIGNAL", playerIdx: 0, teamIdx: 0 }}
    teams={teams}
    menu={{ me, peers }}
    onExit={() => router.back()}
  />
</AudioProvider>
```

Serve `node_modules/@gameroom/react/public/assets/**` at `/assets` — the room
loads its sheets and textures by URL.

Three levels, take what you want:

| | |
| --- | --- |
| `<GameRoom>` | the whole thing: room, multiplayer, menu, chat, music, games. |
| `<GameRoom3D>` | the scene, with your own UI around it. |
| `<Room3DViewport>` | the canvas, driven imperatively through a scene handle. |

Standalone pieces: `<CharacterPicker>`, `<GameRoomControlPanel>`,
`<ArcadePortal>`, `<BackroomsPortal>`, `<DuelPortal>`, `<AudioProvider>`.

## What is in the room

**The floor.** Up to fourteen desks, six seats each, seated from the `teams`
you pass. Everybody not being walked by a person orbits their desk on a
simulation every client runs identically, so an empty room still looks
inhabited. Walk up to someone and press `E` and they introduce themselves;
both of you freeze for the length of the conversation, because the hub says so.

**The wall.** A screen the width of the room, carrying the trading clock, the
standings and the desks' placings — or whatever page the gamemaster pins it to.

**The characters.** 132 walk-cycle sheets, picked in the wardrobe
(`<CharacterPicker>`) or derived from a seat when nobody has chosen. A host
with its own generator passes a finished sheet in and the picker offers it
alongside the pool.

**The music.** Four ambient loops and the theme in eight arrangements,
alternating. The gamemaster can put one track on, or stop it — and that command
only reaches the projector and the big screen, never a player's laptop.

## The three easter eggs

Nothing in the UI mentions any of them. In rough order of how findable they are:

1. **Table Stakes** — the two white desks are not teams. Press `E` at one and
   the house deals you into a card duel.
2. **Impact Hackers** — the Konami code (↑↑↓↓←→←→BA, or the same on the touch
   D-pad) drops an arcade cabinet into the room with a fighting game in it.
3. **The Backrooms** — a hatch, and what is through it. Finding the way in is
   the puzzle; the clue for a fourth thing is scrawled on a wall down there.

The fourth thing needs a microphone and is left as an exercise.

## The gamemaster's console

`<GameRoomControlPanel>` is one card, and every button on it is a command to
the room rather than to a page:

- **WALL SCREEN** — pin every screen in the room to a page, or hand it back.
- **MUSIC** — a track, silence, or the room's own playlist.
- **MESSAGE TO THE ROOM** — a bulletin: the cameras turn to the wall and hold.
- **PRESENTATION ORDER** — draw a running order, then sweep a spotlight desk by
  desk as it is revealed; spotlight a team while they present, tick them off
  after.
- **WINNER ANNOUNCEMENT** — third, then second, then first, each place hanging
  a medal over its desk and firing fireworks over the city. The hub enforces
  the order.

## The hub

Multiplayer is SSE down, POST up, with one in-memory authority
(`src/server/hub.ts`) deciding where everyone is. `server/hub-server.ts` is a
~250-line Bun server that serves it, plus demo answers for the feeds the room
reads (standings, trading clock, doors).

Point it at your own data by handing the hub a roster:

```ts
import { setGameRoomRoster, getGameRoomHub } from "@gameroom/react/hub"

setGameRoomRoster(await loadTeams())
const hub = getGameRoomHub({ loadGuest: (id) => lookUpVisitor(id) })
```

Routes the client speaks: `GET /api/game-room/stream`, `POST
/api/game-room/{input,interact,chat,dismiss}`, `GET /api/{doors,session,leaderboard}`,
and `/api/room/*` for the console. Serve those and the room is yours.

**With no hub at all the room still runs** — single-player, everyone wandering,
the wall on its clock. Every call degrades rather than throws.

## What was deliberately left out

- **Sign-in.** `me` is whoever you say it is. Put your own auth in front.
- **The AI character generator.** It was a ComfyUI pipeline and an asset store;
  a component cannot carry that. The picker keeps the pool, the shared library
  and RANDOMLY PICK.
- **Spoken announcements.** A bulletin is read aloud by a speech vendor in the
  original. Here it goes up silently, which is the path the site itself takes
  when no voice is configured.
- **Filmed market broadcasts**, **the exchange**, and **the pets** that used to
  follow players around.

## Scripts

| | |
| --- | --- |
| `bun run dev` | app + hub |
| `bun run build` | the demo app |
| `bun run build:lib` | the library (`dist/`) |
| `bun run test` | 1,372 tests, no network, no database |
| `bun run typecheck` | `tsc --noEmit` |

Tests must run under Node, not Bun — `bun run test` does the right thing.

## Licence

MIT for the code. The art and audio have their own terms: see
[ASSETS.md](ASSETS.md).
