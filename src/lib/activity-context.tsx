import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ActivityEvent } from './types'
import { cardActivities, type CardActivity } from './activity'
const Context = createContext(new Map<string, CardActivity>())
export const useActivities = () => useContext(Context)
export function ActivityProvider({ events, children }: { events: ActivityEvent[]; children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer) }, [])
  const activities = useMemo(() => cardActivities(events, now), [events, now])
  return <Context.Provider value={activities}>{children}</Context.Provider>
}
