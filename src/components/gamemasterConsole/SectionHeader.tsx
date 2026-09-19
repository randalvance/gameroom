export function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontFamily: "var(--font-display)", fontSize: 13, color: "var(--color-coin)",
      marginBottom: 14, borderBottom: "2px solid var(--color-card)",
      paddingBottom: 8, letterSpacing: "0.04em",
    }}>
      ▸ {title}
    </div>
  )
}
