import { useState } from "react"
import { Link } from "react-router"
import { useAccount } from "wagmi"
import { SelfService } from "../components/SelfService"
import { AddressChip, Badge, Countdown, Empty, ErrorNote, Ext, Loading, Note, Panel, Refreshed, StatusBadge, Time, cx } from "../components/ui"
import { useBonds, useEligibility, useMinCoverage, useOrderbooks } from "../hooks/data"
import { coverageBand } from "../lib/coverage"
import { fmtBps, fmtInt, fmtPrice } from "../lib/format"

export function Desk() {
  const bonds = useBonds()
  const min = useMinCoverage()
  const { address } = useAccount()
  const [byYield, setByYield] = useState(false)
  const list = bonds.data?.bonds ?? []
  const books = useOrderbooks(list.map((b) => b.id))
  const depth = new Map(list.map((b, i) => [b.id, books[i]?.data]))
  const rows = byYield ? [...list].sort((a, b) => Number(b.currentYieldBps) - Number(a.currentYieldBps)) : list
  return (
    <>
      <div>
        <h1 className="text-[30px] leading-none">Desk</h1>
        <p className="note mt-1.5 max-w-[70ch]">
          ATS-issued bonds on Hedera with an on-chain order book. Every fill is checked by the token's own compliance rules first; collateral is HBAR marked by a Chainlink feed and watched by an enclave that can freeze trading.
        </p>
      </div>

      <Panel title="Bonds" aside={<Refreshed at={bonds.dataUpdatedAt} />}>
        {bonds.isLoading && <Loading />}
        {bonds.isError && <ErrorNote error={bonds.error} />}
        {bonds.data && list.length === 0 && <Empty>No bonds are registered yet.</Empty>}
        {list.length > 0 && (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Bond</th>
                  <th>Status</th>
                  <th className="text-right">Coupon</th>
                  <th>Maturity</th>
                  <th className="text-right">Bid</th>
                  <th className="text-right">Ask</th>
                  <th className="text-right" title="Open bids · open asks">Depth</th>
                  <th className="text-right" aria-sort={byYield ? "descending" : "none"}>
                    <button type="button" onClick={() => setByYield((v) => !v)} title={byYield ? "Back to registry order" : "Sort by current yield, highest first"}>Yield{byYield ? " ↓" : ""}</button>
                  </th>
                  <th>Coverage</th>
                  <th>Next coupon</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const band = coverageBand(b.coverageBps, min.data ?? 0n)
                  const d = depth.get(b.id)
                  return (
                    <tr key={b.id} className="hover:bg-surface-2">
                      <td className="whitespace-nowrap">
                        <Link to={`/bonds/${b.id}`} className="font-semibold link decoration-transparent hover:decoration-current">{b.symbol}</Link>
                        <span className="text-muted text-[12px] ml-1.5 num">#{b.id}</span>
                      </td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="num text-right">{fmtBps(b.couponRateBps)}</td>
                      <td><Time unix={b.maturity} className="whitespace-nowrap" /></td>
                      <td className="num text-right text-bid">{fmtPrice(b.bestBid)}</td>
                      <td className="num text-right text-ask">{fmtPrice(b.bestAsk)}</td>
                      <td className={cx("num text-right whitespace-nowrap", d && d.bids.length + d.asks.length === 0 && "text-faint")} title={d ? `${d.bids.length} bids, ${d.asks.length} asks` : "loading the book"}>
                        {d ? `${d.bids.length} · ${d.asks.length}` : "…"}
                      </td>
                      <td className="num text-right" title="face × coupon / best ask">{fmtBps(b.currentYieldBps)}</td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="num">{b.coverageBps === null ? "—" : fmtBps(b.coverageBps)}</span>
                          <Badge tone={band.tone} title={band.sentence}>{band.label}</Badge>
                        </span>
                      </td>
                      <td className="whitespace-nowrap"><Countdown unix={b.nextCoupon} /></td>
                      <td className="text-right whitespace-nowrap"><Ext href={b.links.token} className="text-[12px]">HashScan</Ext></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <EligibilityStrip address={address} />
      <SelfService />
    </>
  )
}

function EligibilityStrip({ address }: { address?: `0x${string}` }) {
  const elig = useEligibility(address)
  if (!address) return <Panel title="Your eligibility"><Empty>Connect a wallet to see whether it can hold each bond.</Empty></Panel>
  return (
    <Panel title="Your eligibility" aside={<AddressChip address={address} />}>
      {elig.isLoading && <Loading />}
      {elig.isError && <ErrorNote error={elig.error} />}
      {elig.data && (
        <div className="p-4 grid gap-3 md:grid-cols-[auto_1fr] text-[13px]">
          <div className="flex flex-col gap-1 min-w-[220px]">
            <div><span className="label">Hedera account</span> <span className="num ml-2">{elig.data.hederaAccount ?? "none yet"}</span></div>
            <div><span className="label">HBAR</span> <span className="num ml-2">{(Number(elig.data.hbarTinybar) / 1e8).toFixed(4)}</span> {!elig.data.hbarSufficientForGas && <span className="text-warn">(low for gas)</span>}</div>
            <div><span className="label">HTS tokens</span> <span className="num ml-2">{fmtInt(elig.data.tokens.length)}</span></div>
          </div>
          <ul className="flex flex-col gap-1.5">
            {elig.data.bonds.map((b) => (
              <li key={b.bondId} className="flex flex-wrap items-center gap-2">
                <Badge tone={b.canHold ? "ok" : b.reason === "bond-not-active" ? "warn" : "bad"}>{b.canHold ? "eligible" : "not eligible"}</Badge>
                <span>
                  {b.reason === "kyc-granted" && <>This wallet has KYC on bond #{b.bondId}'s token and the bond is Active: it can buy, hold and sell.</>}
                  {b.reason === "no-kyc" && <>Bond #{b.bondId}'s token has not granted KYC to this wallet, so it will refuse any transfer to or from it. Request testnet KYC below.</>}
                  {b.reason === "no-hedera-account" && <>This address has never received HBAR, so it does not exist as a Hedera account yet. Use the faucet first.</>}
                  {b.reason === "bond-not-active" && <>KYC is granted, but bond #{b.bondId} is not Active right now, so fills are refused until it is.</>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!elig.isLoading && !elig.data && !elig.isError && <Note className="p-4">No eligibility data.</Note>}
    </Panel>
  )
}
