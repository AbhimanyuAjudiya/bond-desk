import { useState } from "react"
import { useAccount, useReadContract, useReadContracts } from "wagmi"
import { erc20Abi, lifecycleAbi, tokenAbi } from "../../config/abi"
import { GAS } from "../../config/chain"
import { DEP } from "../../config/deployments"
import { AddressChip, Badge, Button, ConfirmButton, Countdown, Empty, Field, Input, KV, Loading, Note, Panel, Time } from "../../components/ui"
import { useRoles, useWalletFunds } from "../../hooks/data"
import { useTx } from "../../hooks/useTx"
import type { Bond } from "../../lib/api"
import { couponPerBond, fmtInt, fmtUsdc, intervalName, parseUsdc } from "../../lib/format"

export function Coupons({ bond }: { bond: Bond }) {
  const { address } = useAccount()
  const id = BigInt(bond.id)
  const roles = useRoles(bond.terms.issuer, bond.token)
  const tx = useTx()
  const base = useReadContracts({
    contracts: [
      { abi: lifecycleAbi, address: DEP.lifecycle, functionName: "couponCount", args: [id] },
      { abi: lifecycleAbi, address: DEP.lifecycle, functionName: "funded", args: [id] },
      { abi: lifecycleAbi, address: DEP.lifecycle, functionName: "scheduleOf", args: [id] },
      { abi: lifecycleAbi, address: DEP.lifecycle, functionName: "scheduledFor", args: [id] },
      { abi: lifecycleAbi, address: DEP.lifecycle, functionName: "couponDue", args: [id] },
      { abi: tokenAbi, address: bond.token, functionName: "totalSupply" },
      { abi: tokenAbi, address: bond.token, functionName: "balanceOf", args: [address ?? DEP.deployer] },
    ],
    query: { refetchInterval: 12_000 },
  })
  const count = Number((base.data?.[0]?.result as bigint | undefined) ?? 0n)
  const funded = (base.data?.[1]?.result as bigint | undefined) ?? 0n
  const schedule = base.data?.[2]?.result as `0x${string}` | undefined
  const scheduledFor = (base.data?.[3]?.result as bigint | undefined) ?? 0n
  const due = (base.data?.[4]?.result as bigint | undefined) ?? 0n
  const supply = (base.data?.[5]?.result as bigint | undefined) ?? 0n
  const myBalance = address ? ((base.data?.[6]?.result as bigint | undefined) ?? 0n) : 0n
  const ids = Array.from({ length: count }, (_, i) => BigInt(i + 1))
  const rows = useReadContracts({
    contracts: ids.flatMap((c) => [
      { abi: lifecycleAbi, address: DEP.lifecycle, functionName: "coupons", args: [id, c] } as const,
      { abi: lifecycleAbi, address: DEP.lifecycle, functionName: "claimable", args: [id, c, address ?? DEP.deployer] } as const,
    ]),
    query: { enabled: count > 0, refetchInterval: 12_000 },
  })
  const [busy, setBusy] = useState<string | null>(null)
  const claim = async (c: bigint, amount: bigint) => {
    setBusy(`claim-${c}`)
    try { await tx({ title: `Claim coupon #${c}`, summary: `Claim your ${fmtUsdc(amount)} USDC share of coupon #${c}.`, abi: lifecycleAbi, address: DEP.lifecycle, functionName: "claim", args: [id, c] }) } finally { setBusy(null) }
  }
  const now = Math.floor(Date.now() / 1000)
  const nextCoupon = Number(bond.nextCoupon)
  const noMore = nextCoupon > Number(bond.maturity)
  const scheduled = !!schedule && schedule !== "0x0000000000000000000000000000000000000000"
  const perBond = couponPerBond(BigInt(bond.faceValue), BigInt(bond.couponRateBps), BigInt(bond.couponInterval))
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
      <div className="flex flex-col gap-3 min-w-0">
        <Panel title="Coupon schedule">
          <div className="p-3 grid gap-3 md:grid-cols-2">
            <KV rows={[
              ["Rate", `${Number(bond.couponRateBps) / 100}% per year, paid ${intervalName(bond.couponInterval)}`],
              ["Per bond per period", `${fmtUsdc(perBond)} USDC`],
              ["Outstanding supply", `${fmtInt(supply)} ${bond.symbol}`],
              ["Pool funded", `${fmtUsdc(funded)} USDC`],
              ["Due at next run", `${fmtUsdc(due)} USDC`],
            ]} />
            <div className="text-[12px] leading-snug flex flex-col gap-1.5">
              {noMore ? <p>Every coupon up to maturity has been paid.</p> : (
                <p>Next coupon <Time unix={bond.nextCoupon} /> (<Countdown unix={bond.nextCoupon} />).{nextCoupon <= now && " It is due now: the scheduled run or anyone calling payCoupon will snapshot holders and reserve the coupon."}</p>
              )}
              <p>
                {scheduled
                  ? <>A Hedera Schedule Service run is pending for the coupon of <Time unix={scheduledFor} /> (schedule <AddressChip address={schedule!} kind="contract" />). It executes on time without anyone sending a transaction; the lifecycle contract pays for it from its HBAR float.</>
                  : <>No schedule is pending{noMore ? "" : ": the last run fired or failed; the next one is created when a coupon is paid, or by calling schedule()"}.</>}
              </p>
              {funded < due && !noMore && <p className="text-warn">The pool holds less than the next coupon needs; payCoupon would revert with CouponUnderfunded until the issuer funds it.</p>}
            </div>
          </div>
        </Panel>
        <Panel title="Paid coupons" aside={address ? <span>claimable amounts for your wallet</span> : <span>connect a wallet to see claimable amounts</span>}>
          {base.isLoading && <Loading />}
          {count === 0 && !base.isLoading && <Empty>No coupon has been paid yet.</Empty>}
          {count > 0 && (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>#</th><th>Paid</th><th className="text-right">Amount</th><th className="text-right">Snapshot</th><th className="text-right">Claimed</th><th className="text-right">Yours</th><th></th></tr></thead>
                <tbody>
                  {ids.map((c, i) => {
                    const cp = rows.data?.[i * 2]?.result as readonly [bigint, bigint, bigint, bigint] | undefined
                    const mine = (rows.data?.[i * 2 + 1]?.result as bigint | undefined) ?? 0n
                    return (
                      <tr key={String(c)}>
                        <td className="num">{String(c)}</td>
                        <td className="whitespace-nowrap">{cp ? <Time unix={cp[3]} /> : "…"}</td>
                        <td className="num text-right">{cp ? fmtUsdc(cp[1]) : "…"}</td>
                        <td className="num text-right">{cp ? String(cp[0]) : "…"}</td>
                        <td className="num text-right">{cp ? fmtUsdc(cp[2]) : "…"}</td>
                        <td className="num text-right">{address ? fmtUsdc(mine) : "—"}</td>
                        <td className="text-right">{address && mine > 0n && <Button size="sm" variant="primary" busy={busy === `claim-${c}`} onClick={() => claim(c, mine)}>Claim {fmtUsdc(mine)}</Button>}{address && mine === 0n && <span className="text-[12px] text-muted">nothing to claim</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Note className="px-3 py-2 border-t border-border">Claims are pro-rata to the ATS snapshot taken when the coupon was paid, so buying after a coupon does not entitle you to it.</Note>
        </Panel>
        <Redeem bond={bond} funded={funded} supply={supply} myBalance={myBalance} />
      </div>
      <div className="flex flex-col gap-3">
        {roles.isIssuer ? <IssuerPanel bond={bond} funded={funded} due={due} scheduled={scheduled} nextDue={nextCoupon <= now && !noMore} /> : (
          <Panel title="Issuer panel"><Empty>Funding, scheduling and paying coupons by hand are shown to the issuer wallet ({bond.terms.issuer.slice(0, 8)}…).</Empty></Panel>
        )}
      </div>
    </div>
  )
}

function IssuerPanel({ bond, funded, due, scheduled, nextDue }: { bond: Bond; funded: bigint; due: bigint; scheduled: boolean; nextDue: boolean }) {
  const tx = useTx()
  const funds = useWalletFunds(bond.token, bond.settlement)
  const [amount, setAmount] = useState("100")
  const [busy, setBusy] = useState<string | null>(null)
  const id = BigInt(bond.id)
  let amt = 0n, err: string | null = null
  try { amt = parseUsdc(amount || "0"); if (amt <= 0n) err = "Enter an amount" } catch { err = "Amount must be USDC" }
  const run = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); try { await fn() } finally { setBusy(null) } }
  const short = funds.usdcAllowanceLifecycle < amt
  const float = useReadContract({ abi: erc20Abi, address: DEP.settlement, functionName: "balanceOf", args: [DEP.lifecycle] })
  return (
    <Panel title="Issuer" aside={<span>you are the issuer</span>}>
      <div className="p-3 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Field label="Fund the coupon pool (USDC)" htmlFor="fund" hint={`pool ${fmtUsdc(funded)} USDC · next coupon needs ${fmtUsdc(due)} USDC · you hold ${fmtUsdc(funds.usdc)} USDC`}>
            <Input id="fund" className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {err && <Note className="text-bad">{err}</Note>}
          {!err && short && (
            <Button busy={busy === "approve"} onClick={() => run("approve", async () => { await tx({ title: "Approve USDC for the lifecycle", summary: `Allow BondLifecycle to pull ${fmtUsdc(amt)} USDC from your wallet.`, abi: erc20Abi, address: bond.settlement, functionName: "approve", args: [DEP.lifecycle, amt] }); await funds.refetch() })}>
              Step 1 · Approve {fmtUsdc(amt)} USDC
            </Button>
          )}
          {!err && !short && (
            <ConfirmButton variant="primary" confirm={`Move ${fmtUsdc(amt)} USDC into the pool for bond #${bond.id}?`} busy={busy === "fund"} onConfirm={() => run("fund", () => tx({ title: "Fund coupon pool", summary: `Pull ${fmtUsdc(amt)} USDC into bond #${bond.id}'s pool (coupons and principal are paid from it).`, abi: lifecycleAbi, address: DEP.lifecycle, functionName: "fund", args: [id, amt] }))}>
              Fund {fmtUsdc(amt)} USDC
            </ConfirmButton>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="label">Coupon runs</span>
          <Note>Both calls reach Hedera's schedule system contract, which eth_estimateGas cannot price: they are sent with explicit gas limits (schedule 3,000,000; payCoupon 4,000,000) and without a dry run.</Note>
          <div className="flex flex-wrap gap-2">
            <ConfirmButton confirm={scheduled ? "A run is already pending; the contract will revert with AlreadyScheduled. Send anyway?" : "Create a Schedule Service run for the next coupon (gas 3,000,000)?"} busy={busy === "schedule"}
              onConfirm={() => run("schedule", () => tx({ title: "Schedule next coupon", summary: `Ask the Hedera Schedule Service to run payCoupon for bond #${bond.id} at the next coupon time.`, abi: lifecycleAbi, address: DEP.lifecycle, functionName: "schedule", args: [id], gas: GAS.schedule, skipSimulation: true }))}>
              Schedule next run
            </ConfirmButton>
            <ConfirmButton variant="primary" confirm={nextDue ? `Snapshot holders and reserve ${fmtUsdc(due)} USDC from the pool now (gas 4,000,000)?` : "The next coupon is not due yet: the contract will revert with CouponNotDue. Send anyway?"} busy={busy === "pay"}
              onConfirm={() => run("pay", () => tx({ title: "Pay coupon by hand", summary: `Run payCoupon for bond #${bond.id}: snapshot holders, reserve ${fmtUsdc(due)} USDC, advance nextCoupon and schedule the following run.`, abi: lifecycleAbi, address: DEP.lifecycle, functionName: "payCoupon", args: [id], gas: GAS.payCoupon, skipSimulation: true }))}>
              Pay coupon by hand
            </ConfirmButton>
          </div>
          <Note>Lifecycle contract holds {float.data !== undefined ? fmtUsdc(float.data) : "…"} USDC in total; its HBAR float pays for scheduled runs.</Note>
        </div>
      </div>
    </Panel>
  )
}

function Redeem({ bond, funded, supply, myBalance }: { bond: Bond; funded: bigint; supply: bigint; myBalance: bigint }) {
  const { address } = useAccount()
  const tx = useTx()
  const [busy, setBusy] = useState(false)
  const now = Math.floor(Date.now() / 1000)
  const matured = now >= Number(bond.maturity)
  const face = BigInt(bond.faceValue)
  const scale = 10n ** BigInt(bond.terms.bondDecimals)
  const mine = (myBalance * face) / scale
  const all = (supply * face) / scale
  const defaulted = bond.status === "Defaulted"
  const can = !!address && matured && !defaulted && myBalance > 0n && funded >= mine
  return (
    <Panel title="Redeem at maturity">
      <div className="p-3 grid gap-3 md:grid-cols-2">
        <KV rows={[
          ["Maturity", <><Time unix={bond.maturity} /> <span className="text-muted">(<Countdown unix={bond.maturity} />)</span></>],
          ["Principal for all bonds", `${fmtUsdc(all)} USDC`],
          ["Pool funded", `${fmtUsdc(funded)} USDC`],
          ["Your bonds", address ? `${fmtInt(myBalance)} ${bond.symbol} → ${fmtUsdc(mine)} USDC` : "connect a wallet"],
        ]} />
        <div className="text-[12px] leading-snug flex flex-col gap-2">
          <p>
            {defaulted && <>The bond is Defaulted: principal is not paid from the pool; holders claim the seized collateral instead (Collateral tab).</>}
            {!defaulted && !matured && <>Redemption opens at maturity, <Countdown unix={bond.maturity} />. Then any holder burns their whole balance through the token's maturity redeemer and receives face value from the pool; the first redemption also moves the bond to Matured.</>}
            {!defaulted && matured && myBalance === 0n && <>The bond has matured. This wallet holds no {bond.symbol}, so there is nothing to redeem.</>}
            {!defaulted && matured && myBalance > 0n && funded < mine && <>The bond has matured but the pool holds {fmtUsdc(funded)} USDC, less than your {fmtUsdc(mine)} USDC of principal; the issuer must fund it first.</>}
            {!defaulted && matured && myBalance > 0n && funded >= mine && <>The bond has matured. Redeem burns your {fmtInt(myBalance)} {bond.symbol} and pays {fmtUsdc(mine)} USDC.</>}
          </p>
          <div>
            <ConfirmButton variant="primary" disabled={!can} busy={busy} confirm={`Burn ${fmtInt(myBalance)} ${bond.symbol} and receive ${fmtUsdc(mine)} USDC?`}
              onConfirm={async () => { setBusy(true); try { await tx({ title: "Redeem", summary: `Redeem ${fmtInt(myBalance)} ${bond.symbol} for ${fmtUsdc(mine)} USDC of principal.`, abi: lifecycleAbi, address: DEP.lifecycle, functionName: "redeem", args: [BigInt(bond.id)] }) } finally { setBusy(false) } }}>
              Redeem
            </ConfirmButton>
          </div>
          {!matured && <span><Badge tone="neutral">available at maturity</Badge></span>}
        </div>
      </div>
    </Panel>
  )
}
