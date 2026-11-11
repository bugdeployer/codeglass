import { useActivities } from '@/lib/activity-context'
import { ActivityTag } from './ActivityTag'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { animate, stagger } from 'animejs'
import { ArrowRight, CheckCircle2, CircleDashed, CornerDownRight, Database, Diamond, FileCode2, Play, Repeat2, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KIND_ICON, kindColor } from '@/components/MapNodes'
import { EFFECT_COLOR } from '@/lib/colors'
import type { ArchFlow, ArchSystem, FlowStep } from '@/lib/types'
import { cn } from '@/lib/utils'

const EFFECT_TEXT: Record<FlowStep['effect'], string> = {
  ui: 'UI',
  request: 'Request',
  logic: 'Logic',
  read: 'Read',
  write: 'Write',
  external: 'External',
  event: 'Event',
  response: 'Response',
}
const CARD_W = 190
const ARROW_W = 40
const COND_ARROW_W = 128 // arrows that carry a condition get room for it
const COND = '#ffb020'

/** a decision's outcomes: the main path first, then each alternative */
function outcomes(main: FlowStep[], i: number): string[] {
  const s = main[i]
  return [main[i + 1]?.when || 'otherwise', ...(s.branches ?? []).map((b) => b.when)]
}

type Item = { s: FlowStep; when?: string; mainIndex?: number; alt?: boolean }

/** the path the flow takes given the outcome picked at each decision */
function walk(main: FlowStep[], choice: Record<number, number>): Item[] {
  const items: Item[] = []
  let cond: string | undefined
  for (let i = 0; i < main.length; i++) {
    const s = main[i]
    items.push({ s, when: i > 0 ? (cond ?? s.when) : undefined, mainIndex: i })
    cond = undefined
    const k = s.branches?.length ? (choice[i] ?? 0) : 0
    if (k > 0) {
      const b = s.branches![k - 1]
      b.steps.forEach((bs, j) => items.push({ s: bs, when: j === 0 ? b.when : undefined, alt: true }))
      break // an alternative path ends the flow (early return / error / other outcome)
    }
  }
  return items
}

type CardProps = {
  s: FlowStep
  n: string
  domain: ArchSystem
  systems: Map<string, ArchSystem>
  lit: boolean
  now: boolean
  selected: boolean
  alt: boolean
  dim?: boolean // on a path the flow is not currently taking
  next?: boolean
  decision?: { labels: string[]; at: number; onCycle: () => void }
  onPick: (s: FlowStep) => void
  onOpenDomain: (id: string) => void
}

