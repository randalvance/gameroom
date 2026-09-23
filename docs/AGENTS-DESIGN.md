# Making the game room generic: agents in the room

The room was built for one hackathon. This document is the design for turning
it into a generic "your agents, as pixel characters" component, and the order
to do the work in. It records the decisions taken in the design interview so
the refactor does not have to re-ask them.

## Decisions

| Question | Decision |
| --- | --- |
| Who drives state | The host, from the client, through props. No server is required. The hub stays as an optional layer for human visitors. |
| Humans in the room | Kept. A visitor walks a character; pressing interact while facing an agent fires `onAgentInteract`. The host decides what happens next. |
| What "working" looks like | The agent walks laps around its desk with a speech bubble ("Working…" by default, or its activity text). |
| What "not working" looks like | The agent stands still in place. The walk cycle keeps playing. |
| Grouping | None for now. `agents` is a flat list. |
| Sub-agents | Children are characters that follow their parent in a line. A working child makes its parent working. |
| Status set | A fixed enum: `idle`, `working`, `waiting`, `done`, `error`, `offline`. Each has a default look the host can override per status. |
| The wall | Bulletins stay, as text only. Presentation spotlight, winners' ceremony, fireworks, medals, video broadcasts, leaderboard pages and the trading clock go. |
| Easter eggs | Kept. |
| Scale | Around fifty agents. No hard cap in code. |
| Naming | The package stays `gameroom`. The things in it are `agents`. |
| Compatibility | Nothing else consumes the package. The API is cut clean at 0.2.0. |
| Primey | Kept, with its interact callback. |

## The model

```ts
export type AgentStatus = "idle" | "working" | "waiting" | "done" | "error" | "offline"

export interface Agent {
  /** Stable across renders. Also seeds the derived sprite. */
  id: string
  name: string
  status: AgentStatus
  /** Bubble text. Working agents show "Working…" when this is empty. */
  activity?: string
  /** This agent follows that one in a line. Its status rolls up to the parent. */
  parentId?: string
  /** A stock sheet index, or a URL to a 6×4 sheet. Absent derives one from the id. */
  sprite?: number | string
  /** Halo tint override. Absent follows the status. */
  color?: string
}
```

The host owns the list and re-renders with a new array whenever anything
changes. The room diffs it against the previous list and applies the delta
through the scene handle. Nothing about an agent flows through React into the
WebGL scene as a rebuild.

## What each status looks like

| Status | Motion | Bubble | Halo | Opacity |
| --- | --- | --- | --- | --- |
| `idle` | stands, walk cycle playing | none | green | 1 |
| `working` | laps its desk | activity, else "Working…" | green | 1 |
| `waiting` | stands | activity, else "Waiting for you" | amber, pulsing | 1 |
| `done` | stands | activity, else "Done" | blue | 1 |
| `error` | stands, hurt frame | activity, else "Error" | red | 1 |
| `offline` | stands | none | none | 0.6 |

The host overrides any cell:

```ts
interface StatusStyle {
  motion?: "laps" | "stand"
  /** null hides the bubble; a string replaces the default. */
  bubble?: string | null
  /** The sheet pose to hold while standing. */
  frame?: "walk" | "hurt"
  halo?: string | null
  pulse?: boolean
  opacity?: number
}

<GameRoom agents={agents} statusStyles={{ waiting: { bubble: "Needs approval" } }} />
```

The "hurt" pose is column 5 of every stock sheet. It is drawn already and the
walk cycle never reaches it, so an error state costs no new art.

## Sub-agents

A child agent does not orbit a desk. It trails its parent: the parent keeps a
short ring buffer of recent positions, and the k-th follower reads the point
`k × SPACING` px back along that trail. A standing parent has its followers
line up behind it, facing the same way. Grandchildren extend the line in
depth-first order.

Status rolls up at the display layer only. `effectiveStatus(agent)` is
`working` when any descendant is working, else the agent's own status. The
host's data is never mutated.

