import { NavLink, useNavigate, useParams } from "react-router"
import { AddressChip, Countdown, Empty, ErrorNote, Ext, Loading, Stats, StatusBadge, Time, cx } from "../components/ui"
import { useBond, useMinCoverage } from "../hooks/data"
import { useHotkeys } from "../hooks/useHotkeys"
import { coverageBand } from "../lib/coverage"
import { countdown, fmtBps, fmtPrice, fmtUsdc, intervalName, spreadMid } from "../lib/format"
import { Collateral } from "./bond/Collateral"
import { Coupons } from "./bond/Coupons"
import { Eligibility } from "./bond/Eligibility"
import { OrderBook } from "./bond/OrderBook"
import { Risk } from "./bond/Risk"

const TABS = [
  { key: "book", label: "Order book" },
  { key: "eligibility", label: "Eligibility" },
  { key: "coupons", label: "Coupons" },
  { key: "collateral", label: "Collateral" },
  { key: "risk", label: "Risk" },
] as const
const TONE = { ok: "text-ok", warn: "text-warn", bad: "text-bad", neutral: "text-muted" }

export function BondPage() {
  const { id = "", tab = "book" } = useParams()
  const navigate = useNavigate()
  const bond = useBond(id)
  const min = useMinCoverage()
  const idx = Math.max(0, TABS.findIndex((x) => x.key === tab))
  const go = (i: number) => { const t = TABS[(i + TABS.length) % TABS.length]!; navigate(`/bonds/${id}${t.key === "book" ? "" : `/${t.key}`}`) }
  useHotkeys({ "[": () => go(idx - 1), "]": () => go(idx + 1) })
  if (!/^\d+$/.test(id)) return <Empty>Bond ids are numbers.</Empty>
  if (bond.isLoading) return <Loading />
  if (bond.isError) return <ErrorNote error={bond.error} />
  if (!bond.data) return <Empty>Bond #{id} does not exist.</Empty>
  const b = bond.data
  const t = b.terms
  const sm = spreadMid(b.bestBid, b.bestAsk)
  const band = coverageBand(b.coverageBps, min.data ?? 0n)
  return (
    <>
      <div className="panel">
        <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border">
          <h1 className="text-[22px] leading-none">{b.symbol}</h1>
          <StatusBadge status={b.status} />
          <span className="text-muted text-[12px]">bond #{b.id} · face {fmtUsdc(b.faceValue)} USDC · {fmtBps(b.couponRateBps)} paid {intervalName(b.couponInterval)} · matures <Time unix={b.maturity} /> (<Countdown unix={b.maturity} />)</span>
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span>token <AddressChip address={b.token} kind="contract" /></span>
            <span>settlement <AddressChip address={b.settlement} kind="contract" /></span>
            <span>issuer <AddressChip address={t.issuer} /></span>
            <span>decimals <span className="num text-fg">{t.bondDecimals}/{t.settlementDecimals}</span></span>
            <Ext href={b.links.token}>HashScan</Ext>
          </span>
        </div>
        <Stats
          className="border-b-0"
          cells={[
            { label: "Bid", value: fmtPrice(b.bestBid), tone: "text-bid" },
            { label: "Ask", value: fmtPrice(b.bestAsk), tone: "text-ask" },
            { label: "Spread", value: sm ? (sm.spread < 0n ? "crossed" : `${fmtPrice(sm.spread)} · ${fmtBps(sm.spreadBps)}`) : "—", title: "Best ask minus best bid, and as a fraction of the mid" },
            { label: "Mark", value: fmtPrice(b.mark), title: "Clean price plus accrued coupon, from NavOracle" },
            { label: "Yield", value: fmtBps(b.currentYieldBps), title: "face × coupon / best ask" },
            { label: "Coverage", value: b.coverageBps === null ? "feed stale" : fmtBps(b.coverageBps), tone: TONE[band.tone], title: band.sentence },
            { label: "Next coupon", value: countdown(b.nextCoupon), title: new Date(Number(b.nextCoupon) * 1000).toUTCString() },
          ]}
        />
      </div>

      <nav className="flex gap-0.5 border-b border-border overflow-x-auto items-center" aria-label="Bond sections">
        {TABS.map((x) => (
          <NavLink key={x.key} to={`/bonds/${b.id}${x.key === "book" ? "" : `/${x.key}`}`} end className={({ isActive }) => cx("px-2.5 py-1.5 text-[12px] -mb-px border-b-2 whitespace-nowrap", (isActive || (x.key === "book" && tab === "book")) ? "border-accent text-fg font-medium" : "border-transparent text-muted hover:text-fg")}>
            {x.label}
          </NavLink>
        ))}
        <span className="ml-auto text-[11px] text-muted hidden md:inline pr-1"><kbd>[</kbd> <kbd>]</kbd> switch tabs</span>
      </nav>

      {tab === "book" && <OrderBook bond={b} />}
      {tab === "eligibility" && <Eligibility bond={b} />}
      {tab === "coupons" && <Coupons bond={b} />}
      {tab === "collateral" && <Collateral bond={b} />}
      {tab === "risk" && <Risk bond={b} />}
      {!TABS.some((x) => x.key === tab) && <Empty>No such section.</Empty>}
    </>
  )
}
