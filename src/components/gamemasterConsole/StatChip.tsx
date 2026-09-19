export function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ fontFamily: "var(--font-display)", fontSize: 9, color, letterSpacing: "0.06em" }}>
      {label}: <span style={{ color: "#FFF" }}>{value}</span>
    </span>
  )
}
