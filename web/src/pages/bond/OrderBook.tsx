import { Fragment, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react"
import { useAccount, useReadContract } from "wagmi"
import { erc20Abi, marketAbi, tokenAbi } from "../../config/abi"
import { DEP } from "../../config/deployments"
import { AddressChip, Badge, Button, ConfirmButton, Countdown, Empty, ErrorNote, Field, Input, Loading, Note, Panel, Refreshed, Stats, Time, TxLink, cx } from "../../components/ui"
import { useOrderbook, useWalletFunds } from "../../hooks/data"
import { useTx } from "../../hooks/useTx"
import type { Bond, Order } from "../../lib/api"
import { buyerTotal, fmtBps, fmtInt, fmtPrice, fmtUsdc, orderCost, parseAmount, parseUsdc, sameAddress, spreadMid } from "../../lib/format"

type Fill = { orderId: string; side: "buy" | "sell" }

/** Cumulative size from the best price outward, as a fraction of the side's total: the bar behind each row. */
const cumulative = (orders: Order[]) => {
  const total = orders.reduce((s, o) => s + BigInt(o.amount), 0n)
  let run = 0n
  return orders.map((o) => { run += BigInt(o.amount); return { o, cum: run, frac: total === 0n ? 0 : Number((run * 1000n) / total) / 1000 } })
}

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
  const askRows = cumulative(asks)
  const bidRows = cumulative(bids)

  // One ladder: asks from the dearest down to the best ask, the spread, then bids from the best down. The bar behind a
  // row is the cumulative size from the best price out to that row.
  const row = ({ o, cum, frac }: { o: Order; cum: bigint; frac: number }, isAsk: boolean): ReactNode => {
    const me = mine(o)
    const open = filling?.orderId === o.orderId
    return (
      <Fragment key={o.orderId}>
        <tr className={cx("depth", me && "bg-accent-soft/40", open && "bg-surface-2")} style={{ "--depth": frac, "--depth-color": isAsk ? "var(--ask-soft)" : "var(--bid-soft)" } as React.CSSProperties}>
          <td className={cx("text-[10px] uppercase tracking-[0.08em] font-medium", isAsk ? "text-ask" : "text-bid")}>{isAsk ? "ask" : "bid"}</td>
          <td className={cx("num text-right font-medium", isAsk ? "text-ask" : "text-bid")}>{fmtPrice(o.price)}</td>
          <td className="num text-right">{fmtInt(o.amount)}</td>
          <td className="num text-right text-muted" title="Cumulative size from the best price to this row">{fmtInt(cum)}</td>
          <td className="num text-right">{fmtUsdc(orderCost(BigInt(o.amount), BigInt(o.price), dec))}</td>
          <td className="whitespace-nowrap"><AddressChip address={o.maker} me={me} /></td>
          <td className="whitespace-nowrap text-muted">{o.expiry === "0" ? "GTC" : <Countdown unix={o.expiry} />}</td>
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
            <td colSpan={8} className="p-0">
              {/* the form stays under the row it came from; on a phone it pins to the visible left edge of the scrolling table */}
              <div className="sticky left-0 max-w-[calc(100vw-1.5rem-2px)]">
                <FillForm bond={bond} order={o} side={filling.side} feeBps={feeBps} funds={funds} onClose={() => setFilling(null)} />
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    )
  }
  const gap = (text: string) => <tr><td colSpan={8} className="text-muted text-[11px] py-1.5">{text}</td></tr>
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
      <div className="flex flex-col gap-3 min-w-0">
        {!active && <Note className="panel px-3 py-2 text-warn">Bond is {bond.status}: orders can be cancelled but not placed or filled until it is Active again.</Note>}
        <Panel title="Order book" aside={<><span className="hidden sm:inline">fee {fmtBps(feeBps)} paid by the buyer{address ? ` · ${myCount} of these are yours` : ""}</span><Refreshed at={book.dataUpdatedAt} /></>}>
          {book.isLoading && <Loading />}
          {book.isError && <ErrorNote error={book.error} />}
          {book.data && (
            <>
              <Stats
                cells={[
                  { label: "Best bid", value: fmtPrice(book.data.bestBid), tone: "text-bid" },
                  { label: "Best ask", value: fmtPrice(book.data.bestAsk), tone: "text-ask" },
                  { label: "Spread", value: sm ? (sm.spread < 0n ? "crossed" : `${fmtPrice(sm.spread)} · ${fmtBps(sm.spreadBps)}`) : "—" },
                  { label: "Mid", value: sm ? fmtPrice(sm.mid) : "—" },
                  { label: "Mark", value: fmtPrice(bond.mark) },
                  { label: "Depth", value: `${fmtInt(bidRows.at(-1)?.cum ?? 0n)} · ${fmtInt(askRows.at(-1)?.cum ?? 0n)}`, title: "Bonds bid for · bonds offered, across the whole book" },
                ]}
              />
              <div className="scroll-x">
                <table className="table">
                  <thead><tr><th>Side</th><th className="text-right">Price</th><th className="text-right">Size</th><th className="text-right" title="Cumulative from the best price">Cum.</th><th className="text-right">Total</th><th>Maker</th><th>Expires</th><th></th></tr></thead>
                  <tbody>
                    {askRows.length === 0 ? gap("No asks on the book.") : [...askRows].reverse().map((r) => row(r, true))}
                    <tr className="bg-surface-2">
                      <td colSpan={8} className="num text-[11px] text-muted py-1">
                        {sm ? (sm.spread < 0n ? "crossed book: the best bid is above the best ask" : `spread ${fmtPrice(sm.spread)} USDC (${fmtBps(sm.spreadBps)}) · mid ${fmtPrice(sm.mid)} · ${asks.length} ask${asks.length === 1 ? "" : "s"} above, ${bids.length} bid${bids.length === 1 ? "" : "s"} below`) : `no spread: ${bids.length === 0 ? "no bids" : "no asks"} on the book`}
                      </td>
                    </tr>
                    {bidRows.length === 0 ? gap("No bids on the book.") : bidRows.map((r) => row(r, false))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
        <Panel title="Recent fills" aside={book.data ? <span>{book.data.trades.length} shown, newest first</span> : undefined}>
          {book.isLoading && <Loading />}
          {book.data && book.data.trades.length === 0 && <Empty>No fills yet.</Empty>}
          {book.data && book.data.trades.length > 0 && (
            <div className="scroll-x max-h-[260px] overflow-y-auto">
              <table className="table">
                <thead className="sticky top-0 bg-surface"><tr><th>When</th><th className="text-right">Size</th><th className="text-right">Price</th><th className="text-right">Total</th><th>Maker</th><th>Taker</th><th>Tx</th></tr></thead>
                <tbody>
                  {book.data.trades.map((t) => (
                    <tr key={t.txHash + t.orderId}>
                      <td className="whitespace-nowrap"><Time unix={t.timestamp} /></td>
                      <td className="num text-right">{fmtInt(t.amount)}</td>
                      <td className="num text-right">{fmtPrice(t.price)}</td>
                      <td className="num text-right text-muted">{fmtUsdc(orderCost(BigInt(t.amount), BigInt(t.price), dec))}</td>
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
    <div className="flex flex-col gap-1.5">
      {balance < need && <Note className="text-warn">Your balance is {kind === "usdc" ? `${fmtUsdc(balance)} USDC` : `${fmtInt(balance)} ${bond.symbol}`}, less than {label}: the fill would revert.</Note>}
      {short ? (
        <>
          <Note>Step 1 · the market holds <span className="num">{kind === "usdc" ? fmtUsdc(have) + " USDC" : fmtInt(have) + " " + bond.symbol}</span> of allowance; it needs {label}.</Note>
          <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} /> approve unlimited instead, so later orders skip this step</label>
          <div><Button variant="primary" busy={busy} onClick={approve}>Approve {unlimited ? "unlimited" : label}</Button></div>
        </>
      ) : children}
    </div>
  )
}

/** Sits directly under the order row it was opened from. Enter fills, Esc closes. */
function FillForm({ bond, order, side, feeBps, funds, onClose }: { bond: Bond; order: Order; side: "buy" | "sell"; feeBps: number; funds: Funds; onClose: () => void }) {
  const tx = useTx()
  const [amount, setAmount] = useState(order.amount)
  const [unlimited, setUnlimited] = useState(false)
  const [busy, setBusy] = useState(false)
  let parsed: bigint | null = null, err: string | null = null
  try { parsed = parseAmount(amount, bond.terms.bondDecimals); if (parsed > BigInt(order.amount)) err = `The order only has ${fmtInt(order.amount)} left.` } catch (e) { err = (e as Error).message }
  const amt = parsed ?? 0n
  const { cost, fee, total } = buyerTotal(amt, BigInt(order.price), bond.terms.bondDecimals, feeBps)
  const need = side === "buy" ? total : amt
  const have = side === "buy" ? funds.usdcAllowance : funds.bondAllowance
  const canFill = !err && have >= need
  const summary = side === "buy"
    ? `Buy ${fmtInt(amt)} ${bond.symbol} from ${order.maker.slice(0, 8)}… at ${fmtPrice(order.price)} USDC: ${fmtUsdc(cost)} USDC + ${fmtUsdc(fee)} USDC fee = ${fmtUsdc(total)} USDC.`
    : `Sell ${fmtInt(amt)} ${bond.symbol} to ${order.maker.slice(0, 8)}… at ${fmtPrice(order.price)} USDC and receive ${fmtUsdc(cost)} USDC (the buyer pays the fee).`
  const fill = async () => {
    if (busy || !canFill) return
    setBusy(true)
    try {
      const r = await tx({ title: `Fill order #${order.orderId}`, summary, abi: marketAbi, address: DEP.market, functionName: "fill", args: [BigInt(order.orderId), amt] })
      if (r?.status === "success") onClose()
    } finally { setBusy(false) }
  }
  const onKey = (e: KeyboardEvent<HTMLFormElement>) => { if (e.key === "Escape") { e.preventDefault(); onClose() } }
  return (
    <form className="px-3 py-2 border-t border-border grid gap-3 md:grid-cols-[160px_1fr] text-[12px]" role="region" aria-label={`${side === "buy" ? "Buy from" : "Sell into"} order #${order.orderId}`} onKeyDown={onKey} onSubmit={(e: FormEvent) => { e.preventDefault(); fill() }}>
      <Field label={`${side === "buy" ? "Buy" : "Sell"} size (${bond.symbol})`} htmlFor="fill-amount" hint={err ? <span className="text-bad">{err}</span> : <>up to {fmtInt(order.amount)} on #{order.orderId} · <kbd>Enter</kbd> fills, <kbd>Esc</kbd> closes</>}>
        <div className="flex gap-1">
          <Input id="fill-amount" className="num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          <Button size="sm" className="h-7" onClick={() => setAmount(order.amount)} title="The whole order">max</Button>
        </div>
      </Field>
      <div className="flex flex-col gap-1.5 min-w-0">
        <p className="leading-snug">{err ? "Fix the size to see what this will do." : summary}</p>
        <Note>The token's compliance check runs first, as a dry run: a wallet without KYC gets the decoded refusal, nothing is signed.</Note>
        {!err && (
          <ApproveThen bond={bond} need={need} kind={side === "buy" ? "usdc" : "bond"} funds={funds} unlimited={unlimited} setUnlimited={setUnlimited}>
            <div><Button type="submit" variant="primary" busy={busy}>{side === "buy" ? `Buy ${fmtInt(amt)} for ${fmtUsdc(total)} USDC` : `Sell ${fmtInt(amt)} for ${fmtUsdc(cost)} USDC`}</Button></div>
          </ApproveThen>
        )}
      </div>
    </form>
  )
}

const EXPIRIES: [string, number][] = [["Good till cancelled", 0], ["1 hour", 3600], ["1 day", 86_400], ["7 days", 604_800], ["30 days", 2_592_000]]
const TICK = 0.005

/** Keyboard first: b/s pick the side, arrows nudge the price by half a cent, Enter places. */
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
  const need = isSell ? amt : total
  const have = isSell ? funds.bondAllowance : funds.usdcAllowance
  const expiresAt = expiry === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) + expiry)
  const when = expiry === 0 ? "good till cancelled" : `expiring in ${EXPIRIES.find((x) => x[1] === expiry)?.[0]}`
  const summary = !ready ? "" : isSell
    ? `Place an ask to sell ${fmtInt(amt)} ${bond.symbol} at ${fmtPrice(px)} USDC (${fmtUsdc(cost)} USDC if fully filled), ${when}.`
    : `Place a bid to buy ${fmtInt(amt)} ${bond.symbol} at ${fmtPrice(px)} USDC: ${fmtUsdc(cost)} USDC + ${fmtUsdc(fee)} USDC fee = ${fmtUsdc(total)} USDC when filled, ${when}.`
  const place = async () => {
    if (busy || !ready || !address || !active || have < need) return
    setBusy(true)
    try {
      const r = await tx({ title: `Place ${isSell ? "ask" : "bid"}`, summary, abi: marketAbi, address: DEP.market, functionName: "place", args: [BigInt(bond.id), isSell, amt, px, expiresAt] })
      if (r?.status === "success") setAmount("")
    } finally { setBusy(false) }
  }
  const nudge = (dir: 1 | -1) => {
    const n = Number(price)
    if (!Number.isFinite(n)) return
    setPrice(Math.max(TICK, n + dir * TICK).toFixed(3).replace(/0+$/, "").replace(/\.$/, ""))
  }
  const onKey = (e: KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement
    const inField = t.tagName === "INPUT" || t.tagName === "SELECT"
    if ((e.key === "b" || e.key === "s") && !(inField && t.id !== "side-buy" && t.id !== "side-sell")) { e.preventDefault(); setIsSell(e.key === "s") }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && t.id === "price") { e.preventDefault(); nudge(e.key === "ArrowUp" ? 1 : -1) }
  }
  const maxAmount = () => {
    if (isSell) setAmount(funds.bonds.toString())
    else if (px > 0n) setAmount(((funds.usdc * 10n ** BigInt(bond.terms.bondDecimals)) / px / (10_000n + BigInt(feeBps)) * 10_000n).toString())
  }
  return (
    <Panel title="Place an order" aside={<span>limit · <kbd>b</kbd> <kbd>s</kbd> side · <kbd>↑</kbd> <kbd>↓</kbd> price · <kbd>Enter</kbd> place</span>}>
      <form className="p-3 flex flex-col gap-2.5" onSubmit={(e) => { e.preventDefault(); place() }} onKeyDown={onKey}>
        <div className="grid grid-cols-2 rounded-sm border border-border-strong overflow-hidden text-[12px]" role="radiogroup" aria-label="Side">
          <button id="side-buy" type="button" role="radio" aria-checked={!isSell} className={cx("py-1", !isSell ? "bg-bid text-[#0b1f14] font-semibold" : "text-muted hover:bg-surface-2")} onClick={() => setIsSell(false)}>Buy · bid</button>
          <button id="side-sell" type="button" role="radio" aria-checked={isSell} className={cx("py-1", isSell ? "bg-ask text-[#2a0f0d] font-semibold" : "text-muted hover:bg-surface-2")} onClick={() => setIsSell(true)}>Sell · ask</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Size (${bond.symbol})`} htmlFor="amount" hint={funds.loaded ? `hold ${fmtInt(funds.bonds)} ${bond.symbol}` : undefined}>
            <div className="flex gap-1">
              <Input id="amount" className="num" inputMode="numeric" placeholder="10" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
              <Button size="sm" className="h-7" onClick={maxAmount} title={isSell ? "Everything you hold" : "What your USDC affords at this price"}>max</Button>
            </div>
          </Field>
          <Field label="Price (USDC)" htmlFor="price" hint={`mark ${fmtPrice(bond.mark)} · ${funds.loaded ? `${fmtUsdc(funds.usdc)} USDC` : `face ${fmtUsdc(bond.faceValue)}`}`}>
            <Input id="price" className="num" inputMode="decimal" placeholder="0.99" value={price} onChange={(e) => setPrice(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <Field label="Expiry" htmlFor="expiry">
          <select id="expiry" className="input" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
            {EXPIRIES.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {ready && (
          <dl className="kv border-t border-border pt-2">
            <dt>{isSell ? "Receive if filled" : "Cost"}</dt><dd className="num">{fmtUsdc(cost)} USDC</dd>
            {!isSell && <><dt>Fee ({fmtBps(feeBps)})</dt><dd className="num">{fmtUsdc(fee)} USDC</dd></>}
            {!isSell && <><dt>Total</dt><dd className="num font-medium">{fmtUsdc(total)} USDC</dd></>}
            <dt>Expires</dt><dd>{when}</dd>
          </dl>
        )}
        {err && <Note className="text-bad">{err}</Note>}
        {!address && <Note>Connect a wallet to place orders.</Note>}
        {address && !active && <Note className="text-warn">The bond is {bond.status}; the market rejects new orders (BondNotActive).</Note>}
        {address && active && ready && (
          <ApproveThen bond={bond} need={need} kind={isSell ? "bond" : "usdc"} funds={funds} unlimited={unlimited} setUnlimited={setUnlimited}>
            <div><Button type="submit" variant="primary" busy={busy} className="w-full">Place {isSell ? "ask" : "bid"}: {fmtInt(amt)} @ {fmtPrice(px)}</Button></div>
          </ApproveThen>
        )}
        <Note>Allowances are only used when the order fills: a bid needs USDC approved to the market, an ask needs {bond.symbol} approved. <Badge tone="neutral">maker</Badge> pays no fee; the buyer pays {fmtBps(feeBps)} on top.</Note>
      </form>
    </Panel>
  )
}
