// Obstacle-aware edge routing for the system map.
// Rule: a line must never pass behind a card. For each edge we (1) test every pair of card sides with the same
// curve the renderer draws and keep the shortest clear one; (2) if none is clear, we plan a detour through the
// gaps between cards (orthogonal, rounded corners) with a small search over a visibility grid.

export type Side = 'l' | 'r' | 't' | 'b'
export type Box = { x: number; y: number; w: number; h: number }
export type Pt = [number, number]
export type Route = { s: Pt; t: Pt; points: Pt[] } // s/t = planned handle centres, points = full polyline incl. pulled-out ends

export const GAP_TARGET = 8 // arrowhead / crow's-foot room
export const GAP_SOURCE = 3
const MARGIN = 14 // clearance kept around other cards
const OWN_MARGIN = 6
const STUB = 14 // straight lead-out before a detour turns

const SIDES: Side[] = ['l', 'r', 't', 'b']
const DIR: Record<Side, Pt> = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] }

/** where a handle sits: sources at 38%, targets at 62% along a side (so A→B and B→A run as parallel lines) */
const HANDLE_OUT = 3 // React Flow reports a handle's centre 3px outside the card edge
/** connection slots along each card side (fractions); lines into the same side get different slots so they fan out */
export const SLOTS = [0.14, 0.28, 0.42, 0.5, 0.58, 0.72, 0.86]
export function handleXY(b: Box, side: Side, kind: 's' | 't', frac?: number): Pt {
  const f = frac ?? (kind === 's' ? 0.38 : 0.62)
  if (side === 'l') return [b.x - HANDLE_OUT, b.y + b.h * f]
  if (side === 'r') return [b.x + b.w + HANDLE_OUT, b.y + b.h * f]
  if (side === 't') return [b.x + b.w * f, b.y - HANDLE_OUT]
  return [b.x + b.w * f, b.y + b.h + HANDLE_OUT]
}
export const pulledOut = (p: Pt, side: Side, d: number): Pt => [p[0] + DIR[side][0] * d, p[1] + DIR[side][1] * d]

// same control-point maths as React Flow's getBezierPath (curvature 0.25)
const off = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d))
function ctrl(side: Side, x1: number, y1: number, x2: number, y2: number): Pt {
  if (side === 'l') return [x1 - off(x1 - x2), y1]
  if (side === 'r') return [x1 + off(x2 - x1), y1]
  if (side === 't') return [x1, y1 - off(y1 - y2)]
  return [x1, y1 + off(y2 - y1)]
}
export function bezierPoints(a: Pt, aSide: Side, b: Pt, bSide: Side, n = 32): Pt[] {
  const c1 = ctrl(aSide, a[0], a[1], b[0], b[1])
  const c2 = ctrl(bSide, b[0], b[1], a[0], a[1])
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]])
  }
  return out
}

const inflate = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m })