A new child walks in from the south aisle to its slot in the line. The aisle
spawn and the walk-to path already exist for hub guests and are reused.

## Seating and scale

The room keeps its thirteen desks. Agents are seated in list order, up to six
per desk, so the grid holds seventy-eight before anyone stands in the aisle.
Past that, agents are placed in the open floor south of the last row and orbit
a small invisible bounds instead of a desk. There is no cap; a room of two
hundred renders, it is merely crowded.

Desk labels are gone with the teams. A desk is furniture. A later `group`
field on the agent could bring labels back by seating a group together, and
the seating code is written so that is a small change rather than a rewrite.

## The wall

The wall has one page and one interruption.

- **Board.** A title and a few lines the host supplies. When the host supplies
  nothing, the room writes its own summary: how many agents, how many working,
  how many waiting.
- **Bulletin.** Text that takes over the wall for a hold time, then hands it
  back. This is the alert channel: "3 agents are waiting for your reply".

```ts
board?: { title?: string; lines: string[] } | null
bulletin?: { text: string; holdSeconds?: number } | null
```

Both are props. With the hub in use, the gamemaster console can still push a
bulletin to every client, and it arrives through the same path.

## Interaction

- **Walk up and press E** on an agent fires `onAgentInteract(agent)`. The room
  does nothing else. The host can answer through the scene handle:
  `handle.say(agentId, text, ms)` puts a bubble over that agent.
- **Click or tap** an agent selects it, as the find box does now, and fires
  `onAgentSelect(agent | null)`.
- **Primey** keeps `onPrimeyInteract`.
- **Human to human** interaction stays on the hub and needs the hub.

## Props, in full

```ts
interface GameRoomProps {
  agents: Agent[]
  /** Omit for a spectator camera with no character. */
  me?: Visitor
  statusStyles?: Partial<Record<AgentStatus, StatusStyle>>
  board?: Board | null
  bulletin?: Bulletin | null
  onAgentInteract?: (agent: Agent) => void
  onAgentSelect?: (agent: Agent | null) => void
  onPrimeyInteract?: () => void
  onExit?: () => void
  header?: React.ReactNode
  /** Human multiplayer. Off by default; configureGameRoomApi says where. */
  hub?: boolean
  // easter eggs, unchanged
  arcadeUnlocked?: boolean
  onArcadeUnlock?: () => void | Promise<void>
  onDuelWin?: (houseDeck: DeckId) => void
}
```

`Visitor` is what `me` is today minus the team fields: an id, a name, a
sprite, and a free-text role used only for the halo colour.

## The hub after the cut

The hub stops knowing about a roster. It becomes a visitors' hub: which humans
are connected, where they are, who is talking to whom, chat, music, and the
bulletin. Agents never touch it. Every client seats the same agents from the
same props and runs the same seeded wander, so two clients see the same room
without the hub relaying agent positions.

Removed from the hub: roster loading, the doors and pre-event scoping,
presentation, winners, and the leaderboard and clock endpoints in the demo
server. Kept: the objects list for the plants and the backrooms unlock count.
Without a hub the backrooms count is kept locally, so the easter egg still
works single-player.

## The easter eggs after the cut

- **Arcade.** Unchanged. The Konami code is local.
- **Backrooms.** Unchanged except the unlock counter falls back to local
  state when there is no hub.
- **Table Stakes.** The duel is tied today to "exhibition" teams, which no
  longer exist. Two white desks become fixed furniture at the south of the
  room with nobody seated at them, and each keeps its house deck by position.
  The deck names stay as they are.
- **Thanos snap.** Unchanged.

## What gets deleted

Everything below exists only for the event. Each file goes with its tests.

**Library, `src/lib`:** `exchange-types`, `fair-value-engine-strip`,
`movement-trades`, `money`, `trade-scope`, `team-access`, `team-preassignment`,
`team-ranks`, `team-stats`, `student-access`, `presentation-order`,
`winners-ceremony`, `account-labels`, `announcement-voices`, `auth`,
`time` (the Singapore timezone), `game-room-control` (trimmed to the
bulletin), the DB and job-queue types in `roster` and `sprite-gen` (the sheet
constants stay).

