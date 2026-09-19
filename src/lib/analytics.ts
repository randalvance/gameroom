// Product analytics: a small, reviewed set of "someone did X" moments.
//
// In the original event site these went to Sentry as INFO logs. Standalone,
// the library ships no telemetry: `track()` hands the event to whatever sink
// the host installs with `setAnalyticsSink()` and does nothing otherwise, so
// embedding the room sends nothing anywhere until you ask it to.
//
// The registry stays because it is the contract: an event not listed here
// fails the typecheck, and each event declares the attributes it may carry.
export const analyticsEvents = {
  "primey.question_asked": { message: "Asked Primey a question", attributes: ["question", "surface"] },
  "easter_egg.menu_egg_hatched": { message: "Hatched a main-menu egg", attributes: ["pet"] },
  "easter_egg.backrooms_unlocked": { message: "Unlocked the Backrooms", attributes: [] },
  "easter_egg.arcade_unlocked": { message: "Unlocked the Impact Hackers cabinet", attributes: ["already_unlocked"] },
  "easter_egg.thanos_snapped": { message: "Snapped half the game room to dust", attributes: [] },
  "easter_egg.duel_opened": { message: "Table Stakes: challenged the house at a white desk", attributes: ["house"] },
  "easter_egg.duel_started": { message: "Table Stakes: duel started", attributes: ["deck", "house"] },
  "easter_egg.duel_finished": { message: "Table Stakes: duel finished", attributes: ["deck", "house", "won", "turns", "reason"] },
  "easter_egg.duel_left": { message: "Table Stakes: left the table before the end", attributes: ["deck", "house", "turn", "stage"] },
  "backrooms.all_enemies_defeated": { message: "Backrooms: defeated every enemy", attributes: [] },
  "backrooms.escaped": { message: "Backrooms: escaped after clearing every enemy", attributes: [] },
  "backrooms.newsroom_found": { message: "Backrooms: found Bernard's newsroom", attributes: [] },
  "backrooms.bernard_attacked": { message: "Backrooms: attacked Bernard", attributes: [] },
  "backrooms.killed_by_bernard": { message: "Backrooms: killed by Bernard", attributes: [] },
  "arcade.bernard_konami_unlocked": { message: "Impact Hackers: Konami code unlocked Bernard", attributes: ["already_unlocked"] },
  "arcade.match_started": { message: "Impact Hackers: match started", attributes: ["mode", "p1", "p2", "boss"] },
  "arcade.bernard_boss_reached": { message: "Impact Hackers: reached the Bernard boss", attributes: ["mode"] },
  "arcade.bernard_boss_beaten": { message: "Impact Hackers: beat the Bernard boss", attributes: ["mode"] },
  "sprite.ai_generation_started": { message: "Started an AI character generation", attributes: ["stage"] },
  "sprite.custom_sprite_used": { message: "Used a custom AI sprite", attributes: ["source"] },
  "game_room.chat_sent": { message: "Sent a game-room chat message", attributes: [] },
} as const satisfies Record<string, { message: string; attributes: readonly string[] }>

export type AnalyticsEvent = keyof typeof analyticsEvents
type AttributeValue = string | number | boolean
type AttributesFor<E extends AnalyticsEvent> = {
  [K in (typeof analyticsEvents)[E]["attributes"][number]]?: AttributeValue
}

export type AnalyticsActor = { id: string; name: string | null; email: string | null; role: string | null }

/** Longest free text that is passed on; the rest is cut. */
export const MAX_TEXT_LENGTH = 500

export interface AnalyticsRecord {
  event: AnalyticsEvent
  /** The event's human-readable message, from the registry above. */
  message: string
  actor: AnalyticsActor | null
  attributes: Record<string, AttributeValue>
}

/** Where tracked events go. Null (the default) drops them. */
export type AnalyticsSink = ((record: AnalyticsRecord) => void) | null

let actor: AnalyticsActor | null = null
let sink: AnalyticsSink = null

/** Who is playing, for the records a sink receives. */
export function setAnalyticsActor(next: AnalyticsActor | null) {
  actor = next
}

/** Install a sink (your own analytics), or null to go back to dropping. */
export function setAnalyticsSink(next: AnalyticsSink) {
  sink = next
}

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return typeof value === "string" && Object.hasOwn(analyticsEvents, value)
}

/**
 * The attributes an event may carry, rebuilt from the registry: anything a
 * caller passes that the event did not declare is dropped rather than
 * forwarded, so a sink can never be handed a field nobody reviewed.
 */
export function allowedAnalyticsAttributes<E extends AnalyticsEvent>(
  event: E,
  attributes: Record<string, unknown>,
): Record<string, AttributeValue> {
  const kept: Record<string, AttributeValue> = {}
  for (const key of analyticsEvents[event].attributes as readonly string[]) {
    const value = attributes[key]
    if (typeof value === "string") kept[key] = value.slice(0, MAX_TEXT_LENGTH)
    else if (typeof value === "number" || typeof value === "boolean") kept[key] = value
  }
  return kept
}

export function track<E extends AnalyticsEvent>(event: E, attributes: AttributesFor<E> = {}) {
  const to = sink
  if (!to) return
  try {
    to({
      event,
      message: analyticsEvents[event].message,
      actor,
      attributes: allowedAnalyticsAttributes(event, attributes as Record<string, unknown>),
    })
  } catch {
    // Analytics never breaks the thing being measured.
  }
}
