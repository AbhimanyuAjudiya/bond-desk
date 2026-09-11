import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import { hashscanTx } from "../config/chain"
import { shortHash } from "../lib/format"

export type ToastState = "info" | "signing" | "pending" | "confirmed" | "failed"
export type Toast = { id: number; title: string; detail?: string; state: ToastState; hash?: string; at: number }
type Api = { push: (t: Omit<Toast, "id" | "at">) => number; update: (id: number, patch: Partial<Omit<Toast, "id">>) => void; dismiss: (id: number) => void; toasts: Toast[] }

const Ctx = createContext<Api | null>(null)
export const useToasts = () => {
  const api = useContext(Ctx)
  if (!api) throw new Error("ToastProvider missing")
  return api
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((t: Omit<Toast, "id" | "at">) => {
    const id = ++seq.current
    setToasts((all) => [...all, { ...t, id, at: Date.now() }].slice(-6))
    if (t.state === "info" || t.state === "confirmed") setTimeout(() => dismiss(id), 8000)
    return id
  }, [dismiss])
  const update = useCallback((id: number, patch: Partial<Omit<Toast, "id">>) => {
    setToasts((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    if (patch.state === "confirmed") setTimeout(() => dismiss(id), 12000)
  }, [dismiss])
  const api = useMemo(() => ({ push, update, dismiss, toasts }), [push, update, dismiss, toasts])
  return (
    <Ctx.Provider value={api}>
      {children}
      <TxTray toasts={toasts} dismiss={dismiss} />
    </Ctx.Provider>
  )
}

const ICON: Record<ToastState, { glyph: string; cls: string }> = {
  info: { glyph: "i", cls: "bg-neutral-soft text-neutral" },
  signing: { glyph: "✎", cls: "bg-accent-soft text-accent" },
  pending: { glyph: "…", cls: "bg-warn-soft text-warn animate-pulse" },
  confirmed: { glyph: "✓", cls: "bg-ok-soft text-ok" },
  failed: { glyph: "✕", cls: "bg-bad-soft text-bad" },
}
const STATE_LABEL: Record<ToastState, string> = { info: "", signing: "Waiting for your wallet", pending: "Pending on Hedera", confirmed: "Confirmed", failed: "Failed" }

function TxTray({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-3 right-3 left-3 sm:left-auto sm:w-[380px] z-50 flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => {
        const ic = ICON[t.state]
        return (
          <div key={t.id} className="panel shadow-lg px-3 py-2.5 flex gap-3 items-start text-[13px]">
            <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-full grid place-items-center text-[11px] font-semibold ${ic.cls}`} aria-hidden>{ic.glyph}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium truncate">{t.title}</span>
                {STATE_LABEL[t.state] && <span className="label whitespace-nowrap">{STATE_LABEL[t.state]}</span>}
              </div>
              {t.detail && <p className="text-muted mt-0.5 leading-snug break-words">{t.detail}</p>}
              {t.hash && (
                <a className="font-mono text-[12px] text-accent underline-offset-2 hover:underline" href={hashscanTx(t.hash)} target="_blank" rel="noreferrer">
                  {shortHash(t.hash)} on HashScan ↗
                </a>
              )}
            </div>
            <button className="text-faint hover:text-fg text-[16px] leading-none -mt-0.5" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
          </div>
        )
      })}
    </div>
  )
}
