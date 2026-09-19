// Client-safe half of sprite generation: the sheet contract, the DTO shapes
// the server functions return, and the pure pixel utilities (chroma key, PNG
// header checks) shared by the browser processing step and the server-side
// assign validation. No @c2i/db imports here — same split as lib/roster.ts.

// ---------------------------------------------------------------------------
// Sheet contract
// ---------------------------------------------------------------------------
// A generated sheet is a 6×4 grid: the four ROWS are facing directions (down,
// left, right, up), the six COLUMNS are poses — 0,1,2 are the walk steps, 3
// and 4 are the two attack frames, 5 is the hurt frame. Cells are 32 wide and
// 48 tall, so a finished sheet is exactly 192×192. The ComfyUI output arrives
// at 768×768 (each art pixel a 4×4 block) on a flat background; the browser
// downsamples and keys it out before the sheet is ever stored.
//
// This layout replaced a 4×4 / 32×32 / 128×128 one, and replaced it OUTRIGHT:
// there is exactly one sheet format now, and every sheet — shipped stock art,
// freshly generated, or already sitting in users.sprite_sheet — is read as
// this one. A sheet still in the old layout is not detected and gracefully
// handled; it renders visibly wrong, which is the intended signal that it
// needs converting. (Deliberate — see the note on sheetFormatFor.)

export const SPRITE_COLS = 6
export const SPRITE_ROWS = 4
export const SPRITE_CELL_W = 32
export const SPRITE_CELL_H = 48
export const SPRITE_SHEET_W = SPRITE_COLS * SPRITE_CELL_W // 192
export const SPRITE_SHEET_H = SPRITE_ROWS * SPRITE_CELL_H // 192

/** Classic 3-step walk played as a ping-pong; later columns are poses. */
export const WALK_FRAME_SEQUENCE = [0, 1, 2, 1] as const

/** Whether a stored sheet's pixel dimensions are the contract above. */
export function isSupportedSheetSize(width: number, height: number): boolean {
  return width === SPRITE_SHEET_W && height === SPRITE_SHEET_H
}

// ---------------------------------------------------------------------------
// Server-fn result shapes. Refusals travel as data, never as thrown values —
// a thrown Response does not survive the seroval boundary (see the note in
// server/roster-links.ts), and every refusal here carries a message the modal
// has to show the admin.
// ---------------------------------------------------------------------------

// Generation is asynchronous: starting a job submits it to Comfy Cloud and
// returns the job id; the caller (or any later UI session — the job survives
// refreshes) observes completion by polling spriteJobStatusFn. One job per
// user at a time.

export type SpriteJobKind = "base" | "sheet"

export type StartJobResult =
  /** remaining = generations left in the caller's budget; null = unlimited. */
  | { ok: true; jobId: string; remaining: number | null }
  | {
      ok: false
      reason:
        /** The Haiku gate judged the prompt to not describe a drawable character. */
        | "prompt-rejected"
        /** The vision gate judged the image unsuitable or not a humanoid character. */
        | "image-rejected"
        /** The caller has spent their whole generation budget. */
        | "limit-reached"
        /** The caller's one job slot is occupied — poll it instead. */
        | "busy"
        /** Too many generations in flight event-wide — costs no budget. */
        | "queue-full"
        | "not-configured"
        | "upstream"
      message: string
    }

// ---------------------------------------------------------------------------
// Queue arithmetic, shared so the modal and /character compute the same ETA
// the server reasons with. Constants from measuring the live account
// (2026-08-15): jobs run CONCURRENTLY (3 submitted together all overlapped;
// wait ~2s at that depth), and a realistic uncached job executes in ~10-20s.
// ---------------------------------------------------------------------------

/** Conservative per-job wall time, seconds. */
export const QUEUE_SECONDS_PER_JOB = 20
/** Concurrency the account demonstrably sustains — used only for ETA math. */
export const QUEUE_ASSUMED_CONCURRENCY = 3

/** Rough seconds until a job with `ahead` jobs in front of it finishes. */
export function queueEtaSeconds(ahead: number): number {
  return (Math.floor(Math.max(0, ahead) / QUEUE_ASSUMED_CONCURRENCY) + 1) * QUEUE_SECONDS_PER_JOB
}

/** Event-wide generation load, for the "maybe just skip" nudge. */
export interface QueueDepthView {
  /** Generations currently in flight across all students. */
  inFlight: number
  /** Rough seconds a NEW job would take end-to-end right now. */
  etaSeconds: number
}

// ---------------------------------------------------------------------------
// Admin job tracking (/admin/sprite-jobs) — one row per sprite_generations
// entry, newest first, with the account resolved to something readable.
// ---------------------------------------------------------------------------

export interface AdminSpriteJobRow {
  id: number
  /** Mirrored display name, else username, else the raw user id. */
  user: string
  kind: "base" | "sheet"
  status: "running" | "done" | "failed"
  /** Comfy prompt id — or "upload-…" for a base image the student uploaded. */
  jobId: string
  startedAt: string
  /** null while running, and for rows that never recorded an outcome. */
  completedAt: string | null
  /** Authenticated asset-proxy URL for the archived output, when one exists. */
  outputUrl: string | null
}

