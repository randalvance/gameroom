import type { ReactNode } from "react"

/** The room's one-line notice, pinned above the touch controls: an arcade
 * cabinet appearing, a house challenging you to a duel. Purely informative,
 * so it never takes the pointer. */
export function RoomToast({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 96,
        transform: "translateX(-50%)",
        zIndex: 13,
        padding: "8px 12px",
        background: "#111A4D",
        border: "2px solid #FFD166",
        boxShadow: "4px 4px 0 #000",
        color: "#FFD166",
        fontFamily: "var(--font-display)",
        fontSize: 9,
        letterSpacing: "0.08em",
        maxWidth: "calc(100% - 32px)",
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      {children}
    </div>
  )
}
