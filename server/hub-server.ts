// The room's back end, in one file.
//
// Two jobs:
//
//   1. MULTIPLAYER. The hub (src/server/hub.ts) is the authority for what
//      every character in the room is doing; this serves it over SSE down and
//      POST up, which is the transport the client half already speaks.
//   2. THE GAMEMASTER'S CONTROLS. A bulletin and the room's music are room
//      state, so they are commands to the hub rather than anything a client
//      holds.
//
// Identity is a cookie, and deliberately not a security boundary: this is a
// demo host, not an auth system. Put your own in front of it before you point
// it at anything real.

import { randomUUID } from "node:crypto"
import { getGameRoomHub, setGameRoomRoster, type GuestUser } from "../src/server/hub"
import { parseChat, parseInteract, parsePlayerInput } from "../src/lib/gameRoomNet/protocol"
import { parseBulletinInput } from "../src/lib/game-room-control"
import { parseRoomMusicInput } from "../src/lib/game-room-music"
import { demoTeams } from "./demo-roster"

const PORT = Number(process.env.PORT ?? 8787)
/** Comment frames defeat idle-connection buffering in proxies. */
const KEEPALIVE_MS = 15_000

const teams = demoTeams()
setGameRoomRoster(teams)

/**
 * Visitors who are not on the roster — everyone, in the demo, since the
 * roster is desks of made-up people. The room seats a guest with no desk of
 * their own. They announce themselves on the way in (POST /api/identity); a
 * visitor the hub has never heard of is a spectator until they do.
 */
const guests = new Map<string, GuestUser>()

const hub = getGameRoomHub({
  loadGuest: async (userId) => guests.get(userId) ?? null,
})

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

  // -------------------------------------------------------- room controls
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
    hub.sendBulletin(input.message, { holdMs: input.holdSeconds * 1000 })
    return new Response(null, { status: 204 })
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
