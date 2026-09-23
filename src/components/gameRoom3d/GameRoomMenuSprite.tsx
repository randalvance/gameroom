import { characterSheetUrl, CHAR_COUNT } from "~/components/gameRoom/assets"
import { resolveSprite } from "~/components/gameRoom/spriteIndex"
import { SpriteWalkPreview } from "~/components/sprite/SpriteWalkPreview"
import { hashAgentId, type Agent } from "~/lib/agents"
import type { GameRoomMenuPerson } from "~/lib/game-room-menu"

export function GameRoomMenuSprite({ person, scale }: { person: GameRoomMenuPerson; scale: number }) {
  const sprite = resolveSprite(person.spriteId, person.spriteSheet, person.playerIdx, person.teamIdx)
  const src = sprite.kind === "custom" ? sprite.sheetDataUrl : characterSheetUrl(sprite.charIdx)
  return <SpriteWalkPreview src={src} scale={scale} rows={[0]} label={`${person.name} walking`} />
}

/** The sheet an agent renders from: the same rule the room uses. */
export function agentSheetUrl(agent: Pick<Agent, "id" | "sprite">): string {
  if (typeof agent.sprite === "string") return agent.sprite
  const idx = typeof agent.sprite === "number" && Number.isInteger(agent.sprite) ? agent.sprite : hashAgentId(agent.id)
  return characterSheetUrl(((idx % CHAR_COUNT) + CHAR_COUNT) % CHAR_COUNT)
}

export function GameRoomMenuAgentSprite({ agent, scale }: { agent: Agent; scale: number }) {
  return <SpriteWalkPreview src={agentSheetUrl(agent)} scale={scale} rows={[0]} label={`${agent.name} walking`} />
}
