import { render, screen, waitFor } from "@testing-library/react"
import { fireEvent } from "@testing-library/dom"
import { describe, expect, it, vi } from "vitest"

import { CUSTOM_SPRITE_ID, SPRITE_COUNT } from "~/lib/sprites"
import { CharacterPicker } from "./CharacterPicker"

const SHEET = "data:image/png;base64,iVBORw0KGgo="

function renderPicker(props: Partial<React.ComponentProps<typeof CharacterPicker>> = {}) {
  const choose = props.choose ?? vi.fn(async () => ({ ok: true as const }))
  const onSaved = props.onSaved ?? vi.fn()
  render(
    <CharacterPicker
      spriteId={null}
      spriteSheet={null}
      choose={choose}
      onSaved={onSaved}
      {...props}
    />,
  )
  return { choose, onSaved }
}

describe("CharacterPicker", () => {
  it("offers the whole pool, and saves the one that is picked", async () => {
    const { choose, onSaved } = renderPicker()
    expect(screen.getAllByRole("radio")).toHaveLength(SPRITE_COUNT)

    fireEvent.click(screen.getByRole("radio", { name: "Character 4" }))
    fireEvent.click(screen.getByRole("button", { name: /PLAY AS THIS ONE/ }))

    await waitFor(() => expect(choose).toHaveBeenCalledWith(3))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(3, null))
  })

  // Admin-published PUBLIC library sheets join the pool for everyone; exclusive
  // ones are never passed to a picker, so there is nothing else to render.
  it("offers public library characters ahead of the pool, and saves their id", async () => {
    const shared = [
      { spriteId: 1003, label: "Wizard — teal", visibility: "public" as const, url: "/api/shared-sprites/3" },
    ]
    const { choose, onSaved } = renderPicker({ sharedSprites: shared })
    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(SPRITE_COUNT + 1)
    expect(radios[0]!.getAttribute("aria-label")).toBe("Wizard — teal")

    fireEvent.click(screen.getByRole("radio", { name: "Wizard — teal" }))
    fireEvent.click(screen.getByRole("button", { name: /PLAY AS THIS ONE/ }))

    await waitFor(() => expect(choose).toHaveBeenCalledWith(1003))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1003, null))
  })

  it("starts on the current library character", () => {
    renderPicker({
      spriteId: 1003,
      sharedSprites: [
        { spriteId: 1003, label: "Wizard — teal", visibility: "public", url: "/api/shared-sprites/3" },
      ],
    })
    expect(screen.getByRole("radio", { name: "Wizard — teal" }).getAttribute("aria-checked")).toBe("true")
  })

  it("will not save until something is picked", () => {
    const { choose } = renderPicker()
    const confirm = screen.getByRole("button", { name: /PLAY AS THIS ONE/ })
    expect(confirm.hasAttribute("disabled")).toBe(true)
    fireEvent.click(confirm)
    expect(choose).not.toHaveBeenCalled()
  })

  it("starts on the current pool character", () => {
    renderPicker({ spriteId: 5 })
    expect(screen.getByRole("radio", { name: "Character 6" }).getAttribute("aria-checked")).toBe(
      "true",
    )
  })

  // RANDOMLY PICK writes a REAL id rather than leaving sprite_id null: the
  // root gate bounces null straight back to the chooser.
  it("randomly picks from the pool", async () => {
    const { choose } = renderPicker()
    fireEvent.click(screen.getByRole("button", { name: /RANDOMLY PICK/ }))
    await waitFor(() => expect(choose).toHaveBeenCalled())
    const [id] = (choose as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(Number.isInteger(id)).toBe(true)
    expect(id).toBeGreaterThanOrEqual(0)
    expect(id).toBeLessThan(SPRITE_COUNT)
  })

  it("shows a refusal instead of reporting a save that did not happen", async () => {
    const choose = vi.fn(async () => ({ ok: false as const, message: "Link an account first" }))
    const { onSaved } = renderPicker({ choose })
    fireEvent.click(screen.getByRole("radio", { name: "Character 1" }))
    fireEvent.click(screen.getByRole("button", { name: /PLAY AS THIS ONE/ }))
    expect(await screen.findByText("Link an account first")).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })

  describe("a sheet the host supplied", () => {
    it("can be taken back after a pool character", async () => {
      const { choose, onSaved } = renderPicker({ spriteId: 2, spriteSheet: SHEET })
      fireEvent.click(screen.getByRole("button", { name: /USE THIS ONE/ }))
      await waitFor(() => expect(choose).toHaveBeenCalledWith(CUSTOM_SPRITE_ID))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(CUSTOM_SPRITE_ID, null))
    })

    it("offers no re-selection when it is already the choice", () => {
      renderPicker({ spriteId: CUSTOM_SPRITE_ID, spriteSheet: SHEET })
      expect(screen.queryByRole("button", { name: /USE THIS ONE/ })).toBeNull()
      expect(screen.getByText("The current character.")).toBeTruthy()
    })

    it("is not advertised when there is none", () => {
      renderPicker()
      expect(screen.queryByRole("button", { name: /USE THIS ONE/ })).toBeNull()
    })
  })

})
