import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { fmt } from '@/lib/graph'

export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(0)
  useEffect(() => {
    const o = { v: prev.current }
    const a = animate(o, {
      v: value,
      duration: 900,
      ease: 'outExpo',
      onUpdate: () => {
        if (ref.current) ref.current.textContent = fmt(Math.round(o.v))
      },
    })
    prev.current = value
    return () => {
      a.pause()
      if (ref.current) ref.current.textContent = fmt(value)
    }
  }, [value])
  return <span ref={ref}>{fmt(value)}</span>
}