**Scene, `src/components/gameRoom3d`:** `fireworks`, `crowns`, `crown-sprites`,
`rank-numerals`, `session-screen`, `useSessionClock`, `useMarketNews`,
`useMarketNewsPrewarm`, `market-news-video`, `broadcast-picture`,
`useAnnouncementVoice`, `PresentationBanner`, `WinnersBanner`,
`TeamStandings`, `presentation-audio`, `assignment-drag`, `useDoors`,
`team-tables`, `role-colors` (becomes status colours), `screen-pages`
(becomes the wall's board and bulletin).

**Server, `src/server`:** `exchange`, `market-news-clip`, `student-access`.

**Components:** `StudentSelector` becomes the agent finder. The gamemaster
console keeps MESSAGE TO THE ROOM and MUSIC and loses the rest.

**Inside `scene.ts`:** the leaderboard, clock and countdown painters, the
spotlight and room-dim rig, the medal and numeral sprites, the winners'
camera turn, the presentation replay clock, and the assignment drag.

Kept and untouched: the renderer, camera, lighting, backdrop city, time of
day, quality tiers, touch controls, the wardrobe and character picker, the
music, the menu and chat panel, and the three games.

## The scene file

`scene.ts` is 5,029 lines in one function. The deletions above take a large
share out. What remains is split after the deletions, not before, so the
split is a mechanical move of already-working code:

| Module | Owns |
| --- | --- |
| `scene/room.ts` | renderer, camera, lights, floor, walls, backdrop |
| `scene/furniture.ts` | desks, plants, the hatch, the cabinet, the white desks |
| `scene/characters.ts` | sprite meshes and sheets, the walk cycle, halos, bubbles |
| `scene/agents.ts` | status to motion, followers, walk-in and walk-out |
| `scene/wall.ts` | the screen texture: board and bulletin |
| `scene/input.ts` | keys, touch, picking, the facing probe |
| `scene/index.ts` | `createRoomScene` composing the above, `RoomSceneHandle` |

## Order of work

Each phase leaves `bun run test` and `bun run typecheck` green and is one
commit or a small series.

1. **Delete the event.** Remove the files listed above and the matching
   branches inside `scene.ts`, `GameRoom.tsx`, `GameRoom3D.tsx`, the hub, the
   demo server and the console. The room still renders teams at this point;
   it just has no standings, ceremonies or broadcasts.
2. **Introduce `Agent`.** Add `src/lib/agents.ts` with the types, the status
   defaults and `effectiveStatus`. Replace `teams` and `allPlayers` with
   `agents` through `GameRoom`, `GameRoom3D` and the scene's `players` input.
   Seat by list order. Wire status to motion and bubbles. Add
   `onAgentInteract`, `onAgentSelect` and `handle.say`.
3. **Followers.** The trail buffer, the line-up, status roll-up, and the
   walk-in for a new child.
4. **The wall.** Replace the page ring with board plus bulletin. Trim the
   console.
5. **The hub.** Drop the roster, seat visitors only, keep chat, music,
   bulletin and objects. Local fallback for the backrooms count. Fix the white
   desks as furniture for the duel.
6. **Split `scene.ts`.** Mechanical, module by module, with the tests
   unchanged.
7. **Demo and docs.** The demo host becomes a fake agent runtime: agents
   change status on a timer, spawn and retire children, and a button raises a
   bulletin. Rewrite the README around agents. Bump to 0.2.0.

## Open points to confirm during the build

- "Standing still with the walk cycle playing" is read literally: the
  character marches on the spot. If a standing frame is preferred it is one
  constant.
- The default bubble strings above are placeholders for the host to override.
- Followers of an agent that is itself in the aisle overflow, rather than at a
  desk, line up in the aisle. This is untested territory and may need spacing
  tuned by eye.
