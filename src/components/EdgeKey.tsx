export function EdgeKey({ color, dash, label }: { color: string; dash?: string; label: string }) {
  return <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-xs">
    <svg aria-hidden="true" width="18" height="10" viewBox="0 0 18 10" style={{ color }}>
      <path d="M1 5H17" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={dash} />
    </svg>{label}
  </span>
}
