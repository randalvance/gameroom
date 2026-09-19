import { describe, expect, it } from "vitest"
import { BOT_LABEL, buildAccountLabels } from "./account-labels"

describe("buildAccountLabels", () => {
  it("shows a competing team by its name", () => {
    const labels = buildAccountLabels([{ teamId: "team-1", teamName: "TEAM DELTA" }], [])
    expect(labels.get("team-1")).toBe("TEAM DELTA")
  })

  // The market maker quotes around the hidden fair value, so naming it on the
  // tape points straight at the anchor. Trend followers and random traders are
  // masked too: MM / TF / RT would still tell a student which prints are the
  // anchor and which are noise.
  it("masks every house bot to one label, whatever it does", () => {
    const labels = buildAccountLabels(
      [
        { teamId: "bot-mm-nova", teamName: "MM-NOVA" },
        { teamId: "bot-tf-03", teamName: "TF-03" },
        { teamId: "bot-rt-01", teamName: "RT-01" },
      ],
      [{ teamId: "bot-mm-nova" }, { teamId: "bot-tf-03" }, { teamId: "bot-rt-01" }],
    )

    expect([...labels.values()]).toEqual([BOT_LABEL, BOT_LABEL, BOT_LABEL])
  })

  // A bot IS an exchange account, so it has a row in both tables. The bots
  // pass has to run second or the account row would reinstate the real name.
  it("masks a bot even when its account row carries the revealing name", () => {
    const labels = buildAccountLabels(
      [{ teamId: "bot-mm-nova", teamName: "MM-NOVA" }],
      [{ teamId: "bot-mm-nova" }],
    )
    expect(labels.get("bot-mm-nova")).toBe(BOT_LABEL)
  })

  it("leaves an unknown id unlabelled, for the caller to shorten", () => {
    const labels = buildAccountLabels([], [])
    expect(labels.get("team-unknown")).toBeUndefined()
  })

  it("skips an account with no name rather than labelling it empty", () => {
    const labels = buildAccountLabels([{ teamId: "team-2", teamName: null }], [])
    expect(labels.has("team-2")).toBe(false)
  })
})
