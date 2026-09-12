import { useState, type FormEvent } from "react"
import { isAddress, type Address } from "viem"
import { useAccount, useReadContracts } from "wagmi"
import { erc20Abi, tokenAbi } from "../config/abi"
import { DEP } from "../config/deployments"
import { AddressChip, Badge, Button, ConfirmButton, Empty, ErrorNote, Field, Input, KV, Loading, Note, Panel } from "../components/ui"
import { useBond, useBonds, useEligibility, useRoles } from "../hooks/data"
import { useTx } from "../hooks/useTx"
import { explainReason, isAllowanceOnly } from "../lib/errors"
import { fmtInt, fmtUsdc, sameAddress, shortAddress } from "../lib/format"

const TEN_YEARS = 3650n * 86_400n

/** The officer's desk. KYC and freezes live on each bond's own ATS token, so the page first picks which token it acts on. */
export function Compliance() {
  const { address: me } = useAccount()
  const bonds = useBonds()
  const list = bonds.data?.bonds ?? []
  const [pick, setPick] = useState<string | null>(null)
  const bondId = pick ?? list.find((b) => b.id === "1")?.id ?? list[0]?.id ?? "1"
  const summary = list.find((b) => b.id === bondId)
  const bond = useBond(bondId)
  const token = summary?.token ?? DEP.token
  const symbol = summary?.symbol ?? "bonds"
  const issuer = bond.data?.terms.issuer ?? DEP.deployer
  const roles = useRoles(issuer, token)
  const [input, setInput] = useState("")
  const [subject, setSubject] = useState<Address | undefined>(undefined)
  const lookup = (e: FormEvent) => {
    e.preventDefault()
    const v = input.trim()
    if (isAddress(v)) setSubject(v)
  }
  const bad = input.trim() !== "" && !isAddress(input.trim())
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] leading-none">Compliance</h1>
          <p className="note mt-1 max-w-[80ch]">
            KYC and freezes live on the ATS bond token, not in this app. The token answers every transfer with an EIP-1066 code, and the market refuses a fill before any money moves when that answer is not "allowed".
          </p>
        </div>
        <div className="w-full sm:w-[300px]">
          <Field label="Bond token" htmlFor="bond-pick" hint={<AddressChip address={token} kind="contract" />}>
            <select id="bond-pick" className="input" value={bondId} onChange={(e) => setPick(e.target.value)} disabled={list.length === 0}>
              {list.length === 0 && <option value={bondId}>{bonds.isError ? "bond list unavailable" : "loading bonds…"}</option>}
              {list.map((b) => <option key={b.id} value={b.id}>{b.symbol} · bond #{b.id} · {shortAddress(b.token)}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <Panel title="Check a wallet" aside={<span>against {symbol}'s token</span>}>
        <form className="p-3 flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={lookup}>
          <div className="flex-1">
            <Field label="EVM address" htmlFor="lookup" hint={bad ? <span className="text-bad">That is not a 0x address.</span> : "Any address; try one of the demo wallets from deployments/testnet.json."}>
              <Input id="lookup" className="font-mono" placeholder="0x…" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} autoComplete="off" />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!isAddress(input.trim())}>Look up</Button>
            {me && <Button type="button" onClick={() => { setInput(me); setSubject(me) }}>Use my wallet</Button>}
          </div>
        </form>
        {subject && <WalletReport key={`${subject}-${token}`} address={subject} me={me} token={token} symbol={symbol} issuer={issuer} />}
      </Panel>

      <Panel title="Officer actions" aside={<span>{roles.isKycOfficer || roles.isFreezeManager ? `your wallet holds ATS roles on ${symbol}'s token` : `requires ATS roles on ${symbol}'s token`}</span>}>
        {!me && <Empty>Connect the compliance officer wallet to grant or revoke KYC and to freeze or unfreeze addresses.</Empty>}
        {me && roles.loading && <Loading />}
        {me && !roles.loading && !roles.isKycOfficer && !roles.isFreezeManager && (
          <Note className="p-3">
            <AddressChip address={me} /> holds neither the KYC role nor the freeze-manager role on this token, so these actions are hidden. On the demo bonds the compliance officer holds KYC, freeze and pause; the issuer also holds KYC. Wallets can request their own testnet KYC from the Desk page.
          </Note>
        )}
        {me && (roles.isKycOfficer || roles.isFreezeManager) && (
          <div className="p-3 flex flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {roles.isKycOfficer && <Badge tone="ok">KYC role</Badge>}
              {roles.isFreezeManager && <Badge tone="ok">Freeze manager</Badge>}
              {roles.isPauser && <Badge tone="ok">Pauser</Badge>}
              {roles.isAdmin && <Badge tone="neutral">Desk admin</Badge>}
            </div>
            <OfficerActions key={`${subject}-${token}`} subject={subject} issuer={issuer} token={token} symbol={symbol} canKyc={roles.isKycOfficer} canFreeze={roles.isFreezeManager} />
          </div>
        )}
      </Panel>
    </>
  )
}

