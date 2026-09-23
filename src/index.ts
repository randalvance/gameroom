// The library's front door.
//
// Three levels, so you can take as much or as little as you want:
//
//   <GameRoom>              the whole experience — room, multiplayer, menu,
//                           chat, music and the easter-egg games over it.
//   <GameRoom3D>            the scene alone, with your own UI around it.
//   <Room3DViewport>        the canvas alone, driven imperatively.
//
// Plus the pieces that stand on their own: the character picker, the
// gamemaster's control panel, the audio provider, and the portals for each
// easter-egg game if you want one without the room.
//
// Styles are NOT imported here — a library that injects CSS on import cannot
// be tree-shaken or overridden. Import "@gameroom/react/styles.css" once in
// your app, and serve public/assets/** at /assets.

// ---------------------------------------------------------------- the room
export { GameRoom, type GameRoomProps } from "./gameroom/GameRoom"
export { default as GameRoom3D, type GameRoom3DProps } from "./components/gameRoom3d/GameRoom3D"
export { Room3DViewport } from "./components/gameRoom3d/Room3DViewport"
export type { RoomSceneHandle, RoomSelfState, RoomAgentInput } from "./components/gameRoom3d/scene"
export type { RoomSelection } from "./components/gameRoom3d/selection"
export { type RoomBoard, BOARD_MAX_LINES } from "./components/gameRoom3d/wall"
export { useBulletin, type RoomBulletin, BULLETIN_DEFAULT_HOLD_MS } from "./components/gameRoom3d/useBulletin"
export { qualitySettings, resolveQualityTier, type QualityTier } from "./components/gameRoom3d/quality-tier"
export { PARTICIPANT_TABLES, HOUSE_TABLE_IDXS, AGENT_TABLE_IDXS, SEATS_PER_TABLE, CW, CH, TILE } from "./components/gameRoom/constants"
export { roomTitle, setRoomTitle } from "./components/gameRoom3d/room-branding"

// ------------------------------------------------------------- room pieces
export { GameRoomMenu, type GameRoomMenuProps } from "./components/gameRoom3d/GameRoomMenu"
export { GameRoomChatPanel } from "./components/gameRoom3d/GameRoomChatPanel"
export { GameRoomDialogBox } from "./components/gameRoom3d/GameRoomDialogBox"
export { RoomTouchControls, RotateToLandscape, useCoarsePointer, useIsPortrait } from "./components/gameRoom3d/TouchControls"
export { RoomToast } from "./components/RoomToast"
export { AgentFinder } from "./components/AgentFinder"

// ----------------------------------------------------------- multiplayer
export { useGameRoomNet, type GameRoomNet, type GameRoomNetOptions, type GameRoomVisitor, type GameRoomDialog, type GameRoomChatLine } from "./components/gameRoom3d/useGameRoomNet"
export { visitorSpawnPoint } from "./lib/gameRoomNet/spawn"
export { useSnapMic } from "./components/gameRoom3d/useSnapMic"

// ------------------------------------------------------ character + sprites
export { CharacterPicker, type CharacterPickerProps } from "./components/character/CharacterPicker"
export { SpriteWalkPreview } from "./components/sprite/SpriteWalkPreview"
export { CHAR_COUNT, characterSheetUrl } from "./components/gameRoom/assets"
export {
  characterIdForPlayer,
  resolveSprite,
  sheetFormatFor,
  spriteSheetIndex,
  walkFrameFor,
  type ResolvedSprite,
  type WalkDir,
} from "./components/gameRoom/spriteIndex"
export { CUSTOM_SPRITE_ID, SPRITE_COUNT, isSharedSpriteId, sharedSpriteUrl, type SharedSpriteView } from "./lib/sprites"
export { SPRITE_COLS, SPRITE_ROWS, WALK_FRAME_SEQUENCE, type SpriteWriteResult } from "./lib/sprite-gen"

// ----------------------------------------------------------- easter eggs
export { ArcadePortal } from "./components/arcade/ArcadePortal"
export { BackroomsPortal } from "./components/backrooms/BackroomsPortal"
export { DuelPortal } from "./components/duel/DuelPortal"
export { houseDeckForDesk, houseDeskOrdinal, houseNameForDesk } from "./components/duel/house-deck"
export type { DeckId } from "./components/duel/cards"
export { createKonamiDetector, konamiTokenForKey } from "./lib/konami"

// --------------------------------------------------------- admin controls
export { GameRoomControlPanel } from "./components/gamemasterConsole/GameRoomControlPanel"
export {
  DEFAULT_HOLD_SECONDS,
  MAX_HOLD_SECONDS,
  MIN_HOLD_SECONDS,
  parseBulletinInput,
  type BulletinInput,
} from "./lib/game-room-control"
export { ROOM_MUSIC_CHOICES, parseRoomMusicInput, roomMusicRequest, type RoomMusic } from "./lib/game-room-music"

// ------------------------------------------------------------------- audio
export { AudioProvider, SiteAudioControls, useSiteAudio, usePageMusic } from "./components/SiteAudio"
export {
  GAME_ROOM_MUSIC,
  GAME_ROOM_BACKGROUND_TRACKS,
  GAME_ROOM_SONGS,
  MENU_SOUND_URLS,
  type MusicRequest,
} from "./lib/menu-sounds"

// ------------------------------------------------------------------- data
export {
  AGENT_STATUSES,
  DEFAULT_STATUS_STYLES,
  agentBoardSummary,
  bubbleTextFor,
  countByStatus,
  effectiveStatus,
  styleFor,
  type Agent,
  type AgentStatus,
  type ResolvedStatusStyle,
  type StatusStyle,
  type StatusStyleOverrides,
} from "./lib/agents"
export { type GameRoomMenuData, type GameRoomMenuPerson } from "./lib/game-room-menu"
export { normalizeRole, KNOWN_ROLES, type Role } from "./lib/auth"

// --------------------------------------------------------------- plumbing
export { configureGameRoomApi } from "./server/client"
export { setAnalyticsActor, setAnalyticsSink, type AnalyticsRecord } from "./lib/analytics"
export { setLogSink, resetLogSink, type LogRecord } from "./lib/logger"
