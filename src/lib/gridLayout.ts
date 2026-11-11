// Places cards on a grid so the links between them cross as little as possible.
// Each layout is scored on straight centre-to-centre links. Crossings and links passing through another card cost
// the most, then total length, then a squarish, wide-screen shape. A seeded hill-climb swaps cells; the result is
// deterministic, so the same graph always gets the same layout.
import type { Node } from '@xyflow/react'

type Size = { w: number; h: number }

const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px))
/** do segments a→b and c→d properly cross */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  return orient(ax, ay, bx, by, cx, cy) * orient(ax, ay, bx, by, dx, dy) < 0 && orient(cx, cy, dx, dy, ax, ay) * orient(cx, cy, dx, dy, bx, by) < 0
}

/** does segment p→q cross the box of half-size hw/hh centred on (cx, cy) — Liang–Barsky clip */
function through(px: number, py: number, qx: number, qy: number, cx: number, cy: number, hw: number, hh: number): boolean {
  // quick reject: the segment's own bounding box misses the card
  if ((px < cx - hw && qx < cx - hw) || (px > cx + hw && qx > cx + hw) || (py < cy - hh && qy < cy - hh) || (py > cy + hh && qy > cy + hh)) return false
  const dx = qx - px
  const dy = qy - py
  let t0 = 0
  let t1 = 1
  // clip against the four sides in turn; any side that leaves nothing means no hit
  for (let k = 0; k < 4; k++) {
    const d = k === 0 ? -dx : k === 1 ? dx : k === 2 ? -dy : dy
    const m = k === 0 ? px - (cx - hw) : k === 1 ? cx + hw - px : k === 2 ? py - (cy - hh) : cy + hh - py
    if (d === 0) {
      if (m < 0) return false
      continue
    }
    const t = m / d
    if (d < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
  }
  return t0 < t1
}

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export function layoutMinCross<N extends Node>(
  nodes: N[],
  edges: { source: string; target: string }[],
  size: (n: N) => Size,
  opts: { gapX?: number; gapY?: number } = {},
): N[] {
  const n = nodes.length
  if (n === 0) return nodes
  const gapX = opts.gapX ?? 260
  const gapY = opts.gapY ?? 190
  const sizes = nodes.map(size)
  const cellW = Math.max(...sizes.map((s) => s.w)) + gapX
  const cellH = Math.max(...sizes.map((s) => s.h)) + gapY
  // a link counts as running behind a card when it passes within 24px of the card itself
  const halfW = Math.max(...sizes.map((s) => s.w)) / 2 + 24
  const halfH = Math.max(...sizes.map((s) => s.h)) / 2 + 24
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.5)))
  const rows = Math.max(1, Math.ceil(n / cols) + (n > 2 ? 1 : 0))
  const cells = cols * rows

  // undirected links, weighted (a two-way link draws two lines)
  const ix = new Map(nodes.map((nd, i) => [nd.id, i]))
  const wmap = new Map<string, number>()
  for (const e of edges) {
    const a = ix.get(e.source)
    const b = ix.get(e.target)
    if (a == null || b == null || a === b) continue
    const k = a < b ? `${a},${b}` : `${b},${a}`
    wmap.set(k, (wmap.get(k) ?? 0) + 1)
  }
  const links = [...wmap].map(([k, w]) => {
    const [a, b] = k.split(',').map(Number)
    return { a, b, w }
  })

  const cx = new Float64Array(n)
  const cy = new Float64Array(n)
  const put = (i: number, cell: number) => {
    cx[i] = (cell % cols) * cellW
    cy[i] = Math.floor(cell / cols) * cellH
  }
  const touching = nodes.map((_, i) => links.map((L, li) => (L.a === i || L.b === i ? li : -1)).filter((li) => li >= 0))
  const linkCost = (li: number) => {
    const L = links[li]
    const px = cx[L.a], py = cy[L.a], qx = cx[L.b], qy = cy[L.b]
    let s = (Math.hypot((qx - px) / cellW, (qy - py) / cellH) - 1) * 40 * L.w
    for (let k = 0; k < n; k++) if (k !== L.a && k !== L.b && through(px, py, qx, qy, cx[k], cy[k], halfW, halfH)) s += 1500 * L.w
    return s
  }
  const crossCost = (li: number, mi: number) => {
    const L = links[li]
    const M = links[mi]
    if (M.a === L.a || M.a === L.b || M.b === L.a || M.b === L.b) return 0
    return cross(cx[L.a], cy[L.a], cx[L.b], cy[L.b], cx[M.a], cy[M.a], cx[M.b], cy[M.b]) ? 1000 * L.w * M.w : 0
  }
  const bbox = () => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (let i = 0; i < n; i++) {
      x1 = Math.min(x1, cx[i]); x2 = Math.max(x2, cx[i]); y1 = Math.min(y1, cy[i]); y2 = Math.max(y2, cy[i])
    }
    const bw = (x2 - x1) / cellW + 1
    const bh = (y2 - y1) / cellH + 1
    return (bw * bh - n) * 12 + Math.max(0, bh - bw) * 30
  }
  /** every score term that involves the nodes in S (so a move of S changes the score by partial(after) − partial(before)) */
  const inA = new Int32Array(links.length) // stamp: inA[li] === stamp ⇔ link li touches a moved node
  let stamp = 0
  const A: number[] = []
  const partial = (S: number[]) => {
    stamp++
    A.length = 0
    for (const i of S) for (const li of touching[i]) if (inA[li] !== stamp) {
      inA[li] = stamp
      A.push(li)
    }
    let s = bbox()
    for (const li of A) {
      s += linkCost(li)
      for (let mi = 0; mi < links.length; mi++) if (inA[mi] !== stamp || mi > li) s += crossCost(li, mi)
    }
    for (let li = 0; li < links.length; li++) {
      if (inA[li] === stamp) continue
      const L = links[li]
      for (const k of S) if (through(cx[L.a], cy[L.a], cx[L.b], cy[L.b], cx[k], cy[k], halfW, halfH)) s += 1500 * L.w
    }
    return s
  }
  const full = (at: number[]) => {
    at.forEach((c, i) => put(i, c))
    let s = bbox()
    for (let li = 0; li < links.length; li++) {
      s += linkCost(li)
      for (let mi = li + 1; mi < links.length; mi++) s += crossCost(li, mi)
    }
    return s
  }

  // assignment: node i → cell at[i]; try moving each node to every cell (swapping with whoever is there)
  const climb = (start: number[]) => {
    const at = [...start]
    let best = full(at)
    const owner = new Int32Array(cells).fill(-1)
    const S1 = [0]
    const S2 = [0, 0]
    at.forEach((c, i) => (owner[c] = i))
    for (let improved = true, pass = 0; improved && pass < 12; pass++) {
      improved = false
      for (let i = 0; i < n; i++) {
        for (let cell = 0; cell < cells; cell++) {
          const prev = at[i]
          if (cell === prev) continue
          const j = owner[cell]
          S2[0] = i
          S2[1] = j
          const S = j >= 0 ? S2 : S1
          S1[0] = i
          const before = partial(S)
          put(i, cell)
          if (j >= 0) put(j, prev)
          const delta = partial(S) - before
          if (delta < -1e-6) {
            best += delta
            improved = true
            at[i] = cell
            owner[cell] = i
            owner[prev] = j
            if (j >= 0) at[j] = prev
          } else {
            put(i, prev)
            if (j >= 0) put(j, cell)
          }
        }
      }
    }
    return { at, best }
  }

  const rand = rng(n * 7919 + links.length * 104729)
  // start 1: most-connected first, filled row by row from the middle
  const degree = nodes.map((_, i) => links.reduce((s, L) => s + (L.a === i || L.b === i ? L.w : 0), 0))
  const byDeg = nodes.map((_, i) => i).sort((a, b) => degree[b] - degree[a] || a - b)
  const seed0 = new Array<number>(n)
  byDeg.forEach((nodeI, k) => (seed0[nodeI] = k))
  let best = climb(seed0)
  const tries = n <= 6 ? 12 : n <= 10 ? 8 : n <= 16 ? 6 : n <= 24 ? 2 : 0
  for (let t = 0; t < tries && best.best > 0; t++) {
    const perm = Array.from({ length: cells }, (_, i) => i)
    for (let i = cells - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[perm[i], perm[j]] = [perm[j], perm[i]]
    }
    const r = climb(perm.slice(0, n))
    if (r.best < best.best) best = r
  }

  // drop empty rows / columns, then centre each card in its cell
  const usedCols = [...new Set(best.at.map((c) => c % cols))].sort((a, b) => a - b)
  const usedRows = [...new Set(best.at.map((c) => Math.floor(c / cols)))].sort((a, b) => a - b)
  return nodes.map((nd, i) => {
    const cx = usedCols.indexOf(best.at[i] % cols) * cellW + cellW / 2
    const cy = usedRows.indexOf(Math.floor(best.at[i] / cols)) * cellH + cellH / 2
    return { ...nd, position: { x: cx - sizes[i].w / 2, y: cy - sizes[i].h / 2 } }
  })
}
