// The gamemaster's grip on the room — what the control panel calls.
//
// Each of these is a command to the hub, which is the only thing that can
// carry it: a bulletin and the room's music are ROOM state, seen by everyone
// in it. So unlike the rest of ~/server, these are not "degrade to a local
// default" calls — without a hub there is no room to command, and the panel
// says so.
//
// The wire is the demo hub's /api/room/* routes (server/hub-server.ts). Point
// it elsewhere with configureGameRoomApi().

import type { RoomMusic } from "~/lib/game-room-music"
import { apiUrl } from "./client"

/**
 * A command, which THROWS when it does not land. The panel catches and toasts;
 * a control that silently did nothing would be worse than an error, because
 * the gamemaster would go on believing the room had heard them.
 */
async function command<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(detail || `The room hub refused that (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** The PA screens' music: one track, silence, or the playlist (null). */
export function setRoomMusicFn(input: { data: { music: RoomMusic } }): Promise<void> {
  return command<void>("/api/room/music", input.data)
}

export function broadcastRoomBulletinFn(input: {
  data: { message: string; holdSeconds: number }
}): Promise<void> {
  return command<void>("/api/room/bulletin", input.data)
}
