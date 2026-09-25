import { isHouseTable } from "~/components/gameRoom/constants"

/** What the interact key does at a desk: the white house desks deal you in;
 * every other desk opens the agents menu. */
export function deskInteractAction(tableIdx: number): "duel" | "menu" {
  return isHouseTable(tableIdx) ? "duel" : "menu"
}
