// Client-safe DTOs for the Go exchange-platform data (read from the shared
// Neon DB; writes proxied to the exchange HTTP API).
//
// CONVENTION: every monetary value in these DTOs is in DOLLARS (JS number).
// The DB/API side is bigint cents — ~/server/exchange.ts converts at the
// boundary so UI code never sees cents.

export interface ExInstrument {
  symbol: string // "NOVA"
  name: string
  sector: string
  startingPrice: number // dollars
  lastPrice: number // dollars
}

// One RESTING ORDER, not a price level — the book shows who is quoting,
// mirroring the exchange's own /orderbook/:symbol view (#430). Orders at the
// same price appear in queue (time) priority. House bots all carry the single
// label "BOT", so a market maker cannot be told apart from the other bots.
export interface ExBookOrder {
  team: string // display label — team name, or "BOT" for every house bot
  price: number // dollars
  quantity: number
}

export interface ExOrderbook {
  symbol: string
  bids: ExBookOrder[] // best (highest) price first, queue order within a price
  asks: ExBookOrder[] // best (lowest) price first, queue order within a price
}

export interface ExTrade {
  id: string
  symbol: string
  price: number // dollars
  quantity: number
  buyer: string // display label: team code, bot name, or short id
  seller: string
  ts: number // epoch ms
}

export type ExOrderStatus =
  | "PENDING"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED"

export interface ExOpenOrder {
  id: string
  symbol: string
  side: "buy" | "sell"
  price: number // dollars
  quantity: number
  remaining: number
  status: ExOrderStatus
  ts: number // epoch ms (created_at)
}

export interface ExPosition {
  symbol: string
  quantity: number
  avgCost: number // dollars
  lastPrice: number // dollars
  marketValue: number // dollars
  unrealizedPnL: number // dollars
}

export interface ExPortfolio {
  registered: true
  teamId: string
  cash: number // dollars — TOTAL cash; reservedCash is a portion of it (available = cash - reservedCash)
  reservedCash: number
  realizedPnL: number
  positions: ExPosition[]
  openOrders: ExOpenOrder[]
  totalMarketValue: number // Σ position market values
  totalValue: number // cash + market value (NOT + reserved — that would double count)
  totalPnL: number // realized + unrealized
}

export type ExPortfolioResult = ExPortfolio | { registered: false; teamId: string }

export interface ExLeaderboardRow {
  label: string // team code, or account team_name / short id if unlinked
  teamId: string
  totalValue: number // dollars
  totalPnL: number // dollars: realized + unrealized
}

export interface ExPlaceOrderResult {
  ok: boolean
  orderId?: string
  status?: ExOrderStatus
  tradeCount?: number
  error?: string
  // Why it failed, and it matters: "rejected" is the exchange's own decision
  // about this order, so `error` is its reason and safe to show. "unavailable"
  // means no decision was ever reached — the exchange or the database could not
  // be reached — and `error` is a generic sentence, with the real cause in the
  // server log. Callers must not report the second as a rejection: doing so
  // turned an exchange restart into "your order was rejected" for every team,
  // with no 5xx anywhere to fire an alert.
  failure?: TradeFailureKind
}

export type TradeFailureKind = "rejected" | "unavailable"

export interface ExCancelOrderResult {
  ok: boolean
  error?: string
  failure?: TradeFailureKind
}
