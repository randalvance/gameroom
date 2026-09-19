// The room's back end, in one file.
//
// Two jobs:
//
//   1. MULTIPLAYER. The hub (src/server/hub.ts) is the authority for what
//      every character in the room is doing; this serves it over SSE down and
//      POST up, which is the transport the client half already speaks.
//   2. THE GAMEMASTER'S CONTROLS. The wall screen, the bulletins, the running
//      order and the podium are room state, so they are commands to the hub
//      rather than anything a client holds.
//
// Everything else it answers (the standings, the trading clock, the doors) is
// DEMO DATA. The room reads those the way a page reads any feed — swap these
// handlers for your own and the room does not know the difference.
//
// Identity is a cookie, and deliberately not a security boundary: this is a
// demo host, not an auth system. Put your own in front of it before you point
// it at anything real.

import { randomUUID } from "node:crypto"
import { getGameRoomHub, setGameRoomRoster, type GuestUser } from "../src/server/hub"
import { parseChat, parseInteract, parsePlayerInput } from "../src/lib/gameRoomNet/protocol"
import { parseBulletinInput, parseScreenPageInput } from "../src/lib/game-room-control"
import { parseRoomMusicInput } from "../src/lib/game-room-music"
import type { PodiumPlace } from "../src/lib/winners-ceremony"
import { demoLeaderboard, demoTeams } from "./demo-roster"

const PORT = Number(process.env.PORT ?? 8787)
/** Comment frames defeat idle-connection buffering in proxies. */
const KEEPALIVE_MS = 15_000
/** The demo's trading window: long enough that the wall clock is always ticking. */
const WINDOW_SECONDS = 45 * 60

const teams = demoTeams()
setGameRoomRoster(teams)

/**
 * Visitors who are not on the roster — everyone, in the demo, since the
 * roster is twelve desks of made-up students. The room seats a guest with no
 * desk of their own, which is also how mentors, judges and staff arrive at the
 * real event. They announce themselves on the way in (POST /api/identity);
 * a visitor the hub has never heard of is a spectator until they do.
 */
const guests = new Map<string, GuestUser>()

const hub = getGameRoomHub({
  loadGuest: async (userId) => guests.get(userId) ?? null,
})
const leaderboard = demoLeaderboard(teams)
const startedAt = Date.now()

/** The event's scripted announcements — the panel's one-press buttons. */
const PRESETS = [
  {
    id: "open",
    label: "MARKET OPEN",
    message: "The market is open. Good luck, everyone.",
    affectedSymbol: "",
  },
  {
    id: "ten-minutes",
    label: "TEN MINUTES LEFT",
    message: "Ten minutes to the close. Flatten what you cannot carry.",
    affectedSymbol: "",
  },
  {
    id: "halt",
    label: "TRADING HALT",
    message: "Trading in ACME is halted pending an announcement.",
    affectedSymbol: "ACME",
  },
]

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 })
}

/**
 * Who is connecting. A cookie if the page set one, otherwise a fresh id — so
 * two browsers are two people and a visitor with no cookie still gets a
 * character rather than a refusal.
 */
function userIdFor(request: Request): string {
  const cookie = request.headers.get("cookie") ?? ""
  const match = /(?:^|;\s*)gameroom_uid=([^;]+)/.exec(cookie)
  return match ? decodeURIComponent(match[1]!) : `anon-${randomUUID().slice(0, 8)}`
}

async function body(request: Request): Promise<unknown> {
  return request.json().catch(() => null)
}

