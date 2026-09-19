import { afterEach, expect, it, vi } from "vitest"
import { STAGE } from "./stage-atlas.generated"

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it("loads a new stage's own art after the game room and reuses images by URL", async () => {
  const requests: string[] = []
  vi.stubGlobal("Image", class {
    onload = () => {}
    set src(url: string) { requests.push(url); queueMicrotask(() => this.onload()) }
  })
  const { loadStageImages } = await import("./sprite-loader")
  const room = await loadStageImages()
  const newsroom = { ...STAGE, layers: { far: { ...STAGE.layers.far, url: "/assets/arcade/stage-newsroom-v1.jpg", factor: 0 } } }
  const news = await loadStageImages(newsroom)
  expect(requests).toContain("/assets/arcade/stage-newsroom-v1.jpg")
  expect(news.far).not.toBe(room.far)
  expect(news.tables).toBeUndefined()
  expect(news.floor).toBeUndefined()
  expect((await loadStageImages(newsroom)).far).toBe(news.far)
  expect((await loadStageImages()).far).toBe(room.far)
  expect(requests).toHaveLength(4)
})

it("leaves failed stage art absent so the renderer can use its fallback", async () => {
  vi.stubGlobal("Image", class {
    onerror = () => {}
    set src(_url: string) { queueMicrotask(() => this.onerror()) }
  })
  const { loadStageImages } = await import("./sprite-loader")
  expect(await loadStageImages()).toEqual({})
})
