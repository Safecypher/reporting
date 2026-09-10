import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Must match the server's render exactly: the server has no `window`, so it
  // always renders the desktop branch. Deriving the initial value from
  // `window.innerWidth` here (even behind a `typeof window !== "undefined"`
  // guard) makes the first CLIENT render diverge from the server-rendered
  // HTML whenever the client's viewport is below MOBILE_BREAKPOINT, which
  // React reports as a hydration mismatch. Start `false` unconditionally and
  // correct to the real value in an effect, which only runs post-hydration.
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
