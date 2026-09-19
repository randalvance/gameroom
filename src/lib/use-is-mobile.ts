import { useCallback, useSyncExternalStore } from "react"

// Mobile = anything narrower than an 11" laptop (1366px wide): phones,
// tablets, and small windows all get the compact layouts.
const QUERY = "(max-width: 1365px)"

// SSR-safe media query. The server snapshot is `false` (desktop-first) so the
// server render and first client render always agree; the matchMedia listener
// then flips the layout live when the viewport crosses the breakpoint.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", cb)
      return () => mql.removeEventListener("change", cb)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export function useIsMobile(): boolean {
  return useMediaQuery(QUERY)
}
