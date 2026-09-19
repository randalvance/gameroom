// The gamemaster's grip on the room — what the GAME ROOM control panel calls.
//
// Every one of these is a command to the hub, which is the only thing that can
// carry them: the wall screen, the bulletins, the running order and the podium
// are all ROOM state, seen by everyone in it. So unlike the rest of ~/server,
// these are not "degrade to a local default" calls — without a hub there is no
// room to command, and the panel says so.
//
// The wire is the demo hub's /api/room/* routes (server/hub-server.ts). Point
// it elsewhere with configureGameRoomApi().

import type { PresentationState } from "~/lib/presentation-order"
import type { RoomMusic } from "~/lib/game-room-music"
import type { PodiumPlace, WinnersState } from "~/lib/winners-ceremony"
import type { ScreenPage } from "~/components/gameRoom3d/screen-pages"
import { apiUrl } from "./client"

export interface BulletinResult {
  /** Did the room get a voice reading it, as well as the banner? */
  spoken: boolean
  /** Why not, when a voice was configured but failed. Null otherwise — a
   * deployment with no speech vendor is not an error. */
  voiceError: string | null
}

/** What the PRESENTATION ORDER card reads: the order, and the teams to name it with. */
export interface PresentationView {
  state: PresentationState | null
  teams: Array<{ id: string; name: string }>
}

/** What the WINNER ANNOUNCEMENT card reads: the podium, and the teams for it. */
export interface WinnersView {
  state: WinnersState | null
  teams: Array<{ id: string; name: string }>
}

/** One of the event's scripted announcements, offered as a button. */
export interface AnnouncementPreset {
  id: string
  label: string
  message: string
  affectedSymbol: string
}

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

async function read<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`The room hub is not answering (${res.status})`)
  return (await res.json()) as T
}

// ------------------------------------------------------------- wall and music

export function setRoomScreenFn(input: { data: { page: ScreenPage | null } }): Promise<void> {
  return command<void>("/api/room/screen", input.data)
}

/** The PA screens' music: one track, silence, or the playlist (null). */
export function setRoomMusicFn(input: { data: { music: RoomMusic } }): Promise<void> {
  return command<void>("/api/room/music", input.data)
}

export function broadcastRoomBulletinFn(input: { data: unknown }): Promise<BulletinResult> {
  return command<BulletinResult>("/api/room/bulletin", input.data)
}

/**
 * The spoken audio for one announcement. The event site generated this with a
 * speech vendor; standalone there is none, so the room reads its bulletins
 * silently and this always answers null — the path the site itself takes when
 * no voice is configured.
 */
export function takeRoomSpeechFn(_input: {
  data: { nonce: number }
}): Promise<{ audioBase64: string } | null> {
  return Promise.resolve(null)
}

/** The event's scripted announcements. Empty is a fine answer: the card falls
 * back to a typed message. */
export function getAnnouncementPresetsFn(): Promise<AnnouncementPreset[]> {
  return read<AnnouncementPreset[]>("/api/room/announcement-presets")
}

// ------------------------------------------------------------- presentations

export function getPresentationFn(): Promise<PresentationView> {
  return read<PresentationView>("/api/room/presentation")
}

export function randomizePresentationFn(): Promise<PresentationView> {
  return command<PresentationView>("/api/room/presentation/randomize")
}

export function setPresentationSpotlightFn(input: {
  data: { teamId: string | null }
}): Promise<PresentationView> {
  return command<PresentationView>("/api/room/presentation/spotlight", input.data)
}

export function clearPresentationFn(): Promise<PresentationView> {
  return command<PresentationView>("/api/room/presentation/clear")
}

export function setPresentationDoneFn(input: {
  data: { teamId: string; done: boolean }
}): Promise<PresentationView> {
  return command<PresentationView>("/api/room/presentation/done", input.data)
}

// ------------------------------------------------------------------- winners

export function getWinnersFn(): Promise<WinnersView> {
  return read<WinnersView>("/api/room/winners")
}

export function startWinnersFn(): Promise<WinnersView> {
  return command<WinnersView>("/api/room/winners/start")
}

export function announceWinnerFn(input: {
  data: { place: PodiumPlace; teamId: string }
}): Promise<WinnersView> {
  return command<WinnersView>("/api/room/winners/announce", input.data)
}

export function endWinnersFn(): Promise<WinnersView> {
  return command<WinnersView>("/api/room/winners/end")
}
