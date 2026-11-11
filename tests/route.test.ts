// Quick geometry check for the edge router: a dense 4×3 grid like the "inside a system" view.
import { routeEdge, type Box } from '../src/lib/route.ts'

const W = 240
const H = 130
const GX = 90
const GY = 70
const cols = 4
const boxes: Box[] = Array.from({ length: 11 }, (_, i) => ({ x: (i % cols) * (W + GX), y: Math.floor(i / cols) * (H + GY), w: W, h: H }))
const pairs: [number, number][] = [[0, 6], [1, 9], [4, 2], [8, 3], [0, 10], [5, 7], [2, 8], [3, 4]]
let bad = 0
for (const [a, b] of pairs) {
  const others = boxes.filter((_, i) => i !== a && i !== b)
  const r = routeEdge(boxes[a], boxes[b], others)
  console.log(`${a}→${b}`.padEnd(6), r.sourceHandle, r.targetHandle, r.route ? `detour(${r.route.points.length} pts)` : 'curve', r.clear ? 'clear' : 'BLOCKED')
  if (!r.clear) bad++
}
console.log(bad ? `${bad} blocked` : 'all clear')
