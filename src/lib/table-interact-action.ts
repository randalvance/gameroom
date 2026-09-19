/** What the interact key does at a desk: the white (exhibition) desks deal
 * you in; every other desk opens that team's menu, as before. */
export function tableInteractAction(teams: ReadonlyArray<{ competing?: boolean }>, tableIdx: number): "duel" | "menu" {
  return teams[tableIdx]?.competing === false ? "duel" : "menu"
}
