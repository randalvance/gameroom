// Pure parsing/projection for the email → team pre-assignment roster.
//
// CLIENT-IMPORTABLE: no @c2i/db, no Clerk. The admin panel parses the pasted
// roster here so it can show what will happen BEFORE anything is written, and
// the server re-parses the same text with the same function so the preview and
// the write can never disagree (and so a hand-crafted request cannot smuggle
// in a row the preview would have rejected).
//
// The db-touching half lives in ~/server/team-preassign-admin.ts; the sign-in
// side that consumes these rows is ~/server/team-preassign.ts.

export interface PreassignmentTeam {
  id: string
  name: string
}

export interface PreassignmentEntry {
  email: string
  teamId: string
}

export type PreassignmentRejection =
  | "BAD_EMAIL"
  | "MISSING_TEAM"
  | "UNKNOWN_TEAM"
  | "DUPLICATE_EMAIL"

export interface PreassignmentRejectedLine {
  lineNumber: number
  text: string
  reason: PreassignmentRejection
}

export interface ParsedPreassignmentRoster {
  entries: PreassignmentEntry[]
  rejected: PreassignmentRejectedLine[]
}

export interface PreassignmentRow {
  email: string
  teamId: string
  // Denormalized for display — the panel lists the roster grouped by team.
  teamName: string
}

export interface PreassignmentBoard {
  teams: PreassignmentTeam[]
  rows: PreassignmentRow[]
}

export const REJECTION_COPY: Readonly<Record<PreassignmentRejection, string>> = {
  BAD_EMAIL: "NOT AN EMAIL ADDRESS",
  MISSING_TEAM: "NO TEAM ON THIS LINE",
  UNKNOWN_TEAM: "NO SUCH TEAM",
  DUPLICATE_EMAIL: "EMAIL REPEATED IN THIS PASTE",
}

// The ONE normalizer for pre-assignment emails — the sign-in lookup imports it
// from here too (server/team-preassign.ts), because the key written by the
// roster must be byte-identical to the key looked up when the student appears.
// It lives on the client side of the fence so the panel can normalize as well;
// the server module cannot host it (it imports @c2i/db).
export function normalizeRosterEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  const email = raw.trim().toLowerCase()
  if (!email.includes("@")) return null
  if (email.length > 320) return null
  // One address per line — a stray separator means the line was misread.
  if (/\s/.test(email)) return null
  return email
}

// A roster arrives in whatever shape the spreadsheet exported it: comma,
// semicolon or tab separated, sometimes with quoted fields, and — since a CSV
// can now be imported wholesale — often with columns nobody asked for
// ("name, email, team, university"). So the line is split into ALL its fields
// and the meaningful two are RECOGNIZED rather than assumed to be first and
// second: the field that is an email address, and the field that names a known
// team. Extra columns are then simply ignored.
export function splitRosterFields(line: string): string[] {
  return line.split(/[,;\t]/).map(unquote)
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/**
 * Parse a pasted or imported roster into rows ready to upsert.
 *
 * Each line must carry an email address and a team — the team as its id
 * ("TEAM_01") or its display name ("TEAM 01"), matched case-insensitively,
 * because the organizer's spreadsheet says whichever the organizer typed.
 * Order does not matter and extra columns are ignored, so a CSV exported as
 * `name,email,team,university` works untouched. Blank lines, `#` comments and
 * a header row are skipped.
 *
 * Nothing throws: every unusable line comes back in `rejected` with a reason,
 * because the panel's job is to show the operator exactly which lines of a
 * fifty-line import need fixing, not to refuse the file.
 */
export function parsePreassignmentRoster(
  text: string,
  teams: readonly PreassignmentTeam[],
): ParsedPreassignmentRoster {
  const byId = new Map(teams.map((team) => [team.id.toLowerCase(), team.id]))
  const byName = new Map(teams.map((team) => [team.name.trim().toLowerCase(), team.id]))
  const resolveTeam = (value: string): string | null => {
    const key = value.trim().toLowerCase()
    if (key === "") return null
    return byId.get(key) ?? byName.get(key) ?? null
  }

  const entries: PreassignmentEntry[] = []
  const rejected: PreassignmentRejectedLine[] = []
  const seen = new Set<string>()

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (line === "" || line.startsWith("#")) return

    const fields = splitRosterFields(line)
    const emailIndex = fields.findIndex((field) => normalizeRosterEmail(field) !== null)
    if (emailIndex === -1) {
      // A header row ("name,email,team") names the columns and holds no
      // address — skip it rather than reporting it as a broken student.
      if (fields.some((field) => field.toLowerCase() === "email")) return
      rejected.push({ lineNumber, text: line, reason: "BAD_EMAIL" })
      return
    }
    const email = normalizeRosterEmail(fields[emailIndex] ?? "") as string

    const others = fields.filter((field, at) => at !== emailIndex && field !== "")
    // First recognized team wins; the joined remainder is the fallback for a
    // team whose NAME contains the separator ("TEAM 01, Alpha").
    const teamId =
      others.map(resolveTeam).find((match): match is string => match !== null) ??
      resolveTeam(others.join(", "))
    if (!teamId) {
      rejected.push({
        lineNumber,
        text: line,
        reason: others.length === 0 ? "MISSING_TEAM" : "UNKNOWN_TEAM",
      })
      return
    }

    // Last line wins would silently pick one of two contradictory rows; say so
    // instead, and keep the first.
    if (seen.has(email)) {
      rejected.push({ lineNumber, text: line, reason: "DUPLICATE_EMAIL" })
      return
    }
    seen.add(email)
    entries.push({ email, teamId })
  })

  return { entries, rejected }
}

export interface PreassignmentSaveInput {
  text: string
}

export function assertPreassignmentSaveInput(input: unknown): PreassignmentSaveInput {
  const text = (input as { text?: unknown } | null)?.text
  if (typeof text !== "string") throw new Error("text is required")
  // A guard against a pasted file rather than a pasted roster; the panel's
  // textarea carries the same limit.
  if (text.length > 200_000) throw new Error("roster is too large")
  return { text }
}

export interface PreassignmentDeleteInput {
  email: string
}

export function assertPreassignmentDeleteInput(input: unknown): PreassignmentDeleteInput {
  const raw = (input as { email?: unknown } | null)?.email
  if (typeof raw !== "string") throw new Error("email is required")
  const email = normalizeRosterEmail(raw)
  if (!email) throw new Error("email is not an address")
  return { email }
}
