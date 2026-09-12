import { Fragment, useState, type ReactNode } from "react"
import { useAccount, useReadContract } from "wagmi"
import { erc20Abi, marketAbi, tokenAbi } from "../../config/abi"
import { DEP } from "../../config/deployments"
import { AddressChip, Badge, Button, ConfirmButton, Countdown, Empty, ErrorNote, Field, Input, Loading, Note, Panel, Refreshed, Time, TxLink, cx } from "../../components/ui"
import { useOrderbook, useWalletFunds } from "../../hooks/data"
import { useTx } from "../../hooks/useTx"
import type { Bond, Order } from "../../lib/api"
import { buyerTotal, fmtBps, fmtInt, fmtPrice, fmtUsdc, orderCost, parseAmount, parseUsdc, sameAddress, spreadMid } from "../../lib/format"

type Fill = { orderId: string; side: "buy" | "sell" }

export function OrderBook({ bond }: { bond: Bond }) {
  const book = useOrderbook(bond.id)
  const { address } = useAccount()
  const funds = useWalletFunds(bond.token, bond.settlement)
  const fee = useReadContract({ abi: marketAbi, address: DEP.market, functionName: "feeBps", query: { staleTime: 300_000 } })
  const feeBps = Number(fee.data ?? 0)
  const [filling, setFilling] = useState<Fill | null>(null)
  const tx = useTx()
  const [busy, setBusy] = useState<string | null>(null)
  const cancel = async (o: Order) => {
    setBusy(`cancel-${o.orderId}`)
    try { await tx({ title: `Cancel order #${o.orderId}`, summary: `Remove your order #${o.orderId} (${fmtInt(o.amount)} ${bond.symbol} at ${fmtPrice(o.price)} USDC) from the book.`, abi: marketAbi, address: DEP.market, functionName: "cancel", args: [BigInt(o.orderId)] }) } finally { setBusy(null) }
  }
  const active = bond.status === "Active"
  // best first on both sides, whatever order the API used
  const bids = [...(book.data?.bids ?? [])].sort((a, b) => (BigInt(b.price) > BigInt(a.price) ? 1 : -1))
  const asks = [...(book.data?.asks ?? [])].sort((a, b) => (BigInt(a.price) > BigInt(b.price) ? 1 : -1))
  const sm = book.data ? spreadMid(book.data.bestBid, book.data.bestAsk) : null
  const mine = (o: Order) => sameAddress(o.maker, address)
  const myCount = bids.filter(mine).length + asks.filter(mine).length
  const dec = bond.terms.bondDecimals

  // One ladder: asks from the dearest down to the best ask, the spread, then bids from the best down. Side is written
  // out as well as coloured.
  const row = (o: Order, isAsk: boolean): ReactNode => {
    const me = mine(o)
    const open = filling?.orderId === o.orderId
    return (
      <Fragment key={o.orderId}>
        <tr className={cx(me && "bg-accent-soft/40", open && "bg-surface-2")}>
          <td className={cx("text-[11px] uppercase tracking-[0.06em] font-medium", isAsk ? "text-ask" : "text-bid")}>{isAsk ? "ask" : "bid"}</td>
          <td className={cx("num text-right font-medium", isAsk ? "text-ask" : "text-bid")}>{fmtPrice(o.price)}</td>
          <td className="num text-right">{fmtInt(o.amount)}</td>
          <td className="num text-right">{fmtUsdc(orderCost(BigInt(o.amount), BigInt(o.price), dec))}</td>
          <td className="whitespace-nowrap"><AddressChip address={o.maker} me={me} /></td>
          <td className="whitespace-nowrap">{o.expiry === "0" ? <span className="text-muted">GTC</span> : <Countdown unix={o.expiry} />}</td>
          <td className="text-right whitespace-nowrap">
            {me ? (
              <ConfirmButton size="sm" variant="danger" confirm={`Cancel order #${o.orderId}: ${fmtInt(o.amount)} ${bond.symbol} at ${fmtPrice(o.price)} USDC comes off the book.`} busy={busy === `cancel-${o.orderId}`} onConfirm={() => cancel(o)}>Cancel</ConfirmButton>
            ) : open ? (
              <Button size="sm" onClick={() => setFilling(null)} aria-expanded="true">Close</Button>
            ) : (
              <Button size="sm" disabled={!address || !active} onClick={() => setFilling({ orderId: o.orderId, side: isAsk ? "buy" : "sell" })} aria-expanded="false">{isAsk ? "Buy" : "Sell"}</Button>
            )}
          </td>
        </tr>
        {open && filling && (
          <tr className="bg-surface-2">
            <td colSpan={7} className="p-0">
              {/* the form stays under the row it came from; on a phone it pins to the visible left edge of the scrolling table */}
              <div className="sticky left-0 max-w-[calc(100vw-2rem-2px)]">
                <FillForm bond={bond} order={o} side={filling.side} feeBps={feeBps} funds={funds} onClose={() => setFilling(null)} />
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    )
  }
  const gap = (text: string) => <tr><td colSpan={7} className="text-muted text-[12px] py-2">{text}</td></tr>
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
      <div className="flex flex-col gap-5 min-w-0">
        {!active && <Note className="panel p-3 text-warn">Bond is {bond.status}: orders can be cancelled but not placed or filled until it is Active again.</Note>}
        <Panel title="Order book" aside={<><span className="hidden sm:inline">fee {fmtBps(feeBps)} paid by the buyer{address ? ` · ${myCount} of these are yours` : ""}</span><Refreshed at={book.dataUpdatedAt} /></>}>
          {book.isLoading && <Loading />}
          {book.isError && <ErrorNote error={book.error} />}
          {book.data && (
            <>
              <dl className="grid grid-cols-3 sm:grid-cols-5 border-b border-border">
                <Quote label="Best bid" value={fmtPrice(book.data.bestBid)} tone="text-bid" />
                <Quote label="Best ask" value={fmtPrice(book.data.bestAsk)} tone="text-ask" />
                <Quote label="Spread" value={sm ? (sm.spread < 0n ? "crossed" : `${fmtPrice(sm.spread)} · ${fmtBps(sm.spreadBps)}`) : "—"} />
                <Quote label="Mid" value={sm ? fmtPrice(sm.mid) : "—"} />
                <Quote label="Mark" value={fmtPrice(bond.mark)} />
              </dl>
              <div className="scroll-x">
                <table className="table">
                  <thead><tr><th>Side</th><th className="text-right">Price</th><th className="text-right">Amount</th><th className="text-right">Total</th><th>Maker</th><th>Expires</th><th></th></tr></thead>
                  <tbody>
                    {asks.length === 0 ? gap("No asks on the book.") : [...asks].reverse().map((o) => row(o, true))}
                    <tr className="bg-surface-2">
                      <td colSpan={7} className="num text-[12px] text-muted py-1.5">
                        {sm ? (sm.spread < 0n ? "crossed book: the best bid is above the best ask" : `spread ${fmtPrice(sm.spread)} USDC (${fmtBps(sm.spreadBps)}) · mid ${fmtPrice(sm.mid)} · ${asks.length} ask${asks.length === 1 ? "" : "s"} above, ${bids.length} bid${bids.length === 1 ? "" : "s"} below`) : `no spread: ${bids.length === 0 ? "no bids" : "no asks"} on the book`}
                      </td>
                    </tr>
                    {bids.length === 0 ? gap("No bids on the book.") : bids.map((o) => row(o, false))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
        <Panel title="Recent fills">
          {book.isLoading && <Loading />}
          {book.data && book.data.trades.length === 0 && <Empty>No fills yet.</Empty>}
          {book.data && book.data.trades.length > 0 && (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>When</th><th className="text-right">Amount</th><th className="text-right">Price</th><th>Maker</th><th>Taker</th><th>Tx</th></tr></thead>
                <tbody>
                  {book.data.trades.map((t) => (
                    <tr key={t.txHash + t.orderId}>
                      <td className="whitespace-nowrap"><Time unix={t.timestamp} /></td>
                      <td className="num text-right">{fmtInt(t.amount)}</td>
                      <td className="num text-right">{fmtPrice(t.price)}</td>
                      <td className="whitespace-nowrap"><AddressChip address={t.maker} me={sameAddress(t.maker, address)} /></td>
                      <td className="whitespace-nowrap"><AddressChip address={t.taker} me={sameAddress(t.taker, address)} /></td>
                      <td><TxLink hash={t.txHash} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <PlaceOrder bond={bond} feeBps={feeBps} funds={funds} active={active} />
    </div>
  )
}

const Quote = ({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) => (
  <div className="px-3 py-2 min-w-0 border-r border-border last:border-r-0">
    <dt className="label truncate">{label}</dt>
    <dd className={cx("num text-[15px] leading-tight mt-0.5 truncate", tone)}>{value}</dd>
  </div>
)

type Funds = ReturnType<typeof useWalletFunds>

/** Approve exactly what the next step needs (or unlimited), then the step itself. */
function ApproveThen({ bond, need, kind, funds, children, unlimited, setUnlimited }: { bond: Bond; need: bigint; kind: "usdc" | "bond"; funds: Funds; children: ReactNode; unlimited: boolean; setUnlimited: (v: boolean) => void }) {
  const tx = useTx()
  const [busy, setBusy] = useState(false)
  const have = kind === "usdc" ? funds.usdcAllowance : funds.bondAllowance
  const balance = kind === "usdc" ? funds.usdc : funds.bonds
  const label = kind === "usdc" ? `${fmtUsdc(need)} USDC` : `${fmtInt(need)} ${bond.symbol}`
  const short = have < need
  const approve = async () => {
    setBusy(true)
    try {
      const amount = unlimited ? 2n ** 256n - 1n : need
      await tx({ title: `Approve ${kind === "usdc" ? "USDC" : bond.symbol}`, summary: `Allow the market to move ${unlimited ? "any amount of" : label} ${kind === "usdc" ? "USDC" : bond.symbol} from your wallet when your order fills.`, abi: kind === "usdc" ? erc20Abi : tokenAbi, address: kind === "usdc" ? bond.settlement : bond.token, functionName: "approve", args: [DEP.market, amount] })
      await funds.refetch()
    } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-2">
      {balance < need && <Note className="text-warn">Your balance is {kind === "usdc" ? `${fmtUsdc(balance)} USDC` : `${fmtInt(balance)} ${bond.symbol}`}, less than {label}: the fill would revert.</Note>}
      {short ? (
        <>
          <Note>Step 1 · the market holds <span className="num">{kind === "usdc" ? fmtUsdc(have) + " USDC" : fmtInt(have) + " " + bond.symbol}</span> of allowance; it needs {label}.</Note>
          <label className="flex items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} /> approve unlimited instead, so later orders skip this step</label>
          <div><Button variant="primary" busy={busy} onClick={approve}>Approve {unlimited ? "unlimited" : label}</Button></div>
        </>
      ) : children}
    </div>
  )
}

/** Sits directly under the order row it was opened from. */
function FillForm({ bond, order, side, feeBps, funds, onClose }: { bond: Bond; order: Order; side: "buy" | "sell"; feeBps: number; funds: Funds; onClose: () => void }) {
  const tx = useTx()
  const [amount, setAmount] = useState(order.amount)
  const [unlimited, setUnlimited] = useState(false)
  const [busy, setBusy] = useState(false)
  let parsed: bigint | null = null, err: string | null = null
  try { parsed = parseAmount(amount, bond.terms.bondDecimals); if (parsed > BigInt(order.amount)) err = `The order only has ${fmtInt(order.amount)} left.` } catch (e) { err = (e as Error).message }
  const amt = parsed ?? 0n
  const { cost, fee, total } = buyerTotal(amt, BigInt(order.price), bond.terms.bondDecimals, feeBps)
  const summary = side === "buy"
    ? `Buy ${fmtInt(amt)} ${bond.symbol} from ${order.maker.slice(0, 8)}… at ${fmtPrice(order.price)} USDC: ${fmtUsdc(cost)} USDC + ${fmtUsdc(fee)} USDC fee = ${fmtUsdc(total)} USDC.`
    : `Sell ${fmtInt(amt)} ${bond.symbol} to ${order.maker.slice(0, 8)}… at ${fmtPrice(order.price)} USDC and receive ${fmtUsdc(cost)} USDC (the buyer pays the fee).`
  const fill = async () => {
    setBusy(true)
    try {
      const r = await tx({ title: `Fill order #${order.orderId}`, summary, abi: marketAbi, address: DEP.market, functionName: "fill", args: [BigInt(order.orderId), amt] })
      if (r?.status === "success") onClose()
    } finally { setBusy(false) }
  }
  return (
    <div className="px-3 py-3 border-t border-border grid gap-4 md:grid-cols-[180px_1fr] text-[13px]" role="region" aria-label={`${side === "buy" ? "Buy from" : "Sell into"} order #${order.orderId}`}>
      <Field label={`${side === "buy" ? "Buy" : "Sell"} amount (${bond.symbol})`} htmlFor="fill-amount" hint={err ? <span className="text-bad">{err}</span> : `up to ${fmtInt(order.amount)} on order #${order.orderId}`}>
        <Input id="fill-amount" className="num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <div className="flex flex-col gap-2 min-w-0">
        <p className="leading-relaxed">{err ? "Fix the amount to see what this will do." : summary}</p>
        <Note>The token's compliance check runs first, as a dry run: a wallet without KYC gets the decoded refusal, nothing is signed.</Note>
        {!err && (
          <ApproveThen bond={bond} need={side === "buy" ? total : amt} kind={side === "buy" ? "usdc" : "bond"} funds={funds} unlimited={unlimited} setUnlimited={setUnlimited}>
            <div><Button variant="primary" busy={busy} onClick={fill}>{side === "buy" ? `Buy ${fmtInt(amt)} for ${fmtUsdc(total)} USDC` : `Sell ${fmtInt(amt)} for ${fmtUsdc(cost)} USDC`}</Button></div>
          </ApproveThen>
        )}
      </div>
    </div>
  )
}

const EXPIRIES: [string, number][] = [["Good till cancelled", 0], ["1 hour", 3600], ["1 day", 86_400], ["7 days", 604_800], ["30 days", 2_592_000]]

function PlaceOrder({ bond, feeBps, funds, active }: { bond: Bond; feeBps: number; funds: Funds; active: boolean }) {
  const { address } = useAccount()
  const tx = useTx()
  const [isSell, setIsSell] = useState(false)
  const [amount, setAmount] = useState("")
  const [price, setPrice] = useState(bond.bestAsk !== "0" ? fmtPrice(bond.bestAsk).replace(/,/g, "") : "0.99")
  const [expiry, setExpiry] = useState(604_800)
  const [unlimited, setUnlimited] = useState(false)
  const [busy, setBusy] = useState(false)
  let amt = 0n, px = 0n, err: string | null = null
  try { amt = amount ? parseAmount(amount, bond.terms.bondDecimals) : 0n } catch (e) { err = (e as Error).message }
  try { px = price ? parseUsdc(price) : 0n; if (price && px <= 0n) err = "Price must be positive" } catch { err = "Price must be a number of USDC" }
  const ready = !err && amt > 0n && px > 0n
  const { cost, fee, total } = buyerTotal(amt, px, bond.terms.bondDecimals, feeBps)
  const expiresAt = expiry === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) + expiry)
  const summary = !ready ? "" : isSell
    ? `Place an ask to sell ${fmtInt(amt)} ${bond.symbol} at ${fmtPrice(px)} USDC (${fmtUsdc(cost)} USDC if fully filled), ${expiry === 0 ? "good till cancelled" : `expiring in ${EXPIRIES.find((x) => x[1] === expiry)?.[0]}`}.`
    : `Place a bid to buy ${fmtInt(amt)} ${bond.symbol} at ${fmtPrice(px)} USDC: ${fmtUsdc(cost)} USDC + ${fmtUsdc(fee)} USDC fee = ${fmtUsdc(total)} USDC when filled, ${expiry === 0 ? "good till cancelled" : `expiring in ${EXPIRIES.find((x) => x[1] === expiry)?.[0]}`}.`
  const place = async () => {
    setBusy(true)
    try {
      const r = await tx({ title: `Place ${isSell ? "ask" : "bid"}`, summary, abi: marketAbi, address: DEP.market, functionName: "place", args: [BigInt(bond.id), isSell, amt, px, expiresAt] })
      if (r?.status === "success") setAmount("")
    } finally { setBusy(false) }
  }
  return (
    <Panel title="Place an order" aside={<span>limit order</span>}>
      <div className="p-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 rounded border border-border-strong overflow-hidden text-[13px]" role="radiogroup" aria-label="Side">
          <button type="button" role="radio" aria-checked={!isSell} className={cx("py-1.5", !isSell ? "bg-bid text-white font-medium" : "text-muted hover:bg-surface-2")} onClick={() => setIsSell(false)}>Buy · bid</button>
          <button type="button" role="radio" aria-checked={isSell} className={cx("py-1.5", isSell ? "bg-ask text-white font-medium" : "text-muted hover:bg-surface-2")} onClick={() => setIsSell(true)}>Sell · ask</button>
        </div>
        <Field label={`Amount (${bond.symbol})`} htmlFor="amount" hint={funds.loaded ? `you hold ${fmtInt(funds.bonds)} ${bond.symbol} · ${fmtUsdc(funds.usdc)} USDC` : undefined}>
          <Input id="amount" className="num" inputMode="numeric" placeholder="10" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Price (USDC per bond)" htmlFor="price" hint={`mark ${fmtPrice(bond.mark)} · face ${fmtUsdc(bond.faceValue)}`}>
          <Input id="price" className="num" inputMode="decimal" placeholder="0.99" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Expiry" htmlFor="expiry">
          <select id="expiry" className="input" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
            {EXPIRIES.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {err && <Note className="text-bad">{err}</Note>}
        {ready && <p className="text-[13px] leading-relaxed">{summary}</p>}
        {!address && <Note>Connect a wallet to place orders.</Note>}
        {address && !active && <Note className="text-warn">The bond is {bond.status}; the market rejects new orders (BondNotActive).</Note>}
        {address && active && ready && (
          <ApproveThen bond={bond} need={isSell ? amt : total} kind={isSell ? "bond" : "usdc"} funds={funds} unlimited={unlimited} setUnlimited={setUnlimited}>
            <div><Button variant="primary" busy={busy} onClick={place}>Place {isSell ? "ask" : "bid"}</Button></div>
          </ApproveThen>
        )}
        <Note>Allowances are only used when the order fills: a bid needs USDC approved to the market, an ask needs {bond.symbol} approved. <Badge tone="neutral">maker</Badge> pays no fee; the buyer pays {fmtBps(feeBps)} on top.</Note>
      </div>
    </Panel>
  )
}
