import { afterEach } from "vitest"

// Everything below is jsdom-only. Under the default node environment there is
// no DOM to clean up, and importing @testing-library/react would drag react-dom
// into every pure-logic test file for nothing.
if (typeof window !== "undefined") {
  const { cleanup } = await import("@testing-library/react")

  // Unmount anything rendered by @testing-library/react after each test so DOM
  // state (and duplicate elements) don't leak into the next test.
  afterEach(() => {
    cleanup()
  })

  // jsdom implements no media queries, so any component reaching for
  // useIsMobile throws before it renders. Answer as a desktop viewport — the
  // same snapshot the hook returns on the server, so tests see the layout that
  // server-rendered HTML starts in. A test that needs the mobile layout can
  // stub window.matchMedia itself.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
  }

  // jsdom has no canvas either: without the `canvas` package, getContext()
  // returns null AND reports "Not implemented" through the virtual console,
  // which vitest prints with a stack trace. Components that draw (e.g. the
  // 132 SpriteWalkPreview tiles in CharacterPicker) already bail on a null
  // context, so answer null quietly. A test that needs a drawing context
  // spies on its own canvas instance, which takes precedence over this.
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof HTMLCanvasElement.prototype.getContext
}
