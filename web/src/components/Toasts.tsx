import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import { hashscanTx } from "../config/chain"
import { shortHash } from "../lib/format"
import { cx } from "./ui"

export type ToastState = "info" | "signing" | "pending" | "confirmed" | "failed"
export type Toast = { id: number; title: string; detail?: string; state: ToastState; hash?: string; at: number }
type Api = { push: (t: Omit<Toast, "id" | "at">) => number; update: (id: number, patch: Partial<Omit<Toast, "id">>) => void; dismiss: (id: number) => void; toasts: Toast[] }

const Ctx = createContext<Api | null>(null)
export const useToasts = () => {
  const api = useContext(Ctx)
  if (!api) throw new Error("ToastProvider missing")
  return api
}

/** At most three on screen; the oldest goes when a fourth arrives. */
const MAX = 3

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((t: Omit<Toast, "id" | "at">) => {
    const id = ++seq.current
    setToasts((all) => [...all, { ...t, id, at: Date.now() }].slice(-MAX))
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
        const done = t.state === "confirmed"
        return (
          <div key={t.id} className={cx("panel shadow-md px-3 py-2.5 flex gap-3 items-start text-[13px]", done && "border-ok/60")}>
            <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-full grid place-items-center text-[11px] font-semibold ${ic.cls}`} aria-hidden>{ic.glyph}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium truncate">{t.title}</span>
                {STATE_LABEL[t.state] && <span className={cx("label whitespace-nowrap", done && "text-ok")}>{STATE_LABEL[t.state]}</span>}
              </div>
              {t.detail && !done && <p className="text-muted mt-0.5 leading-snug break-words">{t.detail}</p>}
              {t.hash && (
                // once confirmed, the receipt is the point of the toast: the link is the line
                <a className={cx("mt-1 inline-block font-mono text-[12px] link", done ? "text-fg font-medium decoration-current" : "text-muted")} href={hashscanTx(t.hash)} target="_blank" rel="noreferrer" title={t.hash}>
                  {done ? `View ${shortHash(t.hash)} on HashScan` : `${shortHash(t.hash)} on HashScan`} ↗
                </a>
              )}
            </div>
            <button type="button" className="text-faint hover:text-fg text-[16px] leading-none -mt-0.5" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
          </div>
        )
      })}
    </div>
  )
}
