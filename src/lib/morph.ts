import { useCallback, useEffect, useRef, useState } from 'react'
import { usePreferences } from './preferences'
import { animate } from 'animejs'
import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react'

/**
 * Live layouts: when the graph changes (Claude added a table, a file, a module…),
 * existing nodes glide to their new positions and new nodes pop in, instead of the whole diagram jumping.
 * `resetKey` marks a deliberate view switch (e.g. drilling into a system): those jump without animation.
 *
 * Also returns `applyChanges` for dragging: it moves only the dragged node (other node objects keep their
 * identity, so React Flow re-renders nothing else) and records the new position so the next layout
 * pass doesn't animate it back.
 */
export function useMorph<N extends Node>(target: N[], resetKey: string): [N[], (changes: NodeChange<N>[]) => void] {
  const { settings } = usePreferences()
  const reduceMotion = settings?.reduceMotion ?? false
  const [cur, setCur] = useState<N[]>(target)
  const shown = useRef(new Map<string, { x: number; y: number }>())
  const lastKey = useRef(resetKey)
  const anim = useRef<{ pause: () => void } | null>(null)
  const held = useRef(new Set<string>()) // nodes the user is dragging right now
  // React Flow hides a node until it knows its size; carry the measured size onto every new node object
  const measured = useRef(new Map<string, { width: number; height: number }>())
  const withSize = (ns: N[]) => (measured.current.size ? ns.map((n) => (measured.current.has(n.id) && !n.measured ? { ...n, measured: measured.current.get(n.id) } : n)) : ns)

  useEffect(() => {
    anim.current?.pause()
    const prev = shown.current
    // a refresh that lands mid-drag must not pull the card back toward its old spot
    if (held.current.size) target = target.map((n) => (held.current.has(n.id) && prev.has(n.id) ? { ...n, position: prev.get(n.id)!, dragging: true } : n))
    const jump = lastKey.current !== resetKey || prev.size === 0 || document.hidden || reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches
    lastKey.current = resetKey
    const fresh = jump ? new Set<string>() : new Set(target.filter((n) => !prev.has(n.id)).map((n) => n.id))
    const tag = (ns: N[]) => (fresh.size ? ns.map((n) => (fresh.has(n.id) ? { ...n, className: `${n.className ?? ''} node-enter` } : n)) : ns)
    const from = target.map((n) => prev.get(n.id) ?? n.position)
    const moving = !jump && target.some((n, i) => Math.abs(from[i].x - n.position.x) > 1 || Math.abs(from[i].y - n.position.y) > 1)

    const commit = (ns: N[]) => {
      shown.current = new Map(ns.map((n) => [n.id, n.position]))
      setCur(withSize(ns))
    }
    if (!moving) {
      commit(tag(target))
      return
    }
    const o = { t: 0 }
    const frame = () =>
      tag(
        target.map((n, i) => ({
          ...n,
          position: { x: from[i].x + (n.position.x - from[i].x) * o.t, y: from[i].y + (n.position.y - from[i].y) * o.t },
        })),
      )
    anim.current = animate(o, {
      t: 1,
      duration: 750,
      ease: 'inOutCubic',
      onUpdate: () => commit(frame()),
      onComplete: () => commit(tag(target)),
    })
    return () => anim.current?.pause()
  }, [target, resetKey, reduceMotion])

  const applyChanges = useCallback((changes: NodeChange<N>[]) => {
    const sizes = changes.filter((c) => c.type === 'dimensions' && c.dimensions)
    for (const c of sizes) if (c.type === 'dimensions' && c.dimensions) measured.current.set(c.id, c.dimensions)
    for (const c of changes) {
      if (c.type !== 'position') continue
      if (c.dragging) held.current.add(c.id)
      else if (c.dragging === false) held.current.delete(c.id)
    }
    const moves = changes.filter((c) => c.type === 'position' && (c.position || c.dragging === false))
    if (!moves.length && !sizes.length) return
    if (moves.length) anim.current?.pause()
    setCur((ns) => {
      const next = applyNodeChanges([...sizes, ...moves], ns)
      for (const c of moves) if (c.type === 'position' && c.position) shown.current.set(c.id, c.position)
      return next
    })
  }, [])

  return [cur, applyChanges]
}
