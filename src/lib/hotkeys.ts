import { useEffect, useRef } from 'react'

type Handler = (e: KeyboardEvent) => void

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )
}

/**
 * Single-key shortcuts (and `g` + key chords), disabled while typing and when a
 * modifier is held so browser shortcuts keep working.
 */
export function useHotkeys(map: Record<string, Handler>) {
  const ref = useRef(map)
  ref.current = map

  useEffect(() => {
    let chord = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const handlers = ref.current
      if (chord) {
        chord = false
        clearTimeout(timer)
        const h = handlers[`g ${e.key}`]
        if (h) {
          e.preventDefault()
          h(e)
        }
        return
      }
      if (
        e.key === 'g' &&
        Object.keys(handlers).some((k) => k.startsWith('g '))
      ) {
        chord = true
        timer = setTimeout(() => (chord = false), 1000)
        return
      }
      const h = handlers[e.key]
      if (h) {
        e.preventDefault()
        h(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(timer)
    }
  }, [])
}
