import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export type ConfirmOptions = {
  title: string
  description: ReactNode
  confirmLabel: string
  /** red confirm button for actions that remove something */
  destructive?: boolean
}

/**
 * One modal for every action that needs a second "yes": removing a project, re-mapping over a saved map,
 * writing or removing hooks. The confirm button shows a spinner while the action runs and the modal stays open
 * on failure so the error can be read.
 */
export function ConfirmDialog({ open, options, onConfirm, onOpenChange }: { open: boolean; options: ConfirmOptions | null; onConfirm: () => Promise<void> | void; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!options) return null
  const close = (next: boolean) => {
    if (busy) return
    setError(null)
    onOpenChange(next)
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{options.title}</DialogTitle>
          <DialogDescription className="mt-2 leading-relaxed">{options.description}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="mx-6 mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </p>
        )}
        <DialogFooter className="m-0 flex-row justify-end gap-2 rounded-none border-t border-white/10 px-6 py-4">
          <Button variant="ghost" disabled={busy} onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            autoFocus
            disabled={busy}
            className={options.destructive ? 'bg-red-500 text-white hover:bg-red-400' : undefined}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onConfirm()
                onOpenChange(false)
              } catch (e) {
                setError((e as Error).message || 'Something went wrong. Try again.')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {options.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** state helper: `ask(options, action)` opens the modal; render `dialog` once in the component */
export function useConfirm() {
  const [state, setState] = useState<{ options: ConfirmOptions; action: () => Promise<void> | void } | null>(null)
  const [open, setOpen] = useState(false)
  const ask = (options: ConfirmOptions, action: () => Promise<void> | void) => {
    setState({ options, action })
    setOpen(true)
  }
  const dialog = <ConfirmDialog open={open} options={state?.options ?? null} onOpenChange={setOpen} onConfirm={() => state?.action()} />
  return { ask, dialog }
}
