import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react"
import { hashscanAccount, hashscanContract, hashscanTx } from "../config/chain"
import { CONTRACT_NAMES } from "../config/deployments"
import type { Tone } from "../lib/coverage"
import { countdown, fmtTime, shortAddress, shortHash, type Status } from "../lib/format"

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ")

export function Panel({ title, aside, children, className, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("panel", className)}>
      {title !== undefined && (
        <header className="panel-head">
          <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
          {aside && <div className="text-[12px] text-muted flex items-center gap-2">{aside}</div>}
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
      <a href={href} target="_blank" rel="noreferrer" title={address} className="hover:underline underline-offset-2">
        {name ?? shortAddress(address)}
      </a>
      {me && <Badge tone="ok">you</Badge>}
      <Copy text={address} label="Copy address" />
    </span>
  )
}
export const TxLink = ({ hash, children }: { hash: string; children?: ReactNode }) => (
  <a href={hashscanTx(hash)} target="_blank" rel="noreferrer" title={hash} className="font-mono text-[12px] text-accent hover:underline underline-offset-2">
    {children ?? shortHash(hash)} ↗
  </a>
)
export const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline underline-offset-2">{children} ↗</a>
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
export const Button = ({ variant = "default", size = "md", busy, className, children, disabled, ...p }: BtnProps) => (
  <button {...p} disabled={disabled || busy} className={cx("btn", variant === "primary" && "btn-primary", variant === "danger" && "btn-danger", size === "sm" && "btn-sm", className)}>
    {busy && <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden />}
    {children}
  </button>
)

/** Two-step action: the first click arms the button and states exactly what will happen; the second sends. */
export function ConfirmButton({ confirm, onConfirm, children, variant, size, disabled, busy, className }: { confirm: string; onConfirm: () => void | Promise<unknown>; children: ReactNode; variant?: BtnProps["variant"]; size?: BtnProps["size"]; disabled?: boolean; busy?: boolean; className?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const h = setTimeout(() => setArmed(false), 8000)
    return () => clearTimeout(h)
  }, [armed])
  if (!armed) return <Button variant={variant} size={size} disabled={disabled} busy={busy} className={className} onClick={() => setArmed(true)}>{children}</Button>
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="text-[12px] text-muted">{confirm}</span>
      <Button variant={variant === "danger" ? "danger" : "primary"} size={size} busy={busy} onClick={async () => { setArmed(false); await onConfirm() }} autoFocus>Confirm</Button>
      <Button size={size} onClick={() => setArmed(false)}>Cancel</Button>
    </span>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="px-4 py-6 text-center text-[13px] text-muted">{children}</div>
export const Loading = ({ rows = 3 }: { rows?: number }) => (
  <div className="px-4 py-3 flex flex-col gap-2" aria-busy>
    {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-3.5 rounded bg-surface-2 animate-pulse" style={{ width: `${70 - i * 12}%` }} />)}
  </div>
)
export const ErrorNote = ({ error, children }: { error?: unknown; children?: ReactNode }) => (
  <div className="px-4 py-3 text-[13px] text-bad">{children ?? (error instanceof Error ? error.message : String(error))}</div>
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
