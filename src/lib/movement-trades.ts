// The Movement feed's rule: show every trade a STUDENT took part in, drop the
// bots trading among themselves. A trade is kept unless BOTH sides are bots —
// so student↔bot and student↔student stay, bot↔bot goes.
export function keepMovementTrade(buyerIsBot: boolean, sellerIsBot: boolean): boolean {
  return !(buyerIsBot && sellerIsBot)
}
