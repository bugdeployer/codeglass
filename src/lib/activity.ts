import type { ActivityEvent } from './types'
import type { ActivityAction } from '../../shared/contracts'
export type CardActivity = { action: ActivityAction; provider: 'claude' | 'codex'; active: boolean; ts: number; failed?: boolean }
export function mergeActivityEvents(current: ActivityEvent[], incoming: ActivityEvent[]) {
  return [...new Map([...current, ...incoming].map(e => [`${e.id}:${e.ts}`, e])).values()]
    .sort((a, b) => a.ts - b.ts || a.id - b.id).slice(-300)
}
export function cardActivities(events: ActivityEvent[], now = Date.now()) {
  const calls = new Map<string, { event: ActivityEvent; active: boolean }>()
  for (const event of events) {
    if (event.source === 'fs') continue
    if (event.kind === 'stop') {
      for (const [key, call] of calls) if (call.active && call.event.sessionId === event.sessionId && call.event.source === event.source) calls.delete(key)
      continue
    }
    if (!event.path || !event.action) continue
    const key = `${event.source}:${event.sessionId ?? ''}:${event.callId ?? event.path}:${event.path}`
    calls.set(key, { event, active: event.phase === 'pre' })
  }
  const result = new Map<string, CardActivity>()
  for (const { event, active } of calls.values()) {
    if (now - event.ts > (active ? 120_000 : 12_000)) continue
    const prev = result.get(event.path!)
    if (!prev || (active && !prev.active) || (active === prev.active && event.ts > prev.ts)) result.set(event.path!, { action: event.action!, provider: event.source as 'claude' | 'codex', active, ts: event.ts, failed: event.failed })
  }
  return result
}
export function activityLabel(activity: CardActivity) {
  const past: Record<ActivityAction, string> = { building: 'Built', editing: 'Edited', refactoring: 'Refactored', reading: 'Read', testing: 'Tested', deleting: 'Deleted', working: 'Worked' }
  if (activity.failed) return `${activity.action} failed`
  return activity.active ? activity.action : past[activity.action]
}
