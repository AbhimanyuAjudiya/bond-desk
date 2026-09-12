import { useMemo, useState, type KeyboardEvent } from "react"
import { useNavigate } from "react-router"
import { useAccount } from "wagmi"
import { SelfService } from "../components/SelfService"
import { AddressChip, Badge, Countdown, Empty, ErrorNote, Loading, Panel, Refreshed, StatusBadge, Time, cx } from "../components/ui"
import { useBonds, useEligibility, useMinCoverage, useOrderbooks } from "../hooks/data"
import type { BondSummary, Orderbook } from "../lib/api"
import { coverageBand } from "../lib/coverage"
import { countdown, fmtBps, fmtInt, fmtPrice, intervalName, spreadMid } from "../lib/format"

type SortKey = "id" | "bid" | "ask" | "spread" | "yield" | "coverage" | "coupon" | "maturity"
type Row = { b: BondSummary; book?: Orderbook; bidSize: bigint; askSize: bigint; spreadBps: bigint | null; last?: Orderbook["trades"][number] }

const big = (s: string | null) => (s === null ? -1n : BigInt(s))
const SORT: Record<SortKey, (r: Row) => bigint> = {
  id: (r) => BigInt(r.b.id),
  bid: (r) => big(r.b.bestBid),
  ask: (r) => (r.b.bestAsk === "0" ? 2n ** 128n : big(r.b.bestAsk)),
  spread: (r) => r.spreadBps ?? 2n ** 128n,
  yield: (r) => big(r.b.currentYieldBps),
  coverage: (r) => big(r.b.coverageBps),
  coupon: (r) => big(r.b.couponRateBps),
  maturity: (r) => big(r.b.maturity),
}
/** Size available at the best price on one side of the book. */
const sizeAtBest = (orders: Orderbook["bids"], best: string) => orders.filter((o) => o.price === best).reduce((s, o) => s + BigInt(o.amount), 0n)

