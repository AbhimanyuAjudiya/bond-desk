import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react"
import { hashscanAccount, hashscanContract, hashscanTx } from "../config/chain"
import { CONTRACT_NAMES } from "../config/deployments"
import type { Tone } from "../lib/coverage"
import { countdown, fmtClock, fmtTime, shortAddress, shortHash, type Status } from "../lib/format"

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ")

export function Panel({ title, aside, children, className, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("panel", className)}>
      {title !== undefined && (
        <header className="panel-head">
          <h3 className="text-[13px] font-semibold tracking-tight whitespace-nowrap">{title}</h3>
          {aside && <div className="text-[12px] text-muted flex items-center gap-2 min-w-0">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

const TONE: Record<Tone, string> = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", neutral: "bg-neutral-soft text-neutral" }
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={cx("badge", TONE[tone])} title={title}>{children}</span>
}
export const statusTone = (s: Status | string): Tone => (s === "Active" ? "ok" : s === "Frozen" ? "warn" : s === "Defaulted" ? "bad" : "neutral")
export const StatusBadge = ({ status }: { status: Status | string }) => <Badge tone={statusTone(status)}>{status}</Badge>
export const actionTone = (a: string): Tone => (a === "OK" ? "ok" : a === "WARN" ? "warn" : a === "FREEZE" ? "warn" : a === "DEFAULT" ? "bad" : "neutral")
export const ActionBadge = ({ action }: { action: string }) => <Badge tone={actionTone(action)}>{action}</Badge>

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="text-faint hover:text-fg text-[11px] leading-none px-0.5"
      aria-label={`${label} ${text}`}
      title={done ? "Copied" : label}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text) } catch { /* clipboard unavailable */ }
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? "✓" : "⧉"}
    </button>
  )
}

/** Truncated address with a copy button and a HashScan link; known desk contracts show their name. */
export function AddressChip({ address, kind, me, className }: { address: string; kind?: "account" | "contract"; me?: boolean; className?: string }) {
  const name = CONTRACT_NAMES[address.toLowerCase()]
  const href = (kind ?? (name ? "contract" : "account")) === "contract" ? hashscanContract(address) : hashscanAccount(address)
  return (
    <span className={cx("inline-flex items-center gap-1 font-mono text-[12px]", className)}>
      <a href={href} target="_blank" rel="noreferrer" title={address} className="link">
        {name ?? shortAddress(address)}
      </a>
      {me && <Badge tone="ok">you</Badge>}
      <Copy text={address} label="Copy address" />
    </span>
  )
}
/** HashScan transaction link: plain underlined text, the hash shortened. */
export const TxLink = ({ hash, children }: { hash: string; children?: ReactNode }) => (
  <a href={hashscanTx(hash)} target="_blank" rel="noreferrer" title={hash} className="link font-mono text-[12px] whitespace-nowrap">
    {children ?? shortHash(hash)} ↗
  </a>
)
export const Ext = ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
  <a href={href} target="_blank" rel="noreferrer" className={cx("link", className)}>{children} ↗</a>
)

export function Time({ unix, className }: { unix: string | number | bigint; className?: string }) {
  const t = fmtTime(unix)
  return <time className={cx("num", className)} dateTime={new Date(Number(unix) * 1000).toISOString()} title={t.utc}>{t.local}</time>
}
export function Countdown({ unix }: { unix: string | number | bigint }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const h = setInterval(() => tick((x) => x + 1), 30_000)
    return () => clearInterval(h)
  }, [])
  return <span className="num" title={fmtTime(unix).utc}>{countdown(unix)}</span>
}
/** When a query last returned, as a wall clock: the small print that says the numbers are live. */
export const Refreshed = ({ at, children = "read" }: { at?: number; children?: ReactNode }) =>
  at ? <span className="num text-[11px] text-muted whitespace-nowrap">{children} {fmtClock(at)}</span> : null

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="label">{label}</label>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  )
}
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx("input", className)} />

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "default" | "danger"; size?: "sm" | "md"; busy?: boolean }
export const Button = ({ variant = "default", size = "md", busy, className, children, disabled, type = "button", ...p }: BtnProps) => (
  <button {...p} type={type} disabled={disabled || busy} className={cx("btn", variant === "primary" && "btn-primary", variant === "danger" && "btn-danger", size === "sm" && "btn-sm", className)}>
    {busy && <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden />}
    {children}
  </button>
)

