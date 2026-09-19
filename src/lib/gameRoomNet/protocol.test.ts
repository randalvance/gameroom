import { describe, expect, it } from "vitest"
import {
  CHAT_MAX_LEN,
  packState,
  parseChat,
  parseInteract,
  parsePlayerInput,
  sseFrame,
  unpackState,
  type NetCharState,
} from "./protocol"

describe("packState / unpackState", () => {
  it("round-trips every flag combination", () => {
    for (const moving of [false, true]) {
      for (const live of [false, true]) {
        const s: NetCharState = { idx: 12, x: 123.4, y: 456.7, dir: 3, moving, live }
        expect(unpackState(packState(s))).toEqual(s)
      }
    }
  })

  it("rounds positions to one decimal", () => {
    const packed = packState({ idx: 0, x: 1.23456, y: 7.891, dir: 0, moving: false, live: false })
    expect(packed[1]).toBe(1.2)
    expect(packed[2]).toBe(7.9)
  })
})

describe("parsePlayerInput", () => {
  it("accepts a well-formed body", () => {
    expect(parsePlayerInput({ x: 10, y: 20, dir: 2, moving: true })).toEqual({
      x: 10, y: 20, dir: 2, moving: true,
    })
  })

  it.each([
    [null],
    [{}],
    [{ x: "10", y: 20, dir: 2, moving: true }],
    [{ x: 10, y: NaN, dir: 2, moving: true }],
    [{ x: 10, y: 20, dir: 4, moving: true }],
    [{ x: 10, y: 20, dir: 2, moving: "yes" }],
  ])("rejects %j", (body) => {
    expect(parsePlayerInput(body)).toBeNull()
  })
})

describe("parseInteract", () => {
  it("accepts a target idx", () => {
    expect(parseInteract({ targetIdx: 5 })).toEqual({ targetIdx: 5 })
  })

  it.each([[null], [{}], [{ targetIdx: -1 }], [{ targetIdx: 1.5 }], [{ targetIdx: "5" }]])(
    "rejects %j",
    (body) => {
      expect(parseInteract(body)).toBeNull()
    },
  )
})

describe("parseChat", () => {
  it("accepts a message and normalizes its whitespace", () => {
    expect(parseChat({ text: "  hello   team\n" })).toEqual({ text: "hello team" })
  })

  it.each([
    [null],
    [{}],
    [{ text: 42 }],
    [{ text: "" }],
    [{ text: "   " }],
    [{ text: "x".repeat(CHAT_MAX_LEN + 1) }],
  ])("rejects %j", (body) => {
    expect(parseChat(body)).toBeNull()
  })

  it("accepts a message exactly at the length cap", () => {
    expect(parseChat({ text: "x".repeat(CHAT_MAX_LEN) })).toEqual({ text: "x".repeat(CHAT_MAX_LEN) })
  })
})

describe("sseFrame", () => {
  it("emits a named event with JSON data", () => {
    expect(sseFrame("say", { idx: 1, text: "hi" })).toBe(
      'event: say\ndata: {"idx":1,"text":"hi"}\n\n',
    )
  })
})
