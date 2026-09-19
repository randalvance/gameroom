import { characterSheetUrl } from "~/components/gameRoom/assets"
import { resolveSprite } from "~/components/gameRoom/spriteIndex"
import { SpriteWalkPreview } from "~/components/sprite/SpriteWalkPreview"
import type { GameRoomMenuPerson } from "~/lib/game-room-menu"

export function GameRoomMenuSprite({ person, scale }: { person: GameRoomMenuPerson; scale: number }) {
  const sprite = resolveSprite(person.spriteId, person.spriteSheet, person.playerIdx, person.teamIdx)
  const src = sprite.kind === "custom" ? sprite.sheetDataUrl : characterSheetUrl(sprite.charIdx)
  return <SpriteWalkPreview src={src} scale={scale} rows={[0]} label={`${person.name} walking`} />
}
