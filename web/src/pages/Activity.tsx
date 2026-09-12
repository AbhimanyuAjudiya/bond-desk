import { useState, type ReactNode } from "react"
import { useAccount } from "wagmi"
import { ActionBadge, AddressChip, Badge, Empty, ErrorNote, Input, Loading, Panel, Refreshed, StatusBadge, Time, TxLink, cx } from "../components/ui"
import { useEvents } from "../hooks/data"
import type { DeskEvent } from "../lib/api"
import { actionName, fmtHbar, fmtInt, fmtPrice, fmtTime, fmtUsdc, sameAddress, statusName } from "../lib/format"

const CONTRACTS = ["All", "BondMarket", "BondLifecycle", "RiskGate", "CollateralVault", "BondRegistry", "BondToken"]

export function Activity() {
  const ev = useEvents(200)
  const [filter, setFilter] = useState("All")
  const [q, setQ] = useState("")
  const [onlyMine, setOnlyMine] = useState(false)
  const { address } = useAccount()
  const needle = q.trim().toLowerCase()
  const rows = (ev.data?.events ?? []).filter((e) =>
    (filter === "All" || e.contract === filter)
    && (!onlyMine || involves(e, address))
    && (!needle || e.name.toLowerCase().includes(needle) || e.txHash.toLowerCase().includes(needle) || Object.values(e.args).some((v) => String(v).toLowerCase().includes(needle))))
  return (
    <Panel
      title="Activity"
      aside={
        <>
          <div className="flex flex-wrap gap-0.5" role="group" aria-label="Filter by contract">
            {CONTRACTS.map((c) => (
              <button key={c} type="button" aria-pressed={filter === c} className={cx("px-1.5 py-0.5 rounded-sm text-[11px]", filter === c ? "bg-surface-3 text-fg font-medium" : "text-muted hover:text-fg")} onClick={() => setFilter(c)}>{c}</button>
            ))}
          </div>
          {address && <label className="flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> mine</label>}
          <Input className="w-[180px] h-6 text-[11px]" placeholder="filter: name, address, hash" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter events" />
          <Refreshed at={ev.dataUpdatedAt} />
        </>
      }
    >
      {ev.isLoading && <Loading />}
      {ev.isError && <ErrorNote error={ev.error} />}
      {ev.data && rows.length === 0 && <Empty>{filter === "All" && !needle && !onlyMine ? "No events yet." : `Nothing matches in the last ${ev.data.events.length} events.`}</Empty>}
      {rows.length > 0 && (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>When</th><th>Contract</th><th>Event</th><th>What happened</th><th>Tx</th></tr></thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={`${e.txHash}-${i}`} className={cx(involves(e, address) && "bg-accent-soft/40")}>
                  <td className="whitespace-nowrap align-top"><Time unix={e.timestamp} /></td>
                  <td className="whitespace-nowrap text-muted align-top">{e.contract}</td>
                  <td className="whitespace-nowrap align-top num text-[11px]">{e.name}</td>
                  <td className="min-w-[320px] align-top"><Sentence e={e} me={address} /></td>
                  <td className="whitespace-nowrap align-top"><TxLink hash={e.txHash} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note px-3 py-1.5 border-t border-border">Decoded from the Hedera mirror node, newest first; rows that involve your wallet are tinted.</p>
    </Panel>
  )
}

const involves = (e: DeskEvent, me?: string) => !!me && Object.values(e.args).some((v) => typeof v === "string" && sameAddress(v, me))
const A = ({ a, me }: { a: unknown; me?: string }) => <AddressChip address={String(a)} me={sameAddress(String(a), me)} />
const N = ({ children }: { children: ReactNode }) => <span className="num">{children}</span>

/** One full sentence per event, with the raw name as a fallback. */
export function Sentence({ e, me }: { e: DeskEvent; me?: string }): ReactNode {
  const a = e.args
  const s = (v: unknown) => String(v)
  switch (e.name) {
    case "OrderPlaced":
      return <><A a={a.maker} me={me} /> placed {a.isSell ? "an ask" : "a bid"} for <N>{fmtInt(s(a.amount))}</N> bonds at <N>{fmtPrice(s(a.price))} USDC</N> (order #{s(a.orderId)}, bond #{s(a.bondId)}{s(a.expiry) === "0" ? ", good till cancelled" : `, expires ${fmtTime(s(a.expiry)).local}`}).</>
    case "OrderCancelled":
      return <>Order #{s(a.orderId)} was cancelled by its maker.</>
    case "Filled":
      return <><A a={a.taker} me={me} /> filled <N>{fmtInt(s(a.amount))}</N> bonds of order #{s(a.orderId)} at <N>{fmtPrice(s(a.price))} USDC</N> from <A a={a.maker} me={me} /> (cost <N>{fmtUsdc(s(a.cost))}</N>, fee <N>{fmtUsdc(s(a.fee))}</N> USDC).</>
    case "Funded":
      return <><A a={a.from} me={me} /> funded bond #{s(a.bondId)}'s pool with <N>{fmtUsdc(s(a.amount))} USDC</N>.</>
    case "CouponPaid":
      return <>Coupon #{s(a.couponId)} of bond #{s(a.bondId)} was paid: <N>{fmtUsdc(s(a.amount))} USDC</N> reserved against snapshot {s(a.snapshotId)}; next coupon {fmtTime(s(a.nextCoupon)).local}.</>
    case "CouponClaimed":
      return <><A a={a.holder} me={me} /> claimed <N>{fmtUsdc(s(a.amount))} USDC</N> from coupon #{s(a.couponId)} of bond #{s(a.bondId)}.</>
    case "CouponScheduled":
      return <>The next coupon run of bond #{s(a.bondId)} is scheduled for {fmtTime(s(a.when)).local} through the Hedera Schedule Service (<A a={a.schedule} />).</>
    case "ScheduleFailed":
      return <>Scheduling the next coupon of bond #{s(a.bondId)} failed with Hedera response code {s(a.rc)}; anyone can retry with schedule().</>
    case "ScheduleSkipped":
      return <>Scheduling was skipped for bond #{s(a.bondId)}: {fmtTime(s(a.when)).local} is further ahead than the Schedule Service allows.</>
    case "Redeemed":
      return <><A a={a.holder} me={me} /> redeemed <N>{fmtInt(s(a.tokens))}</N> bonds of bond #{s(a.bondId)} for <N>{fmtUsdc(s(a.principal))} USDC</N> of principal.</>
    case "HbarWithdrawn":
      return <>The admin withdrew <N>{fmtHbar(s(a.amount))} HBAR</N> from the lifecycle payer float to <A a={a.to} me={me} />.</>
    case "Deposited":
      return <><A a={a.from} me={me} /> deposited <N>{fmtHbar(s(a.amount))} HBAR</N> of collateral for bond #{s(a.bondId)}.</>
    case "Withdrawn":
      return <><A a={a.to} me={me} /> withdrew <N>{fmtHbar(s(a.amount))} HBAR</N> of collateral from bond #{s(a.bondId)}.</>
    case "Seized":
      return <>Collateral of bond #{s(a.bondId)} was seized after a DEFAULT verdict: <N>{fmtHbar(s(a.amount))} HBAR</N> locked for holders at snapshot {s(a.snapshotId)}.</>
    case "SeizedClaimed":
      return <><A a={a.holder} me={me} /> claimed <N>{fmtHbar(s(a.amount))} HBAR</N> of seized collateral from bond #{s(a.bondId)}.</>
    case "MinCoverageSet":
      return <>The vault's minimum coverage was set to {Number(a.bps) / 100}%.</>
    case "VerdictApplied":
      return <>Verdict <ActionBadge action={actionName(s(a.action))} /> applied to bond #{s(a.bondId)} with observed coverage {(Number(a.coverageObserved) / 100).toFixed(2)}% (nonce {s(a.nonce)}), relayed by <A a={a.relayer} me={me} />.</>
    case "Unfrozen":
      return <>Bond #{s(a.bondId)} was unfrozen by the desk admin; trading is open again.</>
    case "SignerSet":
      return <>RiskGate's trusted verdict signer was set to <A a={a.signer} />.</>
    case "FreshnessSet":
      return <>RiskGate now accepts verdicts up to {s(a.freshness)} s old.</>
    case "StatusChanged":
      return <>Bond #{s(a.bondId)} went from <StatusBadge status={statusName(s(a.from))} /> to <StatusBadge status={statusName(s(a.to))} />.</>
    case "NextCouponSet":
      return <>Bond #{s(a.bondId)}'s next coupon date was set to {fmtTime(s(a.nextCoupon)).local}.</>
    case "BondRegistered":
      return <>Bond #{s(a.bondId)} was registered by <A a={a.issuer} me={me} /> with token <A a={a.token} /> settled in <A a={a.settlement} />.</>
    case "RoleGranted":
      return <>Registry role <span className="font-mono text-[11px]">{s(a.role).slice(0, 10)}…</span> granted to <A a={a.account} me={me} />.</>
    case "RoleRevoked":
      return <>Registry role <span className="font-mono text-[11px]">{s(a.role).slice(0, 10)}…</span> revoked from <A a={a.account} me={me} />.</>
    case "KycGranted":
      return <><Badge tone="ok">KYC</Badge> granted to <A a={a.account} me={me} /> on <A a={e.address} /> by <A a={a.operator} me={me} />.</>
    case "KycRevoked":
      return <><Badge tone="bad">KYC</Badge> revoked for <A a={a.account} me={me} /> on <A a={e.address} /> by <A a={a.operator} me={me} />.</>
    case "BandSet":
      return <>Price band for bond #{s(a.bondId)} set to {Number(a.bps) / 100}% around the oracle mark.</>
    case "FeeSet":
      return <>Market fee set to {Number(a.bps) / 100}% paid to <A a={a.treasury} />.</>
    default:
      return <>{e.name}({Object.entries(a).map(([k, v]) => `${k}: ${String(v)}`).join(", ")})</>
  }
}
