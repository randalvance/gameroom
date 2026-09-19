// The room's log, as a registry.
//
// Same shape as the event site it came from: only the messages listed here may
// be logged, so a log line is a reviewed string and never a leaked id, URL or
// API response. What differs is the destination — the site shipped these to
// Sentry; standalone they go to the console, or to whatever sink the host
// installs with `setLogSink()`.

const events = {
  "game_room.connected": "Game room client connected",
  "game_room.disconnected": "Game room client disconnected",
  "game_room.presentation_drawn": "Gamemaster drew the presentation running order",
  "game_room.winners_started": "Gamemaster started the winner announcement",
  "game_room.winner_announced": "Gamemaster announced a podium place",
  "room3d.quality_reduced": "3D frame budget missed; reducing quality",
  "room3d.init_failed": "3D room failed to initialise",
  "room3d.cleanup_failed": "3D room cleanup threw",
  "room3d.sprite_decode_failed": "A character sheet failed to decode",
  "room3d.guest_decode_failed": "A visitor's character sheet failed to decode",
  "duel.chunk_load_failed": "Table Stakes failed to load",
  "room.control_call_failed": "A room control call failed",
} as const satisfies Record<string, string>

export type LogEvent = keyof typeof events
export type LogLevel = "info" | "warn" | "error"

export interface LogRecord {
  level: LogLevel
  event: LogEvent
  message: string
  /**
   * Local diagnostics — the Error, the response, the id. Handed to the sink
   * and to the console, never folded into `message`: what a log SAYS stays the
   * reviewed string above, whatever a caller passes alongside it.
   */
  details: unknown[]
}

export type LogSink = ((record: LogRecord) => void) | null

const consoleSink: LogSink = (record) => {
  const line = `[gameroom] ${record.event}: ${record.message}`
  if (record.level === "error") console.error(line, ...record.details)
  else if (record.level === "warn") console.warn(line, ...record.details)
  else console.info(line, ...record.details)
}

let sink: LogSink = consoleSink

/** Send log records somewhere else, or nowhere (null). */
export function setLogSink(next: LogSink) {
  sink = next
}

/** Back to the console. */
export function resetLogSink() {
  sink = consoleSink
}

function emit(level: LogLevel, event: LogEvent, details: unknown[]) {
  try {
    sink?.({ level, event, message: events[event], details })
  } catch {
    // Logging never breaks the thing being logged.
  }
}

export const logger = {
  info: (event: LogEvent, ...details: unknown[]) => emit("info", event, details),
  warn: (event: LogEvent, ...details: unknown[]) => emit("warn", event, details),
  error: (event: LogEvent, ...details: unknown[]) => emit("error", event, details),
}
