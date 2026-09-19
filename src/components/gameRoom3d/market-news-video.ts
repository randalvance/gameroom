// Fitting a filmed news broadcast onto the room's wall screen.
//
// Kept out of scene.ts for the same reason screen-focus.ts is: this is
// arithmetic, worth testing without a WebGL context or a real <video> behind
// it.
//
// The broadcast is a VideoTexture on its own quad, NOT a material swap on the
// wall: the wall is a 4.1:1 videowall (1920x468) and the clips are 16:9, so a
// straight swap would stretch the anchor across the whole front wall. The quad
// is sized and placed from the rects below so the video keeps its shape and
// the panel either side of it stays the screen's own black.
//
// (It was once drawn INTO the screen's canvas instead, through a 2D filter,
// with the whole canvas re-uploaded to the GPU on every rendered frame. That
// was the room's lag while a clip played, and why the picture now has a quad
// of its own — see the broadcast picture in scene.ts.)

export interface FitRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where to draw the video inside the screen's canvas so it keeps its shape:
 * as large as fits, centred, with the mismatch left as empty panel. On this
 * wall that is nearly always pillarboxing — a 16:9 broadcast reaches full
 * height and takes a bit over 40% of the width.
 *
 * A video reports 0x0 until its metadata arrives, and drawImage throws on a
 * zero-sized source, so that case comes back as an empty rect for the caller
 * to skip rather than as a division by zero.
 */
export function videoFitRect(
  videoWidth: number,
  videoHeight: number,
  texWidth: number,
  texHeight: number,
): FitRect {
  if (videoWidth <= 0 || videoHeight <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  const scale = Math.min(texWidth / videoWidth, texHeight / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale
  return { x: (texWidth - width) / 2, y: (texHeight - height) / 2, width, height }
}

/** A broadcast's size and height on the wall, in world units. */
/**
 * How far inside the screen's edge a broadcast stops.
 *
 * The canvas strokes an 8px blue border a few pixels in from the edge, and it
 * is painted BEFORE the picture — so a picture running to the canvas edge
 * covers it and the screen loses the frame that makes it read as a screen.
 * This clears the stroke with a little black to spare, which also stops the
 * video's own edge pixels sitting flush against the surround.
 */
export const BROADCAST_INSET = 16

/**
 * Where a broadcast is drawn on the screen's canvas: the largest the picture
 * goes inside the border, centred, in absolute texture coordinates.
 *
 * Both the painter and the camera framing go through this, so what is drawn
 * and what is framed can never disagree.
 */
export function broadcastFitRect(
  videoWidth: number,
  videoHeight: number,
  texWidth: number,
  texHeight: number,
): FitRect {
  const fit = videoFitRect(
    videoWidth,
    videoHeight,
    texWidth - BROADCAST_INSET * 2,
    texHeight - BROADCAST_INSET * 2,
  )
  if (fit.width <= 0) return fit
  return { ...fit, x: fit.x + BROADCAST_INSET, y: fit.y + BROADCAST_INSET }
}

export interface BroadcastWorldRect {
  width: number
  height: number
  /** Height of the picture's middle above the floor. */
  centreY: number
}

/**
 * Where the picture actually sits on the wall, so the camera can frame IT
 * rather than the whole screen.
 *
 * The wall is 4.1:1 and a viewport is around 16:9, so a pose that fits the
 * whole screen runs out of width long before height and spends most of the
 * player's view on floor and ceiling. Framing the picture's own rect instead
 * puts the camera as close as the broadcast allows.
 *
 * Texture y counts down from the screen's top edge and world y counts up from
 * the floor, which is the one thing here worth getting right.
 */
export function broadcastWorldRect(
  fit: FitRect,
  texWidth: number,
  texHeight: number,
  planeWidth: number,
  planeHeight: number,
  planeCentreY: number,
): BroadcastWorldRect {
  const perTexX = planeWidth / texWidth
  const perTexY = planeHeight / texHeight
  const topY = planeCentreY + planeHeight / 2
  return {
    width: fit.width * perTexX,
    height: fit.height * perTexY,
    centreY: topY - (fit.y + fit.height / 2) * perTexY,
  }
}