/**
 * Two-step action that keeps its footprint. The first click turns the button into Confirm plus a small Cancel in the
 * same row (the group holds the idle width, so nothing around it moves) and pins a note beside it saying exactly what
 * will happen. Confirm is focused, so Enter sends; Escape or the second button cancels; it disarms by itself after 8 s.
 */
export function ConfirmButton({ confirm, onConfirm, children, variant, size, disabled, busy, className }: { confirm: string; onConfirm: () => void | Promise<unknown>; children: ReactNode; variant?: BtnProps["variant"]; size?: BtnProps["size"]; disabled?: boolean; busy?: boolean; className?: string }) {
  const [armed, setArmed] = useState(false)
  const [width, setWidth] = useState<number>()
  const [note, setNote] = useState<{ top: number; left: number; above: boolean; width: number } | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const wasArmed = useRef(false)
  const noteId = useId()
  useEffect(() => {
    if (!armed) {
      // give focus back to the idle button after a cancel, but never steal it from somewhere the user went meanwhile
      if (wasArmed.current && document.activeElement === document.body) wrap.current?.querySelector("button")?.focus()
      wasArmed.current = false
      return
    }
    wasArmed.current = true
    const place = () => {
      const r = wrap.current?.getBoundingClientRect()
      if (!r) return
      const w = Math.min(340, window.innerWidth - 16)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
      setNote(r.top > 110 ? { top: r.top - 6, left, above: true, width: w } : { top: r.bottom + 6, left, above: false, width: w })
    }
    place()
    const h = setTimeout(() => setArmed(false), 8000)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setArmed(false) }
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => { clearTimeout(h); document.removeEventListener("keydown", onKey); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place) }
  }, [armed])
  const arm = () => { setWidth(wrap.current?.offsetWidth); setArmed(true) }
  return (
    <span ref={wrap} className={cx("inline-flex align-middle", className)} style={armed && width ? { minWidth: width } : undefined}>
      {!armed ? (
        <Button variant={variant} size={size} disabled={disabled} busy={busy} className="flex-1" onClick={arm}>{children}</Button>
      ) : (
        <>
          <Button variant={variant === "danger" ? "danger" : "primary"} size={size} busy={busy} className="flex-1 rounded-r-none" onClick={async () => { setArmed(false); await onConfirm() }} autoFocus aria-describedby={noteId}>Confirm</Button>
          <Button size={size} className="rounded-l-none border-l-0 px-2" onClick={() => setArmed(false)} aria-label="Cancel">×</Button>
          {note && (
            <span id={noteId} role="status" className="fixed z-50 panel shadow-md px-2.5 py-1.5 text-[12px] leading-snug text-fg text-left font-normal whitespace-normal" style={{ top: note.top, left: note.left, maxWidth: note.width, transform: note.above ? "translateY(-100%)" : undefined }}>
              {confirm} <span className="text-muted whitespace-nowrap"><kbd>Enter</kbd> confirms, <kbd>Esc</kbd> cancels.</span>
            </span>
          )}
        </>
      )}
    </span>
  )
}

/* Empty, loading and error states: one quiet sentence each, the same everywhere. */
export const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-4 text-[13px] text-muted">{children}</p>
export const Loading = ({ children = "Loading…" }: { children?: ReactNode }) => <p className="px-4 py-4 text-[13px] text-muted" aria-busy="true">{children}</p>
export const ErrorNote = ({ error, children }: { error?: unknown; children?: ReactNode }) => (
  <p className="px-4 py-4 text-[13px] text-bad">{children ?? `Could not load this: ${error instanceof Error ? error.message : String(error)}.`}</p>
)
export const Note = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cx("note", className)}>{children}</p>
export const KV = ({ rows }: { rows: [ReactNode, ReactNode][] }) => (
  <dl className="kv">
    {rows.map(([k, v], i) => (
      <div key={i} className="contents">
        <dt>{k}</dt>
        <dd className="num min-w-0 truncate">{v}</dd>
      </div>
    ))}
  </dl>
)
