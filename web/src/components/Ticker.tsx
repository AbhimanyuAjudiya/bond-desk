import { Link } from "react-router"
import { useBonds, useHbarUsd, useHealth, useMinCoverage, useRisk } from "../hooks/data"
import { coverageBand } from "../lib/coverage"
import { countdown, fmtBps, fmtClock, fmtInt, fmtPrice, fmtUsd8 } from "../lib/format"
import { cx } from "./ui"

const TONE = { ok: "text-ok", warn: "text-warn", bad: "text-bad", neutral: "text-muted" }

/** One line of live numbers under the header: the feed, the block, every book's quote and coverage, the last verdict. */
export function Ticker() {
  const bonds = useBonds()
  const hbar = useHbarUsd()
  const health = useHealth()
  const min = useMinCoverage()
  const risk = useRisk("1")
  const list = bonds.data?.bonds ?? []
  const v = risk.data?.lastVerdict
  const down = bonds.isError || health.isError
  return (
    <div className="border-b border-border bg-bg">
      <div className="mx-auto max-w-[1440px] px-3 h-7 flex items-center gap-4 overflow-x-auto overscroll-x-contain" aria-label="Live strip">
        <span className="tick" title="HBAR/USD from NavOracle (Chainlink feed, 8 decimals)">
          <span className="label">HBAR/USD</span>
          <span className={cx("num", hbar.isError && "text-warn")}>{hbar.data !== undefined ? fmtUsd8(hbar.data) : hbar.isError ? "stale" : "…"}</span>
        </span>
        <span className="tick" title="Latest Hedera block seen by the API">
          <span className="label">Block</span>
          <span className={cx("num", health.isError && "text-bad")}>{health.data?.block ? fmtInt(health.data.block) : health.isError ? "API down" : "…"}</span>
        </span>
        <span className="h-3.5 w-px bg-border shrink-0" aria-hidden />
        {list.map((b) => {
          const band = coverageBand(b.coverageBps, min.data ?? 0n)
          return (
            <Link key={b.id} to={`/bonds/${b.id}`} className="tick hover:text-fg" title={`${b.symbol}: bid ${fmtPrice(b.bestBid)}, ask ${fmtPrice(b.bestAsk)}, coverage ${b.coverageBps === null ? "feed stale" : fmtBps(b.coverageBps)} (${band.label}), ${b.status}`}>
              <span className={cx("font-medium", b.status !== "Active" && "text-warn")}>{b.symbol}</span>
              <span className="num text-bid">{fmtPrice(b.bestBid)}</span>
              <span className="text-faint">/</span>
              <span className="num text-ask">{fmtPrice(b.bestAsk)}</span>
              <span className={cx("num", TONE[band.tone])}>{b.coverageBps === null ? "—" : fmtBps(b.coverageBps, 1)}</span>
            </Link>
          )
        })}
        {bonds.isLoading && <span className="tick text-muted">loading bonds…</span>}
        {down && <span className="tick text-bad">API unreachable</span>}
        <span className="h-3.5 w-px bg-border shrink-0" aria-hidden />
        <span className="tick" title="Last verdict applied to bond 1 by the risk gate">
          <span className="label">Verdict</span>
          <span className={cx("num", v ? (v.action === "OK" ? "text-ok" : v.action === "DEFAULT" ? "text-bad" : "text-warn") : "text-muted")}>{v ? `${v.action} #${v.nonce}` : risk.data ? "none" : "…"}</span>
          {v && <span className="text-muted">{countdown(v.timestamp)}</span>}
        </span>
        <span className="tick ml-auto text-muted" title="When the bond list was last read from the API">
          {bonds.dataUpdatedAt ? <span className="num text-muted">{fmtClock(bonds.dataUpdatedAt)}</span> : null}
        </span>
      </div>
    </div>
  )
}
