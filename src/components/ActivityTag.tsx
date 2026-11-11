import { activityLabel, type CardActivity } from '@/lib/activity'
export function ActivityTag({ activity }: { activity?: CardActivity }) {
  return activity ? <span title={`${activity.provider}: ${activity.action}`} className={`absolute -top-2.5 right-2 z-10 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${activity.failed ? 'border-red-300/50 bg-[#250808] text-red-200' : 'border-amber-300/50 bg-[#251a08] text-amber-200'}`}>{activity.provider} · {activityLabel(activity)}</span> : null
}