function WalletReport({ address, me, token, symbol, issuer }: { address: Address; me?: Address; token: Address; symbol: string; issuer: Address }) {
  const elig = useEligibility(address)
  const q = useReadContracts({
    contracts: [
      { abi: tokenAbi, address: token, functionName: "getKycStatusFor", args: [address] },
      { abi: tokenAbi, address: token, functionName: "isInControlList", args: [address] },
      { abi: tokenAbi, address: token, functionName: "balanceOf", args: [address] },
      { abi: erc20Abi, address: DEP.settlement, functionName: "balanceOf", args: [address] },
      { abi: tokenAbi, address: token, functionName: "canTransferFrom", args: [issuer, address, 1n, "0x"] },
      { abi: tokenAbi, address: token, functionName: "paused" },
    ],
    query: { refetchInterval: 15_000 },
  })
  if (q.isLoading) return <Loading />
  if (q.isError) return <ErrorNote error={q.error} />
  const kyc = q.data?.[0]?.result === 1
  const frozen = q.data?.[1]?.result === true
  const bondBal = (q.data?.[2]?.result as bigint | undefined) ?? 0n
  const usdc = (q.data?.[3]?.result as bigint | undefined) ?? 0n
  const probe = q.data?.[4]?.result as readonly [boolean, `0x${string}`, `0x${string}`] | undefined
  const paused = q.data?.[5]?.result === true
  return (
    <div className="px-3 pb-3 grid gap-3 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><AddressChip address={address} me={sameAddress(address, me)} /></div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={kyc ? "ok" : "bad"}>{kyc ? "KYC granted" : "no KYC"}</Badge>
          <Badge tone={frozen ? "bad" : "ok"}>{frozen ? "frozen" : "not frozen"}</Badge>
          {paused && <Badge tone="warn">token paused</Badge>}
        </div>
        <KV rows={[
          ["Bond balance", `${fmtInt(bondBal)} ${symbol}`],
          ["USDC balance", `${fmtUsdc(usdc)} USDC`],
          ["Hedera account", elig.data?.hederaAccount ?? (elig.isLoading ? "…" : "none")],
          ["HBAR", elig.data ? (Number(elig.data.hbarTinybar) / 1e8).toFixed(4) : "…"],
        ]} />
      </div>
      <div className="flex flex-col gap-2 text-[12px]">
        <span className="label">Compliance decision</span>
        <p className="leading-relaxed">
          {/* The probe is the token's own answer and wins; the flags only explain it. */}
          {probe && probe[0] && <>The token <strong>allows</strong> a transfer of one bond from the issuer to this wallet (code {probe[1]}). It is KYC-granted, not frozen, and the token is not paused.</>}
          {probe && !probe[0] && isAllowanceOnly(probe[2]) && <>The token's compliance checks <strong>pass</strong> for a transfer from the issuer to this wallet: KYC granted, not frozen, not paused. Its last check, the operator's allowance, is the market's to hold (the issuer approved it); a read-only probe has no operator, hence code {probe[1]}.</>}
          {probe && !probe[0] && !isAllowanceOnly(probe[2]) && <>The token would <strong>refuse</strong> a transfer from the issuer to this wallet: {explainReason(probe[2])} (code {probe[1]}, reason selector {probe[2].slice(0, 10)}). The market's fill would revert with ComplianceRejected before any USDC moved.</>}
          {!probe && !kyc && <>The token would <strong>refuse</strong> a transfer to this wallet because its KYC status is not granted.</>}
          {!probe && kyc && frozen && <>The token would <strong>refuse</strong> transfers involving this wallet: it is on the control list (frozen by the freeze manager).</>}
          {!probe && kyc && !frozen && paused && <>The token is paused, so every transfer is refused right now.</>}
          {!probe && kyc && !frozen && !paused && <>The token would <strong>allow</strong> a transfer of one bond from the issuer to this wallet. It is KYC-granted and not frozen.</>}
        </p>
        <Note>Probe: canTransferFrom(issuer → this wallet, 1 bond) as answered by {symbol}'s token itself.</Note>
      </div>
    </div>
  )
}

function OfficerActions({ subject, issuer, token, symbol, canKyc, canFreeze }: { subject?: Address; issuer: Address; token: Address; symbol: string; canKyc: boolean; canFreeze: boolean }) {
  const tx = useTx()
  const [target, setTarget] = useState(subject ?? "")
  const ok = isAddress(target.trim())
  const t = target.trim() as Address
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try { await fn() } finally { setBusy(null) }
  }
  const now = () => BigInt(Math.floor(Date.now() / 1000))
  const who = `${t.slice(0, 10)}…`
  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-[520px]">
        <Field label="Target address" htmlFor="target" hint="The same conventions as ats/script/CreateBond.s.sol: grantKyc(account, vc id, now-1, now+10 years, bond issuer as SSI issuer).">
          <Input id="target" className="font-mono" placeholder="0x…" value={target} onChange={(e) => setTarget(e.target.value)} spellCheck={false} autoComplete="off" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {canKyc && (
          <>
            <ConfirmButton confirm={`grantKyc on ${symbol}'s token for ${who}, valid ten years.`} variant="primary" disabled={!ok} busy={busy === "grant"}
              onConfirm={() => run("grant", () => tx({ title: "Grant KYC", summary: `Grant KYC to ${t} on ${symbol}'s token, valid for ten years.`, abi: tokenAbi, address: token, functionName: "grantKyc", args: [t, `vc:desk:${t.toLowerCase()}`, now() - 1n, now() + TEN_YEARS, issuer] }))}>
              Grant KYC
            </ConfirmButton>
            <ConfirmButton confirm={`revokeKyc for ${who} on ${symbol}'s token. Transfers involving it will be refused.`} variant="danger" disabled={!ok} busy={busy === "revoke"}
              onConfirm={() => run("revoke", () => tx({ title: "Revoke KYC", summary: `Revoke KYC of ${t} on ${symbol}'s token.`, abi: tokenAbi, address: token, functionName: "revokeKyc", args: [t] }))}>
              Revoke KYC
            </ConfirmButton>
          </>
        )}
        {canFreeze && (
          <>
            <ConfirmButton confirm={`Freeze ${who} on ${symbol}'s token. Its balance stays but cannot move.`} variant="danger" disabled={!ok} busy={busy === "freeze"}
              onConfirm={() => run("freeze", () => tx({ title: "Freeze address", summary: `Freeze ${t} on ${symbol}'s token (setAddressFrozen true).`, abi: tokenAbi, address: token, functionName: "setAddressFrozen", args: [t, true] }))}>
              Freeze address
            </ConfirmButton>
            <ConfirmButton confirm={`Unfreeze ${who} on ${symbol}'s token.`} disabled={!ok} busy={busy === "unfreeze"}
              onConfirm={() => run("unfreeze", () => tx({ title: "Unfreeze address", summary: `Unfreeze ${t} on ${symbol}'s token (setAddressFrozen false).`, abi: tokenAbi, address: token, functionName: "setAddressFrozen", args: [t, false] }))}>
              Unfreeze address
            </ConfirmButton>
          </>
        )}
      </div>
    </div>
  )
}
