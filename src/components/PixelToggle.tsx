// A pixel-art switch in the gamemaster console's sandbox/live idiom: a 56×28
// track with a 20px knob that slides right when on, flanked by the two state
// words, the active one lit. One click flips it. A real checkbox underneath,
// exposed as a switch, so it reads and keys like one.
type PixelToggleProps = {
  checked: boolean
  onChange: (next: boolean) => void
  /** Accessible name — what the switch controls, e.g. "Student trading". */
  label: string
  disabled?: boolean
  onText?: string
  offText?: string
  /** Knob and word colour when on / off. */
  onColor?: string
  offColor?: string
}

export function PixelToggle({
  checked,
  onChange,
  label,
  disabled,
  onText = "ENABLED",
  offText = "DISABLED",
  onColor = "var(--color-neon)",
  offColor = "var(--color-danger)",
}: PixelToggleProps) {
  const word = { fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: "0.04em" } as const
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: disabled ? 0.5 : 1 }}>
      <span style={{ ...word, color: checked ? "#5D6699" : offColor }}>{offText}</span>
      <label
        style={{
          position: "relative",
          width: 56,
          height: 28,
          display: "inline-flex",
          alignItems: "center",
          border: "2px solid var(--color-card)",
          background: checked ? "#0A1A05" : "#2A0505",
          cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: "4px 4px 0 #000",
        }}
      >
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
          style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
        />
        <span
          style={{
            width: 20,
            height: 20,
            marginLeft: checked ? 30 : 4,
            background: checked ? onColor : offColor,
            border: "2px solid #000",
            transition: "margin-left 120ms steps(2)",
          }}
        />
      </label>
      <span style={{ ...word, color: checked ? onColor : "#5D6699" }}>{onText}</span>
    </div>
  )
}