/** does the segment p→q cross the interior of r? (Liang–Barsky) */
function segHits(p: Pt, q: Pt, r: Box): boolean {
  let t0 = 0
  let t1 = 1
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const test = (pp: number, qq: number) => {
    if (pp === 0) return qq >= 0
    const t = qq / pp
    if (pp < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  return test(-dx, p[0] - r.x) && test(dx, r.x + r.w - p[0]) && test(-dy, p[1] - r.y) && test(dy, r.y + r.h - p[1]) && t1 - t0 > 1e-6 && t0 < 1 && t1 > 0
}
const pathHits = (pts: Pt[], r: Box, skipEnds = 0) => {
  for (let i = skipEnds; i < pts.length - 1 - skipEnds; i++) if (segHits(pts[i], pts[i + 1], r)) return true
  return false
}
const length = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)

/** the side pair a human would pick from the real gap between the two boxes */
function naturalSides(a: Box, b: Box): [Side, Side] {
  const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
  const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
  const below = b.y + b.h / 2 > a.y + a.h / 2
  const right = b.x + b.w / 2 > a.x + a.w / 2
  const vertical: [Side, Side] = below ? ['b', 't'] : ['t', 'b']
  const horizontal: [Side, Side] = right ? ['r', 'l'] : ['l', 'r']
  if (vGap > 0 && hGap <= 0) return vertical
  if (hGap > 0 && vGap <= 0) return horizontal
  if (vGap > 0 && hGap > 0) return vGap * 1.6 >= hGap ? vertical : horizontal
  return Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? horizontal : vertical
}

export type Routed = { sourceHandle: string; targetHandle: string; route?: Route; clear: boolean; points?: Pt[]; plan?: { s: Pt; t: Pt } }

/** step 1: which sides of the two cards to connect (shortest clear curve, else the natural pair) */
export function pickSides(a: Box, b: Box, others: Box[]): { ss: Side; ts: Side; clear: boolean } {
  const obstacles = others.map((o) => inflate(o, MARGIN))
  const nat = naturalSides(a, b)
  let best: { cost: number; ss: Side; ts: Side } | null = null
  for (const ss of SIDES) {
    for (const ts of SIDES) {
      const pts = bezierPoints(pulledOut(handleXY(a, ss, 's', 0.5), ss, GAP_SOURCE), ss, pulledOut(handleXY(b, ts, 't', 0.5), ts, GAP_TARGET), ts)
      if (obstacles.some((o) => pathHits(pts, o))) continue
      if (pathHits(pts, a, 3) || pathHits(pts, b, 3)) continue
      const cost = length(pts) + (ss === nat[0] && ts === nat[1] ? 0 : 70)
      if (!best || cost < best.cost) best = { cost, ss, ts }
    }
  }
  return best ? { ...best, clear: true } : { ss: nat[0], ts: nat[1], clear: false }
}

/** step 2: with the slot each end got, draw it as a curve if that is clear, otherwise plan a detour */
export function finalizeEdge(a: Box, b: Box, others: Box[], ss: Side, ts: Side, si: number, ti: number): Routed {
  const obstacles = others.map((o) => inflate(o, MARGIN))
  const s = handleXY(a, ss, 's', SLOTS[si])
  const t = handleXY(b, ts, 't', SLOTS[ti])
  const sourceHandle = `s-${ss}-${si}`
  const targetHandle = `t-${ts}-${ti}`
  const pts = bezierPoints(pulledOut(s, ss, GAP_SOURCE), ss, pulledOut(t, ts, GAP_TARGET), ts)
  if (!obstacles.some((o) => pathHits(pts, o)) && !pathHits(pts, a, 3) && !pathHits(pts, b, 3)) return { sourceHandle, targetHandle, clear: true, points: pts, plan: { s, t } }
  const route = detour(a, b, ss, ts, others, SLOTS[si], SLOTS[ti])
  return route ? { sourceHandle, targetHandle, clear: true, route, points: route.points, plan: { s, t } } : { sourceHandle, targetHandle, clear: false, points: pts, plan: { s, t } }
}

/** point at fraction f of a polyline's length */
export function pointAt(pts: Pt[], f: number): Pt {
  const total = length(pts)
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (acc + seg >= total * f) {
      const k = (total * f - acc) / (seg || 1)
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]
    }
    acc += seg
  }
  return pts[pts.length - 1]
}

/**
 * Slide each label along its own line to a spot that covers no card and no other label.
 * Among the free spots it prefers the middle and avoids sitting on other lines. A label with no free spot gets null
 * (shown on hover only): it never overlaps another one.
 */
export function placeLabels(items: { key: string; points: Pt[]; text: string }[], cards: Box[]): Map<string, Pt | null> {
  const out = new Map<string, Pt | null>()
  const taken: Box[] = cards.map((c) => inflate(c, 6))
  const hit = (r: Box, o: Box) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y
  // the pill: 10px mono (~6.05px a char) + padding and border, capped by its max-width; 2px air on every side
  const dims = (t: string) => ({ w: Math.min(260, t.length * 6.05 + 16) + 4, h: 24 })
  const lines = items.map((it) => it.points)
  const onLines = (r: Box, own: number) => {
    let n = 0
    lines.forEach((pts, i) => {
      if (i === own) return
      for (const p of pts) if (p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h) n++
    })
    return n
  }
  const fracs: number[] = []
  for (let d = 0; d <= 0.38; d += 0.02) fracs.push(...(d ? [0.5 - d, 0.5 + d] : [0.5]))
  // the most constrained first: short lines and long labels have the fewest free spots
  const order = items.map((it, i) => ({ it, i, room: length(it.points) - dims(it.text).w })).sort((x, y) => x.room - y.room)
  for (const { it, i } of order) {
    const { w, h } = dims(it.text)
    let best: { p: Pt; cost: number } | null = null
    for (const f of fracs) {
      const p = pointAt(it.points, f)
      const r = { x: p[0] - w / 2, y: p[1] - h / 2, w, h }
      if (taken.some((o) => hit(r, o))) continue
      const cost = Math.abs(f - 0.5) * 40 + onLines(r, i) * 6
      if (!best || cost < best.cost) best = { p, cost }
    }
    out.set(it.key, best?.p ?? null)
    if (best) taken.push({ x: best.p[0] - w / 2, y: best.p[1] - h / 2, w, h })
  }
  return out
}

