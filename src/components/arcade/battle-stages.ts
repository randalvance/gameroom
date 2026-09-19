import { STAGE, type StageLayer } from "./stage-atlas.generated"

export type StageLayerName = keyof typeof STAGE.layers

// All battlefields share the master canvas and foot baseline used by
// stage-parallax.ts. Artwork can omit layers, but never changes fight geometry.
export type BattleStage = Omit<typeof STAGE, "layers"> & {
  layers: Partial<Record<StageLayerName, StageLayer>>
}

export const GAME_ROOM_STAGE: BattleStage = STAGE

export const NEWSROOM_STAGE: BattleStage = {
  ...STAGE,
  layers: {
    far: {
      ...STAGE.layers.far,
      url: "/assets/arcade/stage-newsroom-v1.jpg",
      // The approved studio art includes its floor and reflections. Keep the
      // complete scene fixed instead of sliding the floor under the fighters.
      factor: 0,
    },
  },
}
