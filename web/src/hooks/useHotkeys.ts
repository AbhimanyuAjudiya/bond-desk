import { useEffect, useRef } from "react"

export type Hotkeys = Record<string, (e: KeyboardEvent) => void>

/** True while the key press belongs to a field, so single-letter shortcuts never fire mid-typing. */
export const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
}

/** Plain-key shortcuts (no modifier) for the page; the map may change every render. */
export function useHotkeys(map: Hotkeys) {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const fn = ref.current[e.key]
      if (!fn) return
      e.preventDefault()
      fn(e)
    }
    document.addEventListener("keydown", on)
    return () => document.removeEventListener("keydown", on)
  }, [])
}
