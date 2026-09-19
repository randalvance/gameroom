// Display labels for trade counterparties.
//
// House bots are deliberately anonymised. Their names say what they DO —
// MM-NOVA is the market maker, TF-03 a trend follower, RT-01 a random trader —
// and the market maker quotes around the HIDDEN fair value. Printing its name
// on the tape tells a student which fills are the anchor, which is the answer
// the whole challenge asks them to estimate. The exchange already strips
// counterparties from the public SSE feed for this reason (#177); the web
// tape reads the database directly and so needs its own mask.
//
// One label for every bot, not one per type: MM / TF / RT would still separate
// the anchor from the noise, which is most of the leak.
export const BOT_LABEL = "BOT"

export function buildAccountLabels(
  accounts: readonly { teamId: string; teamName: string | null }[],
  bots: readonly { teamId: string }[],
): Map<string, string> {
  const labels = new Map<string, string>()
  for (const a of accounts) if (a.teamName) labels.set(a.teamId, a.teamName)
  // After the accounts pass, so a bot's own account row cannot leak its name.
  for (const b of bots) labels.set(b.teamId, BOT_LABEL)
  return labels
}
