// The approved roster redesign and added special/down poses supersede the
// original sheets, which remain available as inputs for the packing script.
import { MOTION_ATLASES } from "./motion-atlases.generated"
import { POLAR_BEAR } from "./polar-bear.generated"
import { BERNARD_POWERED } from "./bernard-powered.generated"
import type { SpriteAtlas } from "./sprite-atlas.generated"

const bear = POLAR_BEAR
// Retain the curated idle cadence from the previous Bear sheet, including
// its resting/block pose, across the polar-bear appearance update.
export const FIGHTER_ATLASES: Record<string, SpriteAtlas> = {
  ...MOTION_ATLASES,
  bernard: BERNARD_POWERED,
  bear: { ...bear, poses: { ...bear.poses, idle: [bear.poses.idle[1]!, bear.poses.idle[2]!, bear.poses.idle[3]!, bear.poses.idle[2]!] } },
}
export { PORTRAIT_ORDER } from "./sprite-atlas.generated"
export type { SpriteAtlas, SpriteFrame, SpritePose } from "./sprite-atlas.generated"
