import { useState, type FormEvent } from "react"
import { isAddress, type Address } from "viem"
import { useAccount, useReadContracts } from "wagmi"
import { erc20Abi, tokenAbi } from "../config/abi"
import { DEP } from "../config/deployments"
import { AddressChip, Badge, Button, ConfirmButton, ErrorNote, Field, Input, KV, Loading, Note, Panel } from "../components/ui"
import { useBonds, useEligibility, useRoles } from "../hooks/data"
import { useTx } from "../hooks/useTx"
import { fmtInt, fmtUsdc, sameAddress } from "../lib/format"

const TEN_YEARS = 3650n * 86_400n

export function Compliance() {
  const { address: me } = useAccount()
  const bonds = useBonds()
  const issuer = DEP.deployer
  const roles = useRoles(issuer)
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
      <div>
        <h1 className="text-[30px] leading-none">Compliance</h1>
        <p className="note mt-1.5 max-w-[72ch]">
          KYC and freezes live on the ATS bond token, not in this app. The token answers every transfer with an EIP-1066 code, and the market refuses a fill before any money moves when that answer is not "allowed".
        </p>
      </div>

      <Panel title="Check a wallet">
        <form className="p-4 flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={lookup}>
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
        {subject && <WalletReport address={subject} me={me} />}
      </Panel>

      <Panel title="Officer actions" aside={<span>{roles.isKycOfficer || roles.isFreezeManager ? "your wallet holds ATS roles on the bond token" : "requires ATS roles on the bond token"}</span>}>
        {!me && <Note className="p-4">Connect the compliance officer wallet to grant or revoke KYC and to freeze or unfreeze addresses.</Note>}
        {me && roles.loading && <Loading rows={2} />}
        {me && !roles.loading && !roles.isKycOfficer && !roles.isFreezeManager && (
          <Note className="p-4">
            <AddressChip address={me} /> holds neither the KYC role nor the freeze-manager role on the bond token, so these actions are hidden. On the demo bond the compliance officer holds KYC, freeze and pause; the issuer also holds KYC. Wallets can request their own testnet KYC from the Desk page.
          </Note>
        )}
        {me && (roles.isKycOfficer || roles.isFreezeManager) && (
          <div className="p-4 flex flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {roles.isKycOfficer && <Badge tone="ok">KYC role</Badge>}
              {roles.isFreezeManager && <Badge tone="ok">Freeze manager</Badge>}
              {roles.isPauser && <Badge tone="ok">Pauser</Badge>}
              {roles.isAdmin && <Badge tone="neutral">Desk admin</Badge>}
            </div>
            <OfficerActions subject={subject} issuer={bonds.data?.bonds[0] ? DEP.deployer : issuer} canKyc={roles.isKycOfficer} canFreeze={roles.isFreezeManager} />
          </div>
        )}
      </Panel>
    </>
  )
}