function StepCard({ s, n, domain, systems, lit, now, selected, alt, dim, decision, onPick, onOpenDomain }: CardProps) {
  const activity = useActivities().get(s.file ?? '')
  const c = EFFECT_COLOR[s.effect]
  const away = s.system !== domain.id ? systems.get(s.system) : undefined
  const part = (away ?? domain).modules.find((m) => m.id === s.module)
  const AwayIcon = away ? KIND_ICON[away.kind] : null
  const hasData = !!s.writes?.length || !!s.reads?.length
  const clickable = !!decision || !!s.file || hasData
  // a deciding card switches the path; everything else opens its details
  const activate = () => (decision ? decision.onCycle() : clickable && onPick(s))
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => e.key === 'Enter' && activate()}
      title={decision ? 'Click to choose which path runs next' : undefined}
      className={cn(
        'relative flex shrink-0 flex-col rounded-xl border bg-[#0b0b12] p-2.5 transition-all duration-300',
        clickable && 'cursor-pointer',
        away && 'border-dashed',
        alt && 'bg-[#120d06]',
        now ? 'scale-[1.03]' : 'hover:border-white/25',
        selected && 'border-white/60',
        dim && 'opacity-35 saturate-50 hover:opacity-70',
      )}
      style={{
        width: CARD_W,
        borderColor: lit ? c : decision ? `${COND}88` : undefined,
        boxShadow: now ? `0 0 0 1px ${c}, 0 0 28px -4px ${c}` : lit ? `0 0 16px -8px ${c}` : decision ? `0 0 18px -10px ${COND}` : undefined,
      }}
    >
      <ActivityTag activity={activity} />
      <div className="flex items-center gap-1.5">
        <span className="grid h-4 min-w-4 place-items-center rounded-full px-1 font-mono text-[9px] font-bold text-black" style={{ background: c }}>
          {n}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: c }}>
          {EFFECT_TEXT[s.effect]}
        </span>
        {s.file &&
          (s.verified ? (
            <CheckCircle2 className="ml-auto size-3 text-[#b6ff3b]" aria-label="verified in code" />
          ) : (
            <CircleDashed className="ml-auto size-3 text-muted-foreground" aria-label="not verified" />
          ))}
      </div>
      <div className="mt-1 line-clamp-2 text-[12px] leading-snug font-medium">{s.action}</div>

      {decision && (
        <div className="mt-1.5 flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]" style={{ color: COND, borderColor: `${COND}55`, background: `${COND}10` }}>
          <Diamond className="size-2.5 shrink-0 fill-current" />
          <span className="truncate">if {decision.labels[decision.at]}</span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-80">
            <Repeat2 className="size-3" />
            {decision.at + 1}/{decision.labels.length}
          </span>
        </div>
      )}

      {s.reads?.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {s.reads.map((r) => (
            <span key={r.table} className="flex items-center gap-1 rounded border border-[#22e8ff]/40 bg-[#22e8ff]/10 px-1 font-mono text-[9px] text-[#a5f6ff]">
              <Database className="size-2.5" />
              {r.table}
            </span>
          ))}
        </div>
      ) : null}
      {s.writes?.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {s.writes.map((w) => (
            <span key={w.table} className="flex items-center gap-1 rounded border border-[#ff7a1a]/40 bg-[#ff7a1a]/10 px-1 font-mono text-[9px] text-[#ffb27a]">
              <Database className="size-2.5" />
              {w.table}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-2 border-t border-white/10 pt-1 font-mono text-[9px] text-slate-400" title={[...(s.input ?? []), ...(s.output ?? [])].map(f => `${f.name}: ${f.type}`).join(', ')}><div>In: {s.input?.map(f => `${f.name}: ${f.type}`).join(', ') || 'Not documented'}</div><div>Out: {s.output?.map(f => `${f.name}: ${f.type}`).join(', ') || 'Not documented'}</div></div>
      <div className="mt-auto pt-1.5">
        {away ? (
          <button
            className="flex max-w-full items-center gap-1 truncate rounded-full border px-1.5 py-px font-mono text-[10px]"
            style={{ color: kindColor(away.kind), borderColor: `${kindColor(away.kind)}66` }}
            onClick={(e) => {
              e.stopPropagation()
              onOpenDomain(away.id)
            }}
            title={`Hands off to ${away.name} — open it`}
          >
            <CornerDownRight className="size-3 shrink-0" />
            {AwayIcon && <AwayIcon className="size-3 shrink-0" />}
            <span className="truncate">{away.name}</span>
          </button>
        ) : (
          <button
            className={cn('flex max-w-full items-center gap-1 truncate font-mono text-[10px] text-muted-foreground', (s.file || hasData) && 'hover:text-[#22e8ff]')}
            title={`${s.file ?? ''}${s.symbol ? ' › ' + s.symbol : ''}`}
            onClick={(e) => {
              // on a deciding card the file line is how you open its code (the card itself switches the path)
              if (!decision) return
              e.stopPropagation()
              if (s.file || hasData) onPick(s)
            }}
          >
            {decision && s.file ? <FileCode2 className="size-3 shrink-0" /> : null}
            <span className="truncate">
              {part ? <span className="text-slate-400">{part.name}</span> : null}
              {part && s.file ? ' · ' : ''}
              {s.file ? s.file.split('/').pop() : ''}
              {s.symbol ? ` › ${s.symbol}` : ''}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

/** arrow between two steps; carries the condition when the path continues only under it */
function Link({ color, on, now, when, dim }: { color: string; on: boolean; now: boolean; when?: string; dim?: boolean }) {
  const w = when ? COND_ARROW_W : ARROW_W
  return (
    <div className={cn("relative flex shrink-0 items-center justify-center self-center transition-opacity duration-300", dim && "opacity-30")} style={{ width: w }}>
      {when && (
        <span className="absolute -top-6 left-1/2 max-w-[124px] -translate-x-1/2 truncate rounded-full border px-1.5 py-px font-mono text-[9px] whitespace-nowrap" style={{ color: COND, borderColor: `${COND}66`, background: '#0b0b12' }} title={`if ${when}`}>
          if {when}
        </span>
      )}
      <div className="relative h-0.5 w-full overflow-hidden rounded" style={{ background: on ? color : 'rgba(255,255,255,0.12)', boxShadow: on ? `0 0 8px ${color}` : undefined }}>
        {now && <span className="absolute inset-y-0 w-3 animate-[scan_0.65s_linear_infinite] bg-white/90" />}
      </div>
      <ArrowRight className="-ml-1.5 size-3.5 shrink-0" style={{ color: on ? color : 'rgba(255,255,255,0.25)' }} />
    </div>
  )
}

function Row({
  flow,
  domain,
  systems,
  autoPlay,
  isNew,
  onPick,
  onOpenDomain,
  selected,
}: {
  flow: ArchFlow
  domain: ArchSystem
  systems: Map<string, ArchSystem>
  autoPlay: boolean
  isNew: boolean
  onPick: (s: FlowStep) => void
  onOpenDomain: (id: string) => void
  selected: FlowStep | null
}) {
  // which outcome each decision takes (0 = main path, k = alternative k); every path stays on screen
  const [choice, setChoice] = useState<Record<number, number>>({})
  const active = useMemo(() => walk(flow.steps, choice), [flow.steps, choice])
  // the first decision that takes an alternative: main steps after it are off the path
  const cut = flow.steps.findIndex((s, i) => !!s.branches?.length && (choice[i] ?? 0) > 0)
  const [lit, setLit] = useState(-1)
  const timer = useRef<number | undefined>(undefined)
  const rowRef = useRef<HTMLDivElement>(null)
  const pathRef = useRef<HTMLDivElement>(null)

  const play = () => {
    clearInterval(timer.current)
    let i = 0
    setLit(0)
    timer.current = window.setInterval(() => {
      i++
      if (i >= active.length + 3) {
        clearInterval(timer.current)
        setLit(-1)
      } else setLit(Math.min(i, active.length - 1))
    }, 650)
  }
  useEffect(() => () => clearInterval(timer.current), [])
  useEffect(() => {
    if (autoPlay && !document.hidden) {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const t = setTimeout(play, 500)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay])

  // when the path switches, the cards that just became "next" flash once
  const firstChange = useRef(true)
  useEffect(() => {
    if (firstChange.current) {
      firstChange.current = false
      return
    }
    if (!pathRef.current || document.hidden) return
    const cards = pathRef.current.querySelectorAll<HTMLElement>('[data-step][data-next="1"]')
    if (cards.length) animate(cards, { scale: [0.94, 1], opacity: [0.4, 1], delay: stagger(70), duration: 480, ease: 'outBack(1.6)' })
  }, [choice])

  const litSet = useMemo(() => new Set(active.slice(0, lit + 1).map((it) => it.s)), [active, lit])
  const nowStep = lit >= 0 ? active[lit]?.s : undefined
  const setOutcome = (i: number, k: number) => {
    setLit(-1)
    setChoice((c) => ({ ...c, [i]: k }))
  }
  const cycle = (i: number) => setOutcome(i, ((choice[i] ?? 0) + 1) % ((flow.steps[i].branches?.length ?? 0) + 1))
  const linkW = (s: FlowStep) => (s.when ? COND_ARROW_W : ARROW_W)
  const xOf = (i: number) => i * CARD_W + flow.steps.slice(1, i + 1).reduce((sum, x) => sum + linkW(x), 0)
  const decisions = flow.steps.filter((s) => s.branches?.length).length

  const card = (s: FlowStep, n: string, opts: { alt?: boolean; dim: boolean; mainIndex?: number; next?: boolean }) => (
    <StepCard
      s={s}
      n={n}
      domain={domain}
      systems={systems}
      lit={litSet.has(s)}
      now={nowStep === s}
      selected={selected === s}
      alt={!!opts.alt}
      dim={opts.dim}
      next={opts.next}
      decision={opts.mainIndex != null && s.branches?.length ? { labels: outcomes(flow.steps, opts.mainIndex), at: choice[opts.mainIndex] ?? 0, onCycle: () => cycle(opts.mainIndex!) } : undefined}
      onPick={onPick}
      onOpenDomain={onOpenDomain}
    />
  )

  return (
    <section ref={rowRef} data-flow-row className={cn('rounded-2xl border border-white/[0.07] bg-white/[0.015] p-4 transition-shadow', isNew && 'shadow-[0_0_0_1px_#b6ff3b,0_0_30px_-10px_#b6ff3b]')}>
      <header className="mb-3 flex items-start gap-3">
        <Workflow className="mt-0.5 size-4 shrink-0 text-[#ff2bd6]" style={{ filter: 'drop-shadow(0 0 6px #ff2bd6)' }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold tracking-tight">{flow.name}</h3>
            {isNew && <span className="rounded-full bg-[#b6ff3b] px-1.5 font-mono text-[9px] font-bold text-black">NEW</span>}
            {decisions > 0 && (
              <span className="rounded-full border px-1.5 font-mono text-[9px]" style={{ color: COND, borderColor: `${COND}55` }} title="Click a ◆ card (or an 'if …' chip) to choose which path runs next">
                {decisions} decision{decisions > 1 ? 's' : ''} · click ◆ to choose the path
              </span>
            )}
            {cut >= 0 && (
              <button className="font-mono text-[9px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setChoice({})}>
                back to main path
              </button>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">
            <span className="text-slate-400">When:</span> {flow.trigger}
            {flow.summary ? <span className="text-slate-500"> — {flow.summary}</span> : null}
          </p>
        </div>
        <Button size="xs" onClick={play} className="shrink-0 bg-[#ff2bd6]/15 text-[#ff9bea] hover:bg-[#ff2bd6]/25">
          <Play /> Play
        </Button>
      </header>

      <div className="overflow-x-auto pb-1">
        <div ref={pathRef} className="w-max">
          {/* main path — always shown; steps after a decision that took another outcome are dimmed */}
          <div className={cn('flex items-stretch', flow.steps.some((s) => s.when) && 'pt-5')}>
            {flow.steps.map((s, i) => {
              const off = cut >= 0 && i > cut
              const next = !off && i > 0 && !!flow.steps[i - 1].branches?.length // the card a decision currently leads to
              return (
                <Fragment key={i}>
                  {i > 0 && <Link color={EFFECT_COLOR[s.effect]} on={litSet.has(s)} now={nowStep === s} when={s.when} dim={off} />}
                  <div data-step data-next={next ? '1' : '0'}>{card(s, String(i + 1), { dim: off, mainIndex: i })}</div>
                </Fragment>
              )
            })}
          </div>
          {/* every alternative path hangs below its decision; the chosen one is live, the others dimmed */}
          {flow.steps.flatMap((s, i) =>
            (s.branches ?? []).map((b, bi) => {
              const reachable = cut < 0 || i <= cut
              const chosen = reachable && (choice[i] ?? 0) === bi + 1
              return (
                <div key={`${i}-${bi}`} className="flex items-start transition-opacity duration-300" style={{ marginLeft: xOf(i) + CARD_W / 2 - 1 }}>
                  <div
                    className={cn('h-12 w-6 shrink-0 rounded-bl-xl border-b-2 border-l-2 transition-all duration-300', !chosen && 'border-dashed')}
                    style={{ borderColor: chosen ? COND : `${COND}55`, filter: chosen ? `drop-shadow(0 0 4px ${COND})` : undefined }}
                  />
                  <div className="mt-7 flex items-stretch">
                    <button
                      onClick={() => setOutcome(i, chosen ? 0 : bi + 1)}
                      title={chosen ? 'Go back to the main path' : 'Follow this path'}
                      className={cn('mr-2 self-center rounded-full border px-2 py-0.5 font-mono text-[10px] whitespace-nowrap transition-all', chosen ? 'shadow-[0_0_14px_-4px_#ffb020]' : 'opacity-60 hover:opacity-100')}
                      style={{ color: COND, borderColor: chosen ? COND : `${COND}66`, background: chosen ? `${COND}22` : `${COND}0d` }}
                    >
                      if {b.when}
                    </button>
                    {b.steps.map((bs, j) => (
                      <Fragment key={j}>
                        {j > 0 && <Link color={EFFECT_COLOR[bs.effect]} on={litSet.has(bs)} now={nowStep === bs} dim={!chosen} />}
                        <div data-step data-next={chosen && j === 0 ? '1' : '0'}>
                          {card(bs, `${i + 1}${String.fromCharCode(97 + bi)}${b.steps.length > 1 ? j + 1 : ''}`, { alt: true, dim: !chosen })}
                        </div>
                      </Fragment>
                    ))}
                  </div>
                </div>
              )
            }),
          )}
        </div>
      </div>
    </section>
  )
}

/** Inside a capability: its flows, each a row of steps you can steer at every decision — the semantic view of how it works. */
export function DomainFlows({
  domain,
  flows,
  passing,
  systems,
  autoPlayId,
  freshIds,
  onPick,
  onOpenDomain,
  selected,
}: {
  domain: ArchSystem
  flows: ArchFlow[]
  passing: ArchFlow[]
  systems: Map<string, ArchSystem>
  autoPlayId: string | null
  freshIds: Set<string>
  onPick: (s: FlowStep) => void
  onOpenDomain: (id: string) => void
  selected: FlowStep | null
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const ids = useMemo(() => flows.map((f) => f.id).join('|'), [flows])
  useEffect(() => {
    if (!wrap.current || document.hidden) return
    animate(wrap.current.querySelectorAll('[data-flow-row]'), { opacity: [0, 1], translateY: [12, 0], delay: stagger(70), duration: 550, ease: 'outExpo' })
  }, [domain.id, ids])
  const c = kindColor(domain.kind)
  return (
    <div ref={wrap} className="h-full space-y-3 overflow-y-auto p-5">
      {flows.length === 0 && (
        <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-muted-foreground">
          No flows recorded for {domain.name} yet. Turn on LIVE or map the project to find them, or switch to Parts.
        </div>
      )}
      {flows.map((f) => (
        <Row key={f.id} flow={f} domain={domain} systems={systems} autoPlay={autoPlayId === f.id} isNew={freshIds.has(f.id)} onPick={onPick} onOpenDomain={onOpenDomain} selected={selected} />
      ))}
      {passing.length > 0 && (
        <div className="pt-2">
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Other flows that pass through <span style={{ color: c }}>{domain.name}</span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {passing.map((f) => {
              const owner = f.domain ? systems.get(f.domain) : undefined
              return (
                <button key={f.id} onClick={() => owner && onOpenDomain(owner.id)} className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-left text-[12px] hover:border-white/25">
                  <span className="font-medium">{f.name}</span>
                  {owner && <span className="ml-1.5 font-mono text-[10px]" style={{ color: kindColor(owner.kind) }}>in {owner.name}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