/**
 * Choose handles (and, if needed, a detour) for an edge between boxes `a` → `b`,
 * given every other card on the canvas as `others`.
 */
export function routeEdge(a: Box, b: Box, others: Box[]): Routed {
  const obstacles = others.map((o) => inflate(o, MARGIN))
  const nat = naturalSides(a, b)
  let best: { cost: number; ss: Side; ts: Side } | null = null
  for (const ss of SIDES) {
    for (const ts of SIDES) {
      const sp = pulledOut(handleXY(a, ss, 's'), ss, GAP_SOURCE)
      const tp = pulledOut(handleXY(b, ts, 't'), ts, GAP_TARGET)
      const pts = bezierPoints(sp, ss, tp, ts)
      if (obstacles.some((o) => pathHits(pts, o))) continue
      // the curve must not cut back through the cards it connects (ignore the first/last stretch where it leaves/enters)
      if (pathHits(pts, a, 3) || pathHits(pts, b, 3)) continue
      const cost = length(pts) + (ss === nat[0] && ts === nat[1] ? 0 : 70)
      if (!best || cost < best.cost) best = { cost, ss, ts }
    }
  }
  if (best) return { sourceHandle: `s-${best.ss}`, targetHandle: `t-${best.ts}`, clear: true }

  // nothing straight is clear: plan a detour around the cards
  const [ss, ts] = nat
  const route = detour(a, b, ss, ts, others)
  return { sourceHandle: `s-${ss}`, targetHandle: `t-${ts}`, route: route ?? undefined, clear: !!route }
}

