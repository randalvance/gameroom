// The desks' finishes: the house desks are warm white, the rest stay wood.

import { isHouseTable } from "../gameRoom/constants"

export const WOOD_TABLE_TOP_COLOR = 0xd8c8a6
export const HOUSE_TABLE_TOP_COLOR = 0xf4f3ea
export const WOOD_TABLE_LEG_COLOR = 0x8b7f66
export const HOUSE_TABLE_LEG_COLOR = 0xdeddd6

export function tableTopColorFor(tableIdx: number): number {
  return isHouseTable(tableIdx) ? HOUSE_TABLE_TOP_COLOR : WOOD_TABLE_TOP_COLOR
}

export function tableLegColorFor(tableIdx: number): number {
  return isHouseTable(tableIdx) ? HOUSE_TABLE_LEG_COLOR : WOOD_TABLE_LEG_COLOR
}
