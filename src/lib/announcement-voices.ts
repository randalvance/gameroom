// Who reads a room announcement aloud, and what they actually say.
//
// Pure and shared: the console's GAME ROOM tab renders this list as a
// dropdown, and the server validates the chosen id against the same list
// rather than passing client input straight to a metered vendor. The console
// is admin-only, but an unvalidated passthrough is a bad shape regardless of
// who can reach it.
//
// Voice ids are ElevenLabs' public identifiers, not credentials — safe in the
// client bundle. ADDING A VOICE IS ONE LINE HERE and nothing else.

export interface AnnouncementVoice {
  /** ElevenLabs voice id. */
  id: string
  /** What the gamemaster sees in the dropdown. */
  label: string
}

export const ANNOUNCEMENT_VOICES: readonly AnnouncementVoice[] = [
  // FIRST IS THE DEFAULT — see DEFAULT_ANNOUNCEMENT_VOICE_ID below. Reordering
  // this list changes which announcer an unconfigured send uses.
  { id: "HDVDearvsECwhyI3Y21m", label: "Default Announcer" },
  { id: "DGzg6RaUqxGRTHSBjfgF", label: "Sergeant Brock" },
  { id: "nPczCjzI2devNBz1zQrb", label: "Brian" },
  { id: "tnSpp4vdxKPjI9w0GnoV", label: "Hope" },
  { id: "pPdl9cQBQq4p6mRkZy2Z", label: "Emma" },
  { id: "qXpMhyvQqiRxWQs4qSSB", label: "Horatius" },
]

export const DEFAULT_ANNOUNCEMENT_VOICE_ID = ANNOUNCEMENT_VOICES[0]!.id

/**
 * The chosen voice, or the default when nothing was chosen.
 *
 * Null — not the default — for an id that is not ours, so the caller can
 * refuse rather than quietly speak in a voice nobody picked.
 */
export function resolveVoiceId(voiceId: string | undefined | null): string | null {
  if (!voiceId) return DEFAULT_ANNOUNCEMENT_VOICE_ID
  return ANNOUNCEMENT_VOICES.some((voice) => voice.id === voiceId) ? voiceId : null
}

/**
 * How every spoken announcement opens.
 *
 * The pause is the whole point: the announcer takes a beat before the message
 * rather than running the two together. An ELLIPSIS rather than a comma
 * (barely a breath) and rather than ElevenLabs' `<break time="1.5s" />` tag —
 * break tags give exact control but are not supported by every model, and a
 * model that does not support one reads it ALOUD. "break time equals one point
 * five seconds" over a venue PA is not a failure worth risking for a tighter
 * pause. Ellipsis is prosody punctuation every model understands.
 *
 * Overridable at runtime by ANNOUNCEMENT_PREFIX in the environment, so a break
 * tag can be tried against a real account without a deploy — see
 * ~/server/announcement-prefix.
 *
 * Added to the SPOKEN text only: the wall's own header already reads
 * ANNOUNCEMENT, so putting it in the visible text would say it twice.
 */
export const ANNOUNCEMENT_PREFIX = "Important Announcement... "

/**
 * What the announcer reads for a given message.
 *
 * `prefix` exists so the server can pass an environment override; it defaults
 * to the constant above, which is what every caller without a reason to differ
 * should use.
 */
export function spokenAnnouncement(message: string, prefix = ANNOUNCEMENT_PREFIX): string {
  const text = message.trim()
  // A message that already opens with the prefix is not given a second one —
  // re-sending a copied announcement should not stutter.
  return text.startsWith(prefix) ? text : `${prefix}${text}`
}
