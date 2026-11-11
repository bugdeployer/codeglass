import type { Node, XYPosition } from '@xyflow/react'

export type SchemaPin = XYPosition & { parentId?: string }
export type SchemaPins = Record<string, SchemaPin>
export const schemaLayoutKey = (root: string, collapse: boolean) => `cc-viz:schema-layout:v1:${root}:${collapse ? 'collapsed' : 'expanded'}`
export function readSchemaPins(key: string): SchemaPins {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries((Object.entries(raw) as [string, SchemaPin][]).filter(([, p]) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.parentId === undefined || typeof p.parentId === 'string')))
  } catch { return {} }
}
export function saveSchemaPins(key: string, pins: SchemaPins) {
  try { localStorage.setItem(key, JSON.stringify(pins)) } catch {}
}
export function applySchemaPins(nodes: Node[], pins: SchemaPins): Node[] {
  return nodes.map((node) => {
    const pin = pins[node.id]
    if (!pin || pin.parentId !== node.parentId) return node
    let { x, y } = pin
    if (node.parentId && Array.isArray(node.extent)) {
      const [[left, top], [right, bottom]] = node.extent
      const width = node.width ?? node.measured?.width ?? node.initialWidth ?? 240
      const height = node.height ?? node.measured?.height ?? node.initialHeight ?? 100
      x = Math.max(left, Math.min(x, right - width))
      y = Math.max(top, Math.min(y, bottom - height))
    }
    return { ...node, position: { x, y } }
  })
}
export function schemaAbsoluteX(node: Node, nodes: Node[]) {
  return node.position.x + (node.parentId ? nodes.find((parent) => parent.id === node.parentId)?.position.x ?? 0 : 0)
}