function stream(request: Request): Response {
  const encoder = new TextEncoder()
  const userId = userIdFor(request)

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (text: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          closed = true
        }
      }

      const unsubscribe = await hub.subscribe(userId, send)
      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS)

      const cleanup = () => {
        closed = true
        clearInterval(keepalive)
        unsubscribe()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      if (request.signal.aborted) cleanup()
      else request.signal.addEventListener("abort", cleanup)
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell an nginx-style proxy not to buffer this.
      "X-Accel-Buffering": "no",
    },
  })
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const post = request.method === "POST"

  // ------------------------------------------------------------ multiplayer
  if (path === "/api/identity" && post) {
    const input = (await body(request)) as Partial<GuestUser> | null
    const id = userIdFor(request)
    if (!input || typeof input.name !== "string") return badRequest("INVALID_INPUT")
    guests.set(id, {
      id,
      name: input.name.trim() || "Visitor",
      role: input.role ?? "student",
      spriteId: typeof input.spriteId === "number" ? input.spriteId : null,
      spriteSheet: typeof input.spriteSheet === "string" ? input.spriteSheet : null,
    })
    return new Response(null, { status: 204 })
  }

  if (path === "/api/game-room/stream") return stream(request)

  if (path === "/api/game-room/input" && post) {
    const input = parsePlayerInput(await body(request))
    if (!input) return badRequest("INVALID_INPUT")
    hub.handleInput(userIdFor(request), input)
    return new Response(null, { status: 204 })
  }

  if (path === "/api/game-room/interact" && post) {
    const msg = parseInteract(await body(request))
    if (!msg) return badRequest("INVALID_INPUT")
    return json(hub.handleInteract(userIdFor(request), msg.targetIdx))
  }

  if (path === "/api/game-room/chat" && post) {
    const msg = parseChat(await body(request))
    if (!msg) return badRequest("INVALID_INPUT")
    const result = hub.handleChat(userIdFor(request), msg.text)
    if (!result.ok) {
      return json({ error: result.error }, result.error === "NOT_LIVE" ? 403 : 429)
    }
    return json({ ok: true })
  }

  if (path === "/api/game-room/dismiss" && post) {
    // The hub is the authority: a dismissal before the typewriter has finished
    // is refused, so a client can never unfreeze itself ahead of the room.
    const ok = hub.handleDismiss(userIdFor(request))
    return ok ? new Response(null, { status: 204 }) : json({ error: "TOO_EARLY" }, 409)
  }

  // ------------------------------------------------------------- demo feeds
  if (path === "/api/roster") return json(teams)
  if (path === "/api/leaderboard") return json(leaderboard)
  if (path === "/api/doors") {
    // Open. A host with a gate answers a future `opensAtMs` and the room turns
    // itself into a waiting room, counting on the server's clock.
    return json({ opensAtMs: 0, serverNowMs: Date.now() })
  }
  if (path === "/api/session") {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000) % WINDOW_SECONDS
    return json({
      id: "demo-window",
      status: "running",
      mode: "demo",
      startedAt: new Date(startedAt).toISOString(),
      elapsedSeconds: elapsed,
      durationSeconds: WINDOW_SECONDS,
      remainingSeconds: WINDOW_SECONDS - elapsed,
    })
  }
  // No filmed broadcasts ship with the library: every bulletin is a text
  // banner, which is the path an ad-hoc announcement already takes.
  if (path === "/api/market-news/clips") return json([])
  if (path === "/api/market-news/broadcast" && post) return json(null)

  // -------------------------------------------------------- room controls
  if (path === "/api/room/announcement-presets") return json(PRESETS)

  if (path === "/api/room/screen" && post) {
    try {
      hub.setScreenPage(parseScreenPageInput(await body(request)))
    } catch (error) {
      return badRequest((error as Error).message)
    }
    return new Response(null, { status: 204 })
  }

  if (path === "/api/room/music" && post) {
    try {
      hub.setMusic(parseRoomMusicInput(await body(request)))
    } catch (error) {
      return badRequest((error as Error).message)
    }
    return new Response(null, { status: 204 })
  }

  if (path === "/api/room/bulletin" && post) {
    let input
    try {
      input = parseBulletinInput(await body(request))
    } catch (error) {
      return badRequest((error as Error).message)
    }
    hub.sendBulletin(input.message, input.affectedSymbol, { holdMs: input.holdSeconds * 1000 })
    // No speech vendor here, so nothing read it aloud. Not an error: the site
    // this came from reports the same when no voice is configured.
    return json({ spoken: false, voiceError: null })
  }

  const presentationView = () => json({
    state: hub.getPresentation(),
    teams: teams.filter((t) => t.competing !== false).map((t) => ({ id: t.id, name: t.name })),
  })
  const winnersView = () => json({
    state: hub.getWinners(),
    teams: teams.filter((t) => t.competing !== false).map((t) => ({ id: t.id, name: t.name })),
  })

  if (path === "/api/room/presentation") return presentationView()
  if (path === "/api/room/presentation/randomize" && post) {
    // Exhibition desks are seated but out of the draw, the same rule the
    // podium follows.
    const order = teams.filter((t) => t.competing !== false).map((t) => t.id)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j]!, order[i]!]
    }
    hub.setPresentationOrder(order)
    return presentationView()
  }
  if (path === "/api/room/presentation/spotlight" && post) {
    const input = (await body(request)) as { teamId?: string | null } | null
    hub.setPresentationSpotlight(input?.teamId ?? null)
    return presentationView()
  }
  if (path === "/api/room/presentation/clear" && post) {
    hub.setPresentationOrder(null)
    return presentationView()
  }
  if (path === "/api/room/presentation/done" && post) {
    const input = (await body(request)) as { teamId?: string; done?: boolean } | null
    if (!input?.teamId) return badRequest("INVALID_INPUT: teamId required")
    hub.setPresentationDone(input.teamId, input.done !== false)
    return presentationView()
  }

  if (path === "/api/room/winners") return winnersView()
  if (path === "/api/room/winners/start" && post) {
    hub.startWinners()
    return winnersView()
  }
  if (path === "/api/room/winners/announce" && post) {
    const input = (await body(request)) as { place?: number; teamId?: string } | null
    if (!input?.teamId || !input.place) return badRequest("INVALID_INPUT: place and teamId required")
    // The hub enforces the order — third, then second, then first — so a place
    // out of turn is refused here rather than half-applied.
    if (!hub.announceWinner(input.place as PodiumPlace, input.teamId)) {
      return badRequest("That place is not the next one to read.")
    }
    return winnersView()
  }
  if (path === "/api/room/winners/end" && post) {
    hub.clearWinners()
    return winnersView()
  }

  return new Response("Not found", { status: 404 })
}

const server = Bun.serve({
  port: PORT,
  // SSE connections are held open for as long as the visitor is in the room.
  idleTimeout: 0,
  fetch: handle,
})

console.log(`[gameroom] hub listening on http://localhost:${server.port}`)
console.log(`[gameroom] ${teams.length} desks seated, ${teams.reduce((n, t) => n + t.players.length, 0)} characters`)