function WalletReport({ address, me }: { address: Address; me?: Address }) {
  const elig = useEligibility(address)
  const q = useReadContracts({
    contracts: [
      { abi: tokenAbi, address: DEP.token, functionName: "getKycStatusFor", args: [address] },
      { abi: tokenAbi, address: DEP.token, functionName: "isFrozen", args: [address] },
      { abi: tokenAbi, address: DEP.token, functionName: "balanceOf", args: [address] },
      { abi: erc20Abi, address: DEP.settlement, functionName: "balanceOf", args: [address] },
      { abi: tokenAbi, address: DEP.token, functionName: "canTransferFrom", args: [DEP.deployer, address, 1n, "0x"] },
      { abi: tokenAbi, address: DEP.token, functionName: "paused" },
    ],
    account: DEP.market, // the probe asks as the market does: the market is the operator canTransferFrom judges
    query: { refetchInterval: 15_000 },
  })
  if (q.isLoading) return <Loading rows={4} />
  if (q.isError) return <ErrorNote error={q.error} />
  const kyc = q.data?.[0]?.result === 1
  const frozen = q.data?.[1]?.result === true
  const bondBal = (q.data?.[2]?.result as bigint | undefined) ?? 0n
  const usdc = (q.data?.[3]?.result as bigint | undefined) ?? 0n
  const probe = q.data?.[4]?.result as readonly [boolean, `0x${string}`, `0x${string}`] | undefined
  const paused = q.data?.[5]?.result === true
  return (
    <div className="px-4 pb-4 grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><AddressChip address={address} me={sameAddress(address, me)} /></div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={kyc ? "ok" : "bad"}>{kyc ? "KYC granted" : "no KYC"}</Badge>
          <Badge tone={frozen ? "bad" : "ok"}>{frozen ? "frozen" : "not frozen"}</Badge>
          {paused && <Badge tone="warn">token paused</Badge>}
        </div>
        <KV rows={[
          ["Bond balance", `${fmtInt(bondBal)} BDB27`],
          ["USDC balance", `${fmtUsdc(usdc)} USDC`],
          ["Hedera account", elig.data?.hederaAccount ?? (elig.isLoading ? "…" : "none")],
          ["HBAR", elig.data ? (Number(elig.data.hbarTinybar) / 1e8).toFixed(4) : "…"],
        ]} />
      </div>
      <div className="flex flex-col gap-2 text-[13px]">
        <span className="label">Compliance decision</span>
        <p className="leading-relaxed">
          {kyc && !frozen && !paused && <>The token would <strong>allow</strong> a transfer of one bond from the issuer to this wallet{probe ? <> (code {probe[1]})</> : null}. It is KYC-granted and not frozen.</>}
          {!kyc && <>The token would <strong>refuse</strong> a transfer to this wallet because its KYC status is not granted{probe ? <> (code {probe[1]}, reason selector {probe[2].slice(0, 10)})</> : null}. The market's fill would revert with ComplianceRejected before any USDC moved.</>}
          {kyc && frozen && <>The token would <strong>refuse</strong> transfers involving this wallet: it is frozen by the freeze manager{probe ? <> (code {probe[1]})</> : null}.</>}
          {kyc && !frozen && paused && <>The token is paused, so every transfer is refused right now{probe ? <> (code {probe[1]})</> : null}.</>}
        </p>
        <Note>Probe: canTransferFrom(issuer → this wallet, 1 bond) as answered by the token itself.</Note>
      </div>
    </div>
  )
}

function OfficerActions({ subject, issuer, canKyc, canFreeze }: { subject?: Address; issuer: Address; canKyc: boolean; canFreeze: boolean }) {
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
            <ConfirmButton confirm={`Call grantKyc on the bond token for ${t.slice(0, 10)}… (valid ten years)?`} variant="primary" disabled={!ok} busy={busy === "grant"}
              onConfirm={() => run("grant", () => tx({ title: "Grant KYC", summary: `Grant KYC to ${t} on the bond token, valid for ten years.`, abi: tokenAbi, address: DEP.token, functionName: "grantKyc", args: [t, `vc:desk:${t.toLowerCase()}`, now() - 1n, now() + TEN_YEARS, issuer] }))}>
              Grant KYC
            </ConfirmButton>
            <ConfirmButton confirm={`Call revokeKyc for ${t.slice(0, 10)}…? Transfers involving it will be refused.`} variant="danger" disabled={!ok} busy={busy === "revoke"}
              onConfirm={() => run("revoke", () => tx({ title: "Revoke KYC", summary: `Revoke KYC of ${t} on the bond token.`, abi: tokenAbi, address: DEP.token, functionName: "revokeKyc", args: [t] }))}>
              Revoke KYC
            </ConfirmButton>
          </>
        )}
        {canFreeze && (
          <>
            <ConfirmButton confirm={`Freeze ${t.slice(0, 10)}… on the bond token? Its balance stays but cannot move.`} variant="danger" disabled={!ok} busy={busy === "freeze"}
              onConfirm={() => run("freeze", () => tx({ title: "Freeze address", summary: `Freeze ${t} on the bond token (setAddressFrozen true).`, abi: tokenAbi, address: DEP.token, functionName: "setAddressFrozen", args: [t, true] }))}>
              Freeze address
            </ConfirmButton>
            <ConfirmButton confirm={`Unfreeze ${t.slice(0, 10)}…?`} disabled={!ok} busy={busy === "unfreeze"}
              onConfirm={() => run("unfreeze", () => tx({ title: "Unfreeze address", summary: `Unfreeze ${t} on the bond token (setAddressFrozen false).`, abi: tokenAbi, address: DEP.token, functionName: "setAddressFrozen", args: [t, false] }))}>
              Unfreeze address
            </ConfirmButton>
          </>
        )}
      </div>
    </div>
  )
}