export function Desk() {
  const bonds = useBonds()
  const min = useMinCoverage()
  const { address } = useAccount()
  const navigate = useNavigate()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 })
  const [cursor, setCursor] = useState(0)
  const list = bonds.data?.bonds ?? []
  const books = useOrderbooks(list.map((b) => b.id))
  const rows = useMemo<Row[]>(() => {
    const out = list.map((b, i) => {
      const book = books[i]?.data
      return {
        b, book,
        bidSize: book ? sizeAtBest(book.bids, book.bestBid) : 0n,
        askSize: book ? sizeAtBest(book.asks, book.bestAsk) : 0n,
        spreadBps: spreadMid(b.bestBid, b.bestAsk)?.spreadBps ?? null,
        last: book?.trades[0],
      }
    })
    const f = SORT[sort.key]
    return out.sort((x, y) => { const a = f(x), b = f(y); return a === b ? 0 : (a > b ? 1 : -1) * sort.dir })
  }, [list, books, sort])
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "id" || key === "ask" || key === "spread" || key === "maturity" ? 1 : -1 }))
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1)) }
    else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
    else if (e.key === "Enter") { e.preventDefault(); const r = rows[cursor]; if (r) navigate(`/bonds/${r.b.id}`) }
  }
  const th = (key: SortKey, label: string, extra?: string) => (
    <th className={extra} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => toggle(key)} title={`Sort by ${label.toLowerCase()}`}>{label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button>
    </th>
  )
  return (
    <>
      <Panel title="Bonds" aside={<><span className="hidden md:inline">every registered bond and its book · <kbd>j</kbd> <kbd>k</kbd> move, <kbd>Enter</kbd> opens, <kbd>1</kbd>–<kbd>9</kbd> jump</span><Refreshed at={bonds.dataUpdatedAt} /></>}>
        {bonds.isLoading && <Loading />}
        {bonds.isError && <ErrorNote error={bonds.error} />}
        {bonds.data && list.length === 0 && <Empty>No bonds are registered yet.</Empty>}
        {rows.length > 0 && (
          <div className="scroll-x outline-none" tabIndex={0} onKeyDown={onKey} aria-label="Bond grid, keyboard navigable">
            <table className="table">
              <thead>
                <tr>
                  {th("id", "Bond")}
                  <th>Status</th>
                  {th("coupon", "Coupon", "text-right")}
                  <th>Paid</th>
                  {th("maturity", "Maturity")}
                  {th("bid", "Bid", "text-right")}
                  <th className="text-right" title="Bonds offered at the best bid">Size</th>
                  {th("ask", "Ask", "text-right")}
                  <th className="text-right" title="Bonds offered at the best ask">Size</th>
                  {th("spread", "Spread", "text-right")}
                  <th className="text-right" title="Clean price plus accrued coupon, from NavOracle">Mark</th>
                  {th("yield", "Yield", "text-right")}
                  {th("coverage", "Coverage", "text-right")}
                  <th className="text-right" title="Open bids · open asks">Depth</th>
                  <th className="text-right">Last fill</th>
                  <th>Next coupon</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const b = r.b
                  const band = coverageBand(b.coverageBps, min.data ?? 0n)
                  const d = r.book
                  return (
                    <tr key={b.id} data-active={i === cursor} className="cursor-pointer" onClick={() => navigate(`/bonds/${b.id}`)} onMouseEnter={() => setCursor(i)}>
                      <td className="whitespace-nowrap"><span className="font-semibold">{b.symbol}</span> <span className="text-muted num">#{b.id}</span></td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="num text-right">{fmtBps(b.couponRateBps)}</td>
                      <td className="text-muted whitespace-nowrap">{intervalName(b.couponInterval)}</td>
                      <td className="whitespace-nowrap"><Time unix={b.maturity} /></td>
                      <td className="num text-right text-bid">{fmtPrice(b.bestBid)}</td>
                      <td className="num text-right text-muted">{d ? fmtInt(r.bidSize) : "…"}</td>
                      <td className="num text-right text-ask">{fmtPrice(b.bestAsk)}</td>
                      <td className="num text-right text-muted">{d ? fmtInt(r.askSize) : "…"}</td>
                      <td className="num text-right">{r.spreadBps === null ? "—" : r.spreadBps < 0n ? <span className="text-warn">crossed</span> : fmtBps(r.spreadBps)}</td>
                      <td className="num text-right">{fmtPrice(b.mark)}</td>
                      <td className="num text-right" title="face × coupon / best ask">{fmtBps(b.currentYieldBps)}</td>
                      <td className="text-right whitespace-nowrap">
                        <span className="num">{b.coverageBps === null ? "—" : fmtBps(b.coverageBps)}</span>
                        <Badge tone={band.tone} title={band.sentence}>{band.label}</Badge>
                      </td>
                      <td className={cx("num text-right whitespace-nowrap", d && d.bids.length + d.asks.length === 0 && "text-faint")} title={d ? `${d.bids.length} bids, ${d.asks.length} asks` : "loading the book"}>
                        {d ? `${d.bids.length} · ${d.asks.length}` : "…"}
                      </td>
                      <td className="num text-right whitespace-nowrap text-muted" title={r.last ? `${fmtInt(r.last.amount)} at ${fmtPrice(r.last.price)} USDC` : "no fills yet"}>
                        {r.last ? <><span className="text-fg">{fmtPrice(r.last.price)}</span> {countdown(r.last.timestamp)}</> : "—"}
                      </td>
                      <td className="whitespace-nowrap"><Countdown unix={b.nextCoupon} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start">
        <EligibilityStrip address={address} />
        <SelfService />
      </div>
    </>
  )
}

const REASON: Record<string, string> = {
  "kyc-granted": "KYC granted, bond Active",
  "no-kyc": "no KYC on the token; request it here",
  "no-hedera-account": "no Hedera account yet; use the faucet",
  "bond-not-active": "KYC granted, but the bond is not Active",
}

function EligibilityStrip({ address }: { address?: `0x${string}` }) {
  const elig = useEligibility(address)
  if (!address) return <Panel title="Your eligibility"><Empty>Connect a wallet to see whether it can hold each bond.</Empty></Panel>
  return (
    <Panel title="Your eligibility" aside={<AddressChip address={address} />}>
      {elig.isLoading && <Loading />}
      {elig.isError && <ErrorNote error={elig.error} />}
      {elig.data && (
        <>
          <dl className="grid grid-cols-3 border-b border-border">
            <div className="stat"><dt>Hedera account</dt><dd className="text-[12px]">{elig.data.hederaAccount ?? "none yet"}</dd></div>
            <div className="stat"><dt>HBAR</dt><dd className={cx("text-[12px]", !elig.data.hbarSufficientForGas && "text-warn")}>{(Number(elig.data.hbarTinybar) / 1e8).toFixed(4)}</dd></div>
            <div className="stat"><dt>HTS tokens</dt><dd className="text-[12px]">{fmtInt(elig.data.tokens.length)}</dd></div>
          </dl>
          <table className="table">
            <thead><tr><th>Bond</th><th>KYC</th><th>Can hold</th><th>Why</th></tr></thead>
            <tbody>
              {elig.data.bonds.map((b) => (
                <tr key={b.bondId}>
                  <td className="num">#{b.bondId}</td>
                  <td><Badge tone={b.kycGranted ? "ok" : "bad"}>{b.kycGranted ? "granted" : "none"}</Badge></td>
                  <td><Badge tone={b.canHold ? "ok" : b.reason === "bond-not-active" ? "warn" : "bad"}>{b.canHold ? "yes" : "no"}</Badge></td>
                  <td className="text-muted">{REASON[b.reason] ?? b.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  )
}