// ---------------- detour planner: Dijkstra over a visibility grid, penalising bends ----------------
function detour(a: Box, b: Box, ss: Side, ts: Side, others: Box[], fs?: number, ft?: number): Route | null {
  if (others.length > 90) return null
  const s = handleXY(a, ss, 's', fs)
  const t = handleXY(b, ts, 't', ft)
  const S0 = pulledOut(s, ss, GAP_SOURCE)
  const T0 = pulledOut(t, ts, GAP_TARGET)
  const S1 = pulledOut(S0, ss, STUB)
  const T1 = pulledOut(T0, ts, STUB)
  const obs = [...others.map((o) => inflate(o, MARGIN)), inflate(a, OWN_MARGIN), inflate(b, OWN_MARGIN)]

  const xsSet = new Set<number>([S1[0], T1[0]])
  const ysSet = new Set<number>([S1[1], T1[1]])
  for (const o of obs) {
    xsSet.add(o.x)
    xsSet.add(o.x + o.w)
    ysSet.add(o.y)
    ysSet.add(o.y + o.h)
  }
  const spread = (set: Set<number>) => {
    const v = [...set].sort((p, q) => p - q)
    const out = [...v]
    for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] > 44) out.push((v[i] + v[i - 1]) / 2) // a lane down the middle of wide gaps
    return [...new Set(out)].sort((p, q) => p - q)
  }
  const xs = spread(xsSet)
  const ys = spread(ysSet)
  const W = xs.length
  const H = ys.length
  if (W * H > 24000) return null
  const inside = (x: number, y: number) => obs.some((o) => x > o.x + 0.5 && x < o.x + o.w - 0.5 && y > o.y + 0.5 && y < o.y + o.h - 0.5)
  const blocked: boolean[] = new Array(W * H)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) blocked[j * W + i] = inside(xs[i], ys[j])
  const segFree = (p: Pt, q: Pt) => !obs.some((o) => segHits(p, q, { x: o.x + 0.5, y: o.y + 0.5, w: o.w - 1, h: o.h - 1 }))

  const si = xs.indexOf(S1[0])
  const sj = ys.indexOf(S1[1])
  const ti = xs.indexOf(T1[0])
  const tj = ys.indexOf(T1[1])
  if (si < 0 || sj < 0 || ti < 0 || tj < 0) return null

  // state = (i, j, dir) ; dir: 0 l, 1 r, 2 t, 3 b
  const dirOf: Record<Side, number> = { l: 0, r: 1, t: 2, b: 3 }
  const N = W * H * 4
  const dist = new Float64Array(N).fill(Infinity)
  const prev = new Int32Array(N).fill(-1)
  const key = (i: number, j: number, d: number) => (j * W + i) * 4 + d
  const heap: [number, number][] = []
  const push = (c: number, k: number) => {
    heap.push([c, k])
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = (): [number, number] => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  const BEND = 46
  const start = key(si, sj, dirOf[ss])
  dist[start] = 0
  push(0, start)
  const steps: [number, number, number][] = [
    [-1, 0, 0],
    [1, 0, 1],
    [0, -1, 2],
    [0, 1, 3],
  ]
  let goal = -1
  while (heap.length) {
    const [c, k] = pop()
    if (c > dist[k]) continue
    const d = k % 4
    const cell = (k - d) / 4
    const i = cell % W
    const j = (cell - i) / W
    if (i === ti && j === tj) {
      goal = k
      break
    }
    for (const [dx, dy, nd] of steps) {
      if (nd === ({ 0: 1, 1: 0, 2: 3, 3: 2 } as Record<number, number>)[d]) continue // no U-turns
      const ni = i + dx
      const nj = j + dy
      if (ni < 0 || nj < 0 || ni >= W || nj >= H || blocked[nj * W + ni]) continue
      if (!segFree([xs[i], ys[j]], [xs[ni], ys[nj]])) continue
      const nc = c + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (nd === d ? 0 : BEND)
      const nk = key(ni, nj, nd)
      if (nc < dist[nk]) {
        dist[nk] = nc
        prev[nk] = k
        push(nc, nk)
      }
    }
  }
  if (goal < 0) return null

  const grid: Pt[] = []
  for (let k = goal; k >= 0; k = prev[k]) {
    const cell = (k - (k % 4)) / 4
    const i = cell % W
    const j = (cell - i) / W
    const p: Pt = [xs[i], ys[j]]
    if (!grid.length || grid[grid.length - 1][0] !== p[0] || grid[grid.length - 1][1] !== p[1]) grid.push(p)
  }
  grid.reverse()
  // drop collinear points
  const pts: Pt[] = [S0, ...grid, T0]
  const slim: Pt[] = []
  for (const p of pts) {
    const n = slim.length
    if (n >= 2) {
      const [a1, a2] = [slim[n - 2], slim[n - 1]]
      if ((a1[0] === a2[0] && a2[0] === p[0]) || (a1[1] === a2[1] && a2[1] === p[1])) slim.pop()
    }
    slim.push(p)
  }
  return { s, t, points: slim }
}

/** polyline with softly rounded corners, as an SVG path */
export function roundedPath(pts: Pt[], r = 14): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]
    const c = pts[i]
    const n = pts[i + 1]
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1
    const l2 = Math.hypot(n[0] - c[0], n[1] - c[1]) || 1
    const rr = Math.min(r, l1 / 2, l2 / 2)
    const a: Pt = [c[0] - ((c[0] - p[0]) / l1) * rr, c[1] - ((c[1] - p[1]) / l1) * rr]
    const b: Pt = [c[0] + ((n[0] - c[0]) / l2) * rr, c[1] + ((n[1] - c[1]) / l2) * rr]
    d += ` L${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}`
  }
  const e = pts[pts.length - 1]
  return d + ` L${e[0]},${e[1]}`
}

/** point halfway along a polyline */
export function midpoint(pts: Pt[]): Pt {
  const total = length(pts)
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (acc + seg >= total / 2) {
      const f = (total / 2 - acc) / (seg || 1)
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]
    }
    acc += seg
  }
  return pts[pts.length - 1]
}
