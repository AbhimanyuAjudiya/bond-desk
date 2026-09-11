import { NavLink, useParams } from "react-router"
import { AddressChip, Countdown, Empty, ErrorNote, Ext, KV, Loading, StatusBadge, Time, cx } from "../components/ui"
import { useBond } from "../hooks/data"
import { fmtBps, fmtInt, fmtPrice, fmtUsdc, intervalName } from "../lib/format"
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

export function BondPage() {
  const { id = "", tab = "book" } = useParams()
  const bond = useBond(id)
  if (!/^\d+$/.test(id)) return <Empty>Bond ids are numbers.</Empty>
  if (bond.isLoading) return <Loading rows={4} />
  if (bond.isError) return <ErrorNote error={bond.error} />
  if (!bond.data) return <Empty>Bond #{id} does not exist.</Empty>
  const b = bond.data
  const t = b.terms
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-[30px] leading-none">{b.symbol}</h1>
            <StatusBadge status={b.status} />
            <span className="text-muted text-[13px]">bond #{b.id}</span>
          </div>
          <p className="note mt-1.5">
            Face {fmtUsdc(b.faceValue)} USDC · {fmtBps(b.couponRateBps)} coupon paid {intervalName(b.couponInterval)} · matures <Time unix={b.maturity} /> (<Countdown unix={b.maturity} />)
          </p>
        </div>
        <div className="grid grid-cols-3 gap-x-5 gap-y-1 text-right">
          <span className="label">Bid</span><span className="label">Ask</span><span className="label">Mark</span>
          <span className="num text-[18px] text-bid">{fmtPrice(b.bestBid)}</span>
          <span className="num text-[18px] text-ask">{fmtPrice(b.bestAsk)}</span>
          <span className="num text-[18px]" title="Clean price plus accrued coupon, from NavOracle">{fmtPrice(b.mark)}</span>
        </div>
      </div>

      <div className="panel p-4 grid gap-x-8 gap-y-2 md:grid-cols-2">
        <KV rows={[
          ["Bond token (ATS)", <AddressChip address={b.token} kind="contract" />],
          ["Settlement", <AddressChip address={b.settlement} kind="contract" />],
          ["Issuer", <AddressChip address={t.issuer} />],
          ["Decimals", `${t.bondDecimals} bond / ${t.settlementDecimals} settlement`],
        ]} />
        <KV rows={[
          ["Next coupon", <><Time unix={b.nextCoupon} /> <span className="text-muted">(<Countdown unix={b.nextCoupon} />)</span></>],
          ["Current yield", <span title="face × coupon / best ask">{fmtBps(b.currentYieldBps)}</span>],
          ["Coverage", b.coverageBps === null ? "feed stale" : fmtBps(b.coverageBps)],
          ["Explorer", <Ext href={b.links.token}>token on HashScan</Ext>],
        ]} />
      </div>

      <nav className="flex gap-1 border-b border-border overflow-x-auto" aria-label="Bond sections">
        {TABS.map((x) => (
          <NavLink key={x.key} to={`/bonds/${b.id}${x.key === "book" ? "" : `/${x.key}`}`} end className={({ isActive }) => cx("px-3 py-2 text-[13px] -mb-px border-b-2 whitespace-nowrap", (isActive || (x.key === "book" && tab === "book")) ? "border-accent text-fg font-medium" : "border-transparent text-muted hover:text-fg")}>
            {x.label}
          </NavLink>
        ))}
      </nav>

      {tab === "book" && <OrderBook bond={b} />}
      {tab === "eligibility" && <Eligibility bond={b} />}
      {tab === "coupons" && <Coupons bond={b} />}
      {tab === "collateral" && <Collateral bond={b} />}
      {tab === "risk" && <Risk bond={b} />}
      {!TABS.some((x) => x.key === tab) && <Empty>No such section. {fmtInt(0)}</Empty>}
    </>
  )
}
