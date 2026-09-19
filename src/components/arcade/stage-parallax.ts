// Where the stage's layers sit on the canvas, and how far they slide.
//
// The stage art is a 1672×941 master canvas — exactly 16:9, so at the game's
// 960×540 view it maps 1:1 onto the frame at a scale of 540/941. The floor is
// the play plane and stays put; the layers behind it slide the opposite way
// to the fighters' midpoint, each by its own factor, which is what sells the
// depth. The far wall is drawn a touch larger than the frame so its edges
// never show at the end of a slide. Pure, so a test can pin the geometry.

import { STAGE, type StageLayer } from "./stage-atlas.generated"

/** Extra scale on the far layer: overscan to cover its slide. */
export const FAR_OVERSCAN = 1.08

export interface LayerPlacement {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Master pixels → view pixels. The master is a hair narrower than 16:9, so
 * it is fitted by WIDTH: the frame's edges stay covered and the sliver that
 * falls off the bottom is a fraction of a pixel.
 */
export function stageScale(viewH: number, viewW: number = (viewH * 16) / 9): number {
  return Math.max(viewW / STAGE.width, viewH / STAGE.height)
}

/** The camera's offset from the stage centre: where the fighters are. */
export function stageCameraOffset(fighterXs: readonly [number, number], stageWidth: number): number {
  return (fighterXs[0] + fighterXs[1]) / 2 - stageWidth / 2
}

/** The floor line the fighters stand on, in view pixels. */
export function stageFloorY(viewH: number, viewW?: number): number {
  return STAGE.footBaseline * stageScale(viewH, viewW)
}

/**
 * Where to draw a layer for this camera offset. Layers slide opposite to the
 * camera by their factor; the far layer is enlarged around the bottom-centre
 * of the frame so its slide never exposes an edge.
 */
export function placeLayer(
  layer: StageLayer,
  cameraOffset: number,
  view: { w: number; h: number },
  overscan = layer.factor > 0 && layer.x === 0 ? FAR_OVERSCAN : 1,
): LayerPlacement {
  const s = stageScale(view.h, view.w) * overscan
  const shift = -layer.factor * cameraOffset
  const w = layer.w * s
  const h = layer.h * s
  // Enlarged layers keep their bottom-centre pinned; everything else keeps
  // its master position.
  const x = overscan === 1 ? layer.x * s + shift : view.w / 2 - w / 2 + shift
  const y = overscan === 1 ? layer.y * s : view.h - h
  return { x, y, w, h }
}
