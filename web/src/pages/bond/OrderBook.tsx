import { useState, type ReactNode } from "react"
import { useAccount, useReadContract } from "wagmi"
import { erc20Abi, marketAbi, tokenAbi } from "../../config/abi"
import { DEP } from "../../config/deployments"
import { AddressChip, Badge, Button, ConfirmButton, Countdown, Empty, ErrorNote, Field, Input, Loading, Note, Panel, Time, TxLink, cx } from "../../components/ui"
import { useOrderbook, useWalletFunds } from "../../hooks/data"
import { useTx } from "../../hooks/useTx"
import type { Bond, Order } from "../../lib/api"
import { buyerTotal, fmtInt, fmtPrice, fmtUsdc, orderCost, parseAmount, parseUsdc, sameAddress } from "../../lib/format"

export function OrderBook({ bond }: { bond: Bond }) {
  const book = useOrderbook(bond.id)
  const { address } = useAccount()
  const funds = useWalletFunds(bond.token, bond.settlement)
  const fee = useReadContract({ abi: marketAbi, address: DEP.market, functionName: "feeBps", query: { staleTime: 300_000 } })
  const feeBps = fee.data ?? 0
  const [filling, setFilling] = useState<Order | null>(null)
  const [fillSide, setFillSide] = useState<"buy" | "sell">("buy")
  const tx = useTx()
  const [busy, setBusy] = useState<string | null>(null)
  const cancel = async (o: Order) => {
    setBusy(`cancel-${o.orderId}`)
    try { await tx({ title: `Cancel order #${o.orderId}`, summary: `Remove your order #${o.orderId} (${fmtInt(o.amount)} ${bond.symbol} at ${fmtPrice(o.price)} USDC) from the book.`, abi: marketAbi, address: DEP.market, functionName: "cancel", args: [BigInt(o.orderId)] }) } finally { setBusy(null) }
  }
  const active = bond.status === "Active"
  const side = (rows: Order[], isAsk: boolean): ReactNode => (
    <table className="table">
      <thead><tr><th className="text-right">Price</th><th className="text-right">Amount</th><th className="text-right">Total</th><th>Maker</th><th>Expires</th><th></th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-4">No {isAsk ? "asks" : "bids"}.</td></tr>}
        {rows.map((o) => {
          const mine = sameAddress(o.maker, address)
          return (
            <tr key={o.orderId} className={cx(mine && "bg-accent-soft/50")}>
              <td className={cx("num text-right font-medium", isAsk ? "text-ask" : "text-bid")}>{fmtPrice(o.price)}</td>
              <td className="num text-right">{fmtInt(o.amount)}</td>
              <td className="num text-right">{fmtUsdc(orderCost(BigInt(o.amount), BigInt(o.price), bond.terms.bondDecimals))}</td>
              <td><AddressChip address={o.maker} me={mine} /></td>
              <td className="whitespace-nowrap">{o.expiry === "0" ? <span className="text-muted">GTC</span> : <Countdown unix={o.expiry} />}</td>
              <td className="text-right whitespace-nowrap">
                {mine ? (
                  <ConfirmButton size="sm" variant="danger" confirm={`Cancel order #${o.orderId}?`} busy={busy === `cancel-${o.orderId}`} onConfirm={() => cancel(o)}>Cancel</ConfirmButton>
                ) : (
                  <Button size="sm" disabled={!address || !active} onClick={() => { setFilling(o); setFillSide(isAsk ? "buy" : "sell") }}>{isAsk ? "Buy" : "Sell"}</Button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px] items-start">
      <div className="flex flex-col gap-5 min-w-0">
        {!active && <Note className="panel p-3 text-warn">Bond is {bond.status}: orders can be cancelled but not placed or filled until it is Active again.</Note>}
        <Panel title="Order book" aside={<span>fee {Number(feeBps) / 100}% paid by the buyer · your orders highlighted</span>}>
          {book.isLoading && <Loading rows={4} />}
          {book.isError && <ErrorNote error={book.error} />}
          {book.data && (
            <div className="grid md:grid-cols-2">
              <div className="border-b md:border-b-0 md:border-r border-border overflow-x-auto"><div className="label px-3 pt-2">Bids · buyers</div>{side(book.data.bids, false)}</div>
              <div className="overflow-x-auto"><div className="label px-3 pt-2">Asks · sellers</div>{side(book.data.asks, true)}</div>
            </div>
          )}
        </Panel>
        {filling && <FillForm bond={bond} order={filling} side={fillSide} feeBps={Number(feeBps)} funds={funds} onClose={() => setFilling(null)} />}
        <Panel title="Recent fills">
          {book.data && book.data.trades.length === 0 && <Empty>No fills yet.</Empty>}
          {book.data && book.data.trades.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>When</th><th className="text-right">Amount</th><th className="text-right">Price</th><th>Maker</th><th>Taker</th><th>Tx</th></tr></thead>
                <tbody>
                  {book.data.trades.map((t) => (
                    <tr key={t.txHash + t.orderId}>
                      <td className="whitespace-nowrap"><Time unix={t.timestamp} /></td>
                      <td className="num text-right">{fmtInt(t.amount)}</td>
                      <td className="num text-right">{fmtPrice(t.price)}</td>
                      <td><AddressChip address={t.maker} me={sameAddress(t.maker, address)} /></td>
                      <td><AddressChip address={t.taker} me={sameAddress(t.taker, address)} /></td>
                      <td><TxLink hash={t.txHash} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <PlaceOrder bond={bond} feeBps={Number(feeBps)} funds={funds} active={active} />
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
    <div className="flex flex-col gap-2">
      {balance < need && <Note className="text-warn">Your balance is {kind === "usdc" ? `${fmtUsdc(balance)} USDC` : `${fmtInt(balance)} ${bond.symbol}`}, less than {label}: the fill would revert.</Note>}
      {short ? (
        <>
          <Note>Step 1 · the market holds <span className="num">{kind === "usdc" ? fmtUsdc(have) + " USDC" : fmtInt(have) + " " + bond.symbol}</span> of allowance; it needs {label}.</Note>
          <label className="flex items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} /> approve unlimited instead, so later orders skip this step</label>
          <Button variant="primary" busy={busy} onClick={approve}>Approve {unlimited ? "unlimited" : label}</Button>
        </>
      ) : children}
    </div>
  )
}

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
    <Panel title={`${side === "buy" ? "Buy from" : "Sell into"} order #${order.orderId}`} aside={<button className="text-muted hover:text-fg" onClick={onClose}>close</button>}>
      <div className="p-4 grid gap-4 md:grid-cols-[200px_1fr]">
        <Field label={`Amount (${bond.symbol})`} htmlFor="fill-amount" hint={err ? <span className="text-bad">{err}</span> : `up to ${fmtInt(order.amount)}`}>
          <Input id="fill-amount" className="num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-[13px] leading-relaxed">{err ? "Fix the amount to see what this will do." : summary}</p>
          <Note>The token's compliance check runs first: a wallet without KYC gets a decoded refusal, not a silent failure.</Note>
          {!err && (
            <ApproveThen bond={bond} need={side === "buy" ? total : amt} kind={side === "buy" ? "usdc" : "bond"} funds={funds} unlimited={unlimited} setUnlimited={setUnlimited}>
              <div><Button variant="primary" busy={busy} onClick={fill}>{side === "buy" ? `Buy ${fmtInt(amt)} for ${fmtUsdc(total)} USDC` : `Sell ${fmtInt(amt)} for ${fmtUsdc(cost)} USDC`}</Button></div>
            </ApproveThen>
          )}
        </div>
      </div>
    </Panel>
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
          <button role="radio" aria-checked={!isSell} className={cx("py-1.5", !isSell ? "bg-bid text-white font-medium" : "text-muted hover:bg-surface-2")} onClick={() => setIsSell(false)}>Buy · bid</button>
          <button role="radio" aria-checked={isSell} className={cx("py-1.5", isSell ? "bg-ask text-white font-medium" : "text-muted hover:bg-surface-2")} onClick={() => setIsSell(true)}>Sell · ask</button>
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
        <Note>Allowances are only used when the order fills: a bid needs USDC approved to the market, an ask needs {bond.symbol} approved. <Badge tone="neutral">maker</Badge> pays no fee; the buyer pays {feeBps / 100}% on top.</Note>
      </div>
    </Panel>
  )
}
