import { memo, type CSSProperties, type ReactNode } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, Position, type Edge, type EdgeProps } from '@xyflow/react'
import { usePreferences } from '@/lib/preferences'
import { GAP_SOURCE, GAP_TARGET, midpoint, roundedPath, type Route } from '@/lib/route'

export type NeonEdgeData = { color: string; flowing?: boolean; weight?: number; shape?: 'bezier' | 'step'; route?: Route; plan?: { s: [number, number]; t: [number, number] }; labelAt?: [number, number] }

// pull the line ends off the card border so arrowheads / crow's feet are never tucked under a card
function pullOut(x: number, y: number, pos: Position, d: number) {
  if (pos === Position.Left) return [x - d, y]
  if (pos === Position.Right) return [x + d, y]
  if (pos === Position.Top) return [x, y - d]
  return [x, y + d]
}

/**
 * An edge whose "electricity" is unambiguous: glowing pulses travel along the path from source to target.
 * Traffic in the other direction is a separate edge (with its own pulses), never a double-headed arrow.
 * Its label lives in the HTML label layer, which sits above the cards.
 *
 * When the router planned a detour around cards (`data.route`) the line follows it — as long as the cards are
 * still where the plan assumed. While a card is being dragged the plan is stale, so it falls back to a plain curve.
 */
export const NeonEdge = memo(function NeonEdge(props: EdgeProps<Edge<NeonEdgeData>>) {
  const { settings } = usePreferences()
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, markerStart, label, data } = props
  const [sx, sy] = pullOut(sourceX, sourceY, sourcePosition, markerStart ? GAP_TARGET : GAP_SOURCE)
  const [tx, ty] = pullOut(targetX, targetY, targetPosition, markerEnd ? GAP_TARGET : GAP_SOURCE)
  const args = { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition, targetPosition }
  const r = data?.route
  const planned = !!r && Math.abs(r.s[0] - sourceX) < 5 && Math.abs(r.s[1] - sourceY) < 5 && Math.abs(r.t[0] - targetX) < 5 && Math.abs(r.t[1] - targetY) < 5
  let path: string
  let lx: number
  let ly: number
  let len: number
  if (planned && r) {
    path = roundedPath(r.points)
    ;[lx, ly] = midpoint(r.points)
    len = r.points.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - r.points[i - 1][0], p[1] - r.points[i - 1][1]) : 0), 0)
  } else {
    ;[path, lx, ly] = data?.shape === 'step' ? getSmoothStepPath({ ...args, borderRadius: 12 }) : getBezierPath(args)
    len = Math.hypot(tx - sx, ty - sy)
  }
  // the label spot was chosen to avoid cards and other labels — valid only while the cards sit where the plan assumed
  const p = data?.plan
  const stillPlanned = !!p && Math.abs(p.s[0] - sourceX) < 5 && Math.abs(p.s[1] - sourceY) < 5 && Math.abs(p.t[0] - targetX) < 5 && Math.abs(p.t[1] - targetY) < 5
  if (stillPlanned && data?.labelAt) [lx, ly] = data.labelAt
  const color = data?.color ?? '#22e8ff'
  const dur = Math.max(1.1, Math.min(4, len / 260)) // constant-ish speed
  const pulses = data?.flowing && !settings?.reduceMotion ? Math.min(3, 1 + Math.floor((data.weight ?? 1) / 4)) : 0
  const faded = Number(style?.opacity ?? 1) < 0.3
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} markerStart={markerStart} style={style} />
      {pulses > 0 &&
        !faded &&
        Array.from({ length: pulses }, (_, i) => (
          <circle key={i} r={2.6} fill={color} style={{ filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 2px #fff)` }}>
            <animateMotion dur={`${dur}s`} begin={`${(-i * dur) / pulses}s`} repeatCount="indefinite" path={path} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
          </circle>
        ))}
      {label != null && label !== '' && !faded && (
        <EdgeLabel x={lx} y={ly} color={color}>
          {label}
        </EdgeLabel>
      )}
    </>
  )
})

/** thin-outlined label pill, tinted like its edge, rendered above the cards */
export function EdgeLabel({ x, y, color, children }: { x: number; y: number; color: string; children: ReactNode }) {
  const css: CSSProperties = {
    transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
    color,
    borderColor: `${color}8c`,
    boxShadow: `0 0 12px -6px ${color}`,
  }
  return (
    <EdgeLabelRenderer>
      <div style={css} className="nodrag nopan pointer-events-none absolute max-w-[260px] truncate rounded border bg-[#07070b]/95 px-1.5 py-0.5 font-mono text-[10px] font-medium whitespace-nowrap">
        {children}
      </div>
    </EdgeLabelRenderer>
  )
}

export const neonEdgeTypes = { neon: NeonEdge }

/** thin outlined label pill for plain SVG labels */
export const labelBg = (color: string) => ({ fill: '#07070b', fillOpacity: 0.94, stroke: color, strokeOpacity: 0.55, strokeWidth: 0.75 })
