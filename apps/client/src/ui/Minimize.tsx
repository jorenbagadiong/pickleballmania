import type { ReactNode } from 'react'
import { useUi } from '../state/store'

/** Puts a panel away into a small bar, to see the court and walk around. */
export function MinimizeButton() {
  return (
    <button
      data-testid="minimize"
      title="Minimize"
      aria-label="Minimize"
      className="absolute right-3 top-3 h-8 w-8 rounded-lg bg-slate-700 text-lg font-bold leading-none hover:bg-slate-600"
      onClick={(e) => (e.currentTarget.blur(), useUi.setState({ panelHidden: true }))}
    >
      –
    </button>
  )
}

/** What is left of a minimized panel: the essentials, and the way to open it again. */
export function MiniBar({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-28 flex justify-center px-4">
      <div
        data-testid="mini-bar"
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-3 rounded-xl border border-white/10 bg-slate-900/85 px-4 py-2 text-sm text-slate-100 shadow-lg"
      >
        {children}
        <button
          data-testid="restore"
          className="rounded-lg bg-slate-700 px-3 py-1 font-semibold hover:bg-slate-600"
          onClick={(e) => (e.currentTarget.blur(), useUi.setState({ panelHidden: false }))}
        >
          Open
        </button>
      </div>
    </div>
  )
}

/** "I'm ready", small. */
export function MiniReady({ ready, onClick }: { ready: boolean; onClick(): void }) {
  return (
    <button
      data-testid="ready"
      className={`rounded-lg px-4 py-1 font-bold ${
        ready ? 'bg-slate-600 hover:bg-slate-500' : 'bg-lime-400 text-slate-900 hover:bg-lime-300'
      }`}
      onClick={(e) => (e.currentTarget.blur(), onClick())}
    >
      {ready ? 'Not ready' : "I'm ready"}
    </button>
  )
}