export interface AdminSpriteJobsView {
  jobs: AdminSpriteJobRow[]
  /** In-flight now (the admission-control count) vs the cap it refuses at. */
  inFlight: number
  cap: number
  /** Totals over the listed window, so the summary matches the table. */
  done: number
  failed: number
  /** The server's clock when this was read. A running job's duration is
   * rendered from it on BOTH the server and the hydrating browser, so the two
   * agree; the browser's own clock only takes over after mount. */
  serverNowMs: number
}

/** A completed base-image + sprite-sheet pair from the caller's history —
 * what the "previous generations" strip lists and the profile page will show
 * side by side. URLs point at the authenticated asset proxy
 * (/api/sprite-assets/$id); sheetUrl is the RAW archived sheet, so a caller
 * re-selecting it keys the background out in the browser exactly like a
 * fresh generation. */
export interface GenerationPairView {
  sheetGenerationId: number
  /** Comfy job id of the sheet generation. */
  jobId: string
  createdAt: string
  sheetUrl: string
  /** Full base image (generated or uploaded); null if its asset never archived. */
  baseUrl: string | null
  /** Comfy job id of that base — carried so re-selecting a pair can record a
   * draft that resumes with BOTH halves, not just the sheet. */
  baseJobId: string | null
}

/** What the caller's job slot holds right now. "done" is delivered exactly
 * once — the poll that sees completion consumes the slot. */
export type SpriteJobView =
  | { state: "none" }
  | {
      state: "running"
      kind: SpriteJobKind
      jobId: string
      /** True while the job is WAITING for a slot; false once it is actually
       * being drawn. The UI says different things for the two — "3 ahead of
       * you" is reassuring, "drawing" is progress, and one spinner for both
       * is what makes people give up. */
      queued: boolean
      /** In-flight jobs submitted before this one, event-wide; undefined when
       * the count could not be read (never blocks the poll). */
      queuedAhead?: number
    }
  | { state: "done"; kind: SpriteJobKind; jobId: string; imageDataUrl: string }
  | { state: "failed"; kind: SpriteJobKind; jobId: string; message: string }

// ---------------------------------------------------------------------------
// Wizard draft — what the dialog was in the middle of.
//
// users.sprite_job only survives a RUNNING job, so a confirmed base image
// lived in React state alone: closing the dialog threw it away and cost a
// budget unit to redo. The draft persists the STEP and the ids of whatever
// has been produced so far; the images themselves are rehydrated from the
// archived assets, so this stays tiny and never holds a data URL.
// ---------------------------------------------------------------------------

export type SpriteStep = "prompt" | "base" | "sheet"

/** What the client asks to have remembered. Ids, not images. */
export interface SpriteDraftInput {
  step: SpriteStep
  prompt: string
  baseJobId: string | null
  sheetJobId: string | null
}

/** What comes back, with the archived images resolved to proxy URLs. */
export interface SpriteDraftView extends SpriteDraftInput {
  /** Full base image for the confirm step; null if it was never archived. */
  baseImageUrl: string | null
  /** RAW (un-keyed) sheet — the client keys it exactly like a fresh one. */
  sheetImageUrl: string | null
}

export type SpriteWriteResult = { ok: true } | { ok: false; message: string }

/** Everything the profile page renders: who you are, and the character you
 * play as. `baseImageUrl` is the FULL image the walk cycle was drawn from —
 * null whenever no owned generation backs the current sheet (a built-in
 * sprite, an admin-assigned sheet, or a sheet stored before users.
 * sprite_generation_id existed), in which case the walk cycle is all there
 * is to show. */
export interface MyCharacterProfile {
  /** Mirrored Clerk name, else the username; null if neither is set. */
  name: string | null
  spriteId: number | null
  spriteSheet: string | null
  baseImageUrl: string | null
}

// Client-side input caps, mirrored by the server-side validators.
export const PROMPT_MAX = 300
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024

// ---------------------------------------------------------------------------
// Pure pixel utilities
// ---------------------------------------------------------------------------

/**
 * Keys out the sheet's background in place, whatever flat color the model
 * chose — the workflows ask for chroma green, but runs have come back on
 * white. A plain color match would punch holes in the character (faces and
 * highlights are white too), so this flood-fills from the sheet's EDGES:
 * the dominant border color is the background, and only pixels connected to
 * the border within `tolerance` (RGB distance) are cleared. Interior pixels
 * of the same color survive because no background path reaches them.
 *
 * A second pass then removes the HALO the first one leaves. The model's art is
 * anti-aliased, so the pixels straddling the silhouette are blends of
 * background and character; they land just outside `tolerance` (measured: a
 * spike of them at 60-90 when tolerance is 60) and survive as a pale fringe
 * around every sprite. `fringeTolerance` is deliberately much wider, and safe
 * to make wide because it only ever touches pixels ALREADY adjacent to
 * cleared background, and only when the pixel is closer to the background than
 * the body it hangs off — so a genuinely white-clothed character keeps its
 * edge instead of being eroded.
 *
 * ONE pass, deliberately. The halo is a single pixel thick on essentially all
 * of the stock art: measured over the 101 shipped sheets, this pass takes the
 * pale-edge share from ~7% of edge pixels down to a mean of 0.3%, and a second
 * pass would find only ~590 more pixels repo-wide, most of them on one sheet.
 * Each extra pass eats another ring off every silhouette, so the marginal
 * cleanup is not worth the erosion.
 */
