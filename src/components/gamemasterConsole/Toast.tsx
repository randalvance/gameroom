export function Toast({ toast }: { toast: { msg: string; color: string } }) {
  return (
    <div style={{
      position: "fixed", top: 60, right: 20, zIndex: 999,
      background: "#000", border: `2px solid ${toast.color}`, padding: "10px 16px",
      fontFamily: "var(--font-display)", fontSize: 10, color: toast.color,
      boxShadow: `4px 4px 0 ${toast.color}40`,
    }}>
      {toast.msg}
    </div>
  )
}
