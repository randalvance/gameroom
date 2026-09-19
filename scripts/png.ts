// Minimal PNG decode/encode for the sprite generation script.
//
// The browser does this work in production (components/sprite/processSheet.ts
// draws to a canvas), but a build script has no canvas, and pulling a headless
// browser in just to decode a PNG costs a ~500MB image and a browser install
// step for anyone who runs it. node:zlib already has the only hard part.
//
// Deliberately narrow: 8-bit, non-interlaced, RGB, RGBA or indexed color —
// ComfyUI emits. Anything else throws rather than guessing, so a surprising
// input is a clear error instead of a corrupt sheet. The KEYING is not here:
// that stays lib/sprite-gen.ts's keyOutBackground, shared with the browser, so
// a shipped sheet and a student's get identical treatment.

import { deflateSync, inflateSync } from "node:zlib"

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface RgbaImage {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = -1
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** Paeth predictor, per the PNG spec's filter type 4. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error("not a PNG")
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const idat: Uint8Array[] = []

  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      const bitDepth = body[8]
      colorType = body[9]!
      const interlace = body[12]
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (need 8)`)
      if (interlace !== 0) throw new Error("interlaced PNGs are not supported")
      if (colorType !== 2 && colorType !== 3 && colorType !== 6) {
        throw new Error(`unsupported PNG color type ${colorType} (need 2, 3 or 6)`)
      }
    } else if (type === "PLTE") {
      palette = body
    } else if (type === "tRNS") {
      transparency = body
    } else if (type === "IDAT") {
      idat.push(body)
    } else if (type === "IEND") {
      break
    }
    offset += 12 + length // length + type + body + crc
  }
  if (width === 0 || height === 0) throw new Error("PNG has no IHDR")

  if (colorType === 3 && !palette) throw new Error("Indexed PNG has no palette")
  const channels = colorType === 3 ? 1 : colorType === 6 ? 4 : 3
  const stride = width * channels
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c)))))
  if (raw.length < height * (stride + 1)) throw new Error("PNG pixel data is truncated")

  // Un-filter in place, one scanline at a time; `prev` is the reconstructed
  // line above, which every filter but None refers back to.
  const out = new Uint8Array(height * stride)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels]! : 0
      const b = prev[x]!
      const c = x >= channels ? prev[x - channels]! : 0
      const v = line[x]!
      switch (filter) {
        case 0: cur[x] = v; break
        case 1: cur[x] = (v + a) & 0xff; break
        case 2: cur[x] = (v + b) & 0xff; break
        case 3: cur[x] = (v + ((a + b) >> 1)) & 0xff; break
        case 4: cur[x] = (v + paeth(a, b, c)) & 0xff; break
        default: throw new Error(`unknown PNG filter type ${filter}`)
      }
    }
    prev = cur
  }

  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, p = 0; i < width * height; i++) {
    if (colorType === 3) {
      const index = out[i]!
      if (index * 3 + 2 >= palette!.length) throw new Error("PNG palette index out of range")
      data[p++] = palette![index * 3]!
      data[p++] = palette![index * 3 + 1]!
      data[p++] = palette![index * 3 + 2]!
      data[p++] = transparency?.[index] ?? 255
      continue
    }
    data[p++] = out[i * channels]!
    data[p++] = out[i * channels + 1]!
    data[p++] = out[i * channels + 2]!
    data[p++] = channels === 4 ? out[i * channels + 3]! : 255
  }
  return { width, height, data }
}

/** Nearest-neighbour resize — the same "no smoothing" rule the browser path
 * sets via imageSmoothingEnabled = false. Pixel art must not be interpolated:
 * a blurred edge would survive the chroma key as a halo. */
export function resizeNearest(img: RgbaImage, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / width))
      const s = (sy * img.width + sx) * 4
      const d = (y * width + x) * 4
      data[d] = img.data[s]!
      data[d + 1] = img.data[s + 1]!
      data[d + 2] = img.data[s + 2]!
      data[d + 3] = img.data[s + 3]!
    }
  }
  return { width, height, data }
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/** Always writes 8-bit RGBA, filter type 0 on every row. Sheets are 128×128
 * with large flat transparent regions, so deflate carries the size and picking
 * per-row filters would buy little for the extra surface area. */
export function encodePng(img: RgbaImage): Uint8Array {
  const stride = img.width * 4
  const raw = new Uint8Array(img.height * (stride + 1))
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, img.width)
  view.setUint32(4, img.height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw), { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