export function keyOutBackground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 60,
  fringeTolerance = 150,
): void {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return

  // Dominant border color: mode over 32-step-quantized border pixels, then the
  // average of the pixels in the winning bucket.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  const tally = (x: number, y: number) => {
    const i = (y * width + x) * 4
    const r = rgba[i] ?? 0
    const g = rgba[i + 1] ?? 0
    const b = rgba[i + 2] ?? 0
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const entry = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    entry.n++
    entry.r += r
    entry.g += g
    entry.b += b
    buckets.set(key, entry)
  }
  for (let x = 0; x < width; x++) {
    tally(x, 0)
    tally(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    tally(0, y)
    tally(width - 1, y)
  }
  let mode: { n: number; r: number; g: number; b: number } | null = null
  for (const entry of buckets.values()) {
    if (!mode || entry.n > mode.n) mode = entry
  }
  if (!mode) return
  const bgR = mode.r / mode.n
  const bgG = mode.g / mode.n
  const bgB = mode.b / mode.n

  const tol2 = tolerance * tolerance
  const isBg = (i: number) => {
    const dr = (rgba[i] ?? 0) - bgR
    const dg = (rgba[i + 1] ?? 0) - bgG
    const db = (rgba[i + 2] ?? 0) - bgB
    return dr * dr + dg * dg + db * db <= tol2
  }

  const visited = new Uint8Array(width * height)
  const queue: number[] = []
  const push = (x: number, y: number) => {
    const p = y * width + x
    if (visited[p]) return
    visited[p] = 1
    if (isBg(p * 4)) {
      rgba[p * 4 + 3] = 0
      queue.push(p)
    }
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }
  while (queue.length > 0) {
    const p = queue.pop()!
    const x = p % width
    const y = (p - x) / width
    if (x > 0) push(x - 1, y)
    if (x < width - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < height - 1) push(x, y + 1)
  }

  // De-fringe. Collected first and cleared afterwards so the pass cannot cascade
  // into itself: every decision is made against the silhouette as the flood
  // fill left it, not against a boundary that is moving as we walk it.
  const fringe2 = fringeTolerance * fringeTolerance
  const doomed: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (rgba[i + 3] === 0) continue

      let touchesBg = false
      let nr = 0
      let ng = 0
      let nb = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = (ny * width + nx) * 4
          if (rgba[j + 3] === 0) {
            // Only orthogonal neighbours count as "on the edge" — a diagonal
            // touch alone would nibble the corners off every silhouette.
            if (dx === 0 || dy === 0) touchesBg = true
          } else {
            nr += rgba[j] ?? 0
            ng += rgba[j + 1] ?? 0
            nb += rgba[j + 2] ?? 0
            n++
          }
        }
      }
      if (!touchesBg || n === 0) continue

      const dr = (rgba[i] ?? 0) - bgR
      const dg = (rgba[i + 1] ?? 0) - bgG
      const db = (rgba[i + 2] ?? 0) - bgB
      const pixelToBg = dr * dr + dg * dg + db * db
      if (pixelToBg > fringe2) continue

      const br = nr / n - bgR
      const bg_ = ng / n - bgG
      const bb = nb / n - bgB
      const bodyToBg = br * br + bg_ * bg_ + bb * bb
      // Closer to the background than the body behind it ⇒ a blend of the two,
      // not the character's own color.
      if (pixelToBg < bodyToBg) doomed.push(i + 3)
    }
  }
  for (const alpha of doomed) rgba[alpha] = 0
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Width/height straight from the IHDR chunk, or null if not a PNG. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return null
  }
  const be32 = (o: number) =>
    (((bytes[o] ?? 0) << 24) |
      ((bytes[o + 1] ?? 0) << 16) |
      ((bytes[o + 2] ?? 0) << 8) |
      (bytes[o + 3] ?? 0)) >>>
    0
  return { width: be32(16), height: be32(20) }
}

export interface ParsedDataUrl {
  mime: string
  bytes: Uint8Array
}

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/

/** Decodes an image data URL; null on anything that is not base64 png/jpeg/webp. */
export function parseImageDataUrl(dataUrl: string): ParsedDataUrl | null {
  const m = DATA_URL_RE.exec(dataUrl)
  const mime = m?.[1]
  const b64 = m?.[2]
  if (!mime || !b64) return null
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    return null
  }
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { mime, bytes }
}
