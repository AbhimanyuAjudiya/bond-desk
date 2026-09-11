import { useState } from "react"
import { useAccount, useReadContracts } from "wagmi"
import { registryAbi, riskGateAbi } from "../../config/abi"
import { DEP } from "../../config/deployments"
import { ActionBadge, AddressChip, Badge, Button, ConfirmButton, Empty, ErrorNote, KV, Loading, Note, Panel, StatusBadge, Time, TxLink } from "../../components/ui"
import { useRisk, useRoles, useVerdicts } from "../../hooks/data"
import { useTx } from "../../hooks/useTx"
import type { Bond } from "../../lib/api"
import { coverageBand } from "../../lib/coverage"
import { actionName, fmtBps, fmtPrice, fmtTime, sameAddress, statusName } from "../../lib/format"
import { parseVerdictBlob, toVerdict, verifyVerdict, type VerdictJson } from "../../lib/verdict"

export function Risk({ bond }: { bond: Bond }) {
  const id = BigInt(bond.id)
  const risk = useRisk(bond.id)
  const verdicts = useVerdicts(bond.id)
  const roles = useRoles(bond.terms.issuer, bond.token)
  const { address } = useAccount()
  const q = useReadContracts({
    contracts: [
      { abi: riskGateAbi, address: DEP.riskGate, functionName: "snapshot", args: [id] },
      { abi: riskGateAbi, address: DEP.riskGate, functionName: "signer" },
      { abi: riskGateAbi, address: DEP.riskGate, functionName: "freshness" },
      { abi: registryAbi, address: DEP.registry, functionName: "status", args: [id] },
      { abi: riskGateAbi, address: DEP.riskGate, functionName: "lastVerdict", args: [id] },
    ],
    query: { refetchInterval: 12_000 },
  })
  const snap = q.data?.[0]?.result as { coverageBps: bigint; feedFresh: boolean; status: number; mark: bigint; collateral: bigint; lastNonce: bigint; lastAction: number; nextCoupon: bigint; maturity: bigint; timestamp: bigint } | undefined
  const signer = q.data?.[1]?.result as `0x${string}` | undefined
  const freshness = q.data?.[2]?.result as bigint | undefined
  const status = statusName((q.data?.[3]?.result as number | undefined) ?? bond.terms.status)
  const last = q.data?.[4]?.result as readonly [bigint, number, bigint, bigint, bigint] | undefined
  const lastRow = risk.data?.lastVerdict
  const tx = useTx()
  const [busy, setBusy] = useState(false)
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px] items-start">
      <div className="flex flex-col gap-5 min-w-0">
        <Panel title="Risk gate" aside={<StatusBadge status={status} />}>
          {q.isLoading && <Loading rows={4} />}
          {q.isError && <ErrorNote error={q.error} />}
          {snap && (
            <div className="p-4 grid gap-4 md:grid-cols-2">
              <KV rows={[
                ["Registry status", <StatusBadge status={status} />],
                ["Coverage", snap.feedFresh ? <>{fmtBps(snap.coverageBps)} <Badge tone={coverageBand(snap.coverageBps, 300n).tone}>{coverageBand(snap.coverageBps, 300n).label}</Badge></> : "feed stale"],
                ["Oracle mark", `${fmtPrice(snap.mark)} USDC`],
                ["Chain time", <Time unix={snap.timestamp} />],
              ]} />
              <KV rows={[
                ["Last verdict", last && last[4] !== 0n ? <><ActionBadge action={actionName(last[1])} /> nonce {String(last[4])}</> : "none yet"],
                ["Coverage observed", last && last[4] !== 0n ? fmtBps(last[2]) : "—"],
                ["Issued at", last && last[4] !== 0n ? <Time unix={last[3]} /> : "—"],
                ["Relayer", lastRow ? <AddressChip address={verdicts.data?.verdicts[0]?.relayer ?? DEP.deployer} /> : "—"],
                ["Trusted signer", signer ? <AddressChip address={signer} /> : "…"],
                ["Freshness window", freshness !== undefined ? `${Number(freshness)} s` : "…"],
              ]} />
              <p className="md:col-span-2 text-[13px] leading-relaxed">
                {status === "Frozen" && <>Trading is halted: a FREEZE verdict moved the bond to Frozen. The desk admin lifts it after the issuer restores coverage; verdicts never unfreeze on their own.</>}
                {status === "Active" && last && last[1] === 2 && <>The last verdict was a FREEZE and the admin has since unfrozen the bond; it trades normally until the next verdict says otherwise.</>}
                {status === "Active" && (!last || last[1] !== 2) && <>The bond trades normally. The enclave watches coverage against its private thresholds and signs OK, WARN, FREEZE or DEFAULT; only the last two change state on chain.</>}
                {status === "Defaulted" && <>A DEFAULT verdict seized the collateral; holders claim it pro-rata from the vault.</>}
                {status === "Matured" && <>The bond has matured; verdicts no longer change its state.</>}
              </p>
            </div>
          )}
        </Panel>
        <Panel title="Verdict history" aside={<span>VerdictApplied events, newest first</span>}>
          {verdicts.isLoading && <Loading rows={3} />}
          {verdicts.isError && <ErrorNote error={verdicts.error} />}
          {verdicts.data && verdicts.data.verdicts.length === 0 && <Empty>No verdict has been applied to this bond yet.</Empty>}
          {verdicts.data && verdicts.data.verdicts.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Applied</th><th>Action</th><th className="text-right">Coverage observed</th><th className="text-right">Nonce</th><th>Relayer</th><th>Tx</th></tr></thead>
                <tbody>
                  {verdicts.data.verdicts.map((v) => (
                    <tr key={v.txHash + v.nonce}>
                      <td className="whitespace-nowrap"><Time unix={v.timestamp} /></td>
                      <td><ActionBadge action={v.action} /></td>
                      <td className="num text-right">{fmtBps(v.coverageObserved)}</td>
                      <td className="num text-right">{v.nonce}</td>
                      <td><AddressChip address={v.relayer} me={sameAddress(v.relayer, address)} /></td>
                      <td><TxLink hash={v.txHash} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <div className="flex flex-col gap-5">
        <Panel title="Admin" aside={roles.isAdmin ? <span>you are the desk admin</span> : <span>desk admin only</span>}>
          {roles.isAdmin ? (
            <div className="p-4 flex flex-col gap-2">
              <Note>{status === "Frozen" ? "Unfreeze returns the bond to Active. Do it once the issuer has restored coverage; the next verdict can freeze it again." : `The bond is ${status}; unfreeze only applies to Frozen bonds (NotFrozen otherwise).`}</Note>
              <div><ConfirmButton variant="primary" disabled={status !== "Frozen"} busy={busy} confirm={`Set bond #${bond.id} back to Active?`} onConfirm={async () => { setBusy(true); try { await tx({ title: "Unfreeze bond", summary: `Move bond #${bond.id} from Frozen to Active.`, abi: riskGateAbi, address: DEP.riskGate, functionName: "unfreeze", args: [id] }) } finally { setBusy(false) } }}>Unfreeze</ConfirmButton></div>
            </div>
          ) : <Empty>Unfreeze is shown to the registry admin.</Empty>}
        </Panel>
        <Relayer bond={bond} signer={signer} lastNonce={snap?.lastNonce} />
      </div>
    </div>
  )
}

/** Anyone may relay a signed verdict: paste the VERDICT_JSON line from the CRE workflow, check it locally, submit. */
function Relayer({ bond, signer, lastNonce }: { bond: Bond; signer?: `0x${string}`; lastNonce?: bigint }) {
  const tx = useTx()
  const { address } = useAccount()
  const [text, setText] = useState("")
  const [parsed, setParsed] = useState<VerdictJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verified, setVerified] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setParsed(null); setVerified(null); setError(null)
    try {
      const j = parseVerdictBlob(text)
      setParsed(j)
      if (!signer) { setError("RiskGate.signer() is not loaded yet."); return }
      setVerified(await verifyVerdict(j, signer))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const problems: string[] = []
  if (parsed) {
    if (parsed.chainId !== DEP.chainId) problems.push(`chainId ${parsed.chainId} is not ${DEP.chainId}`)
    if (!sameAddress(parsed.riskGate, DEP.riskGate)) problems.push(`riskGate ${parsed.riskGate} is not this deployment's RiskGate`)
    if (parsed.verdict.bondId !== bond.id) problems.push(`bondId ${parsed.verdict.bondId} is not this bond`)
    if (lastNonce !== undefined && BigInt(parsed.verdict.nonce) <= lastNonce) problems.push(`nonce ${parsed.verdict.nonce} is not above the last applied nonce ${lastNonce}`)
    if (parsed.txHash) problems.push("this verdict was already delivered directly (txHash present)")
  }
  const submit = async () => {
    if (!parsed) return
    setBusy(true)
    try {
      await tx({ title: `Relay ${actionName(parsed.verdict.action)} verdict`, summary: `Submit verdict nonce ${parsed.verdict.nonce} (${actionName(parsed.verdict.action)}, coverage observed ${fmtBps(parsed.verdict.coverageObserved)}) to RiskGate; the contract re-checks the signature, nonce and freshness.`, abi: riskGateAbi, address: DEP.riskGate, functionName: "submit", args: [toVerdict(parsed.verdict), parsed.signature], gas: 500_000n })
    } finally { setBusy(false) }
  }
  return (
    <Panel title="Relayer" aside={<span>anyone can relay</span>}>
      <div className="p-4 flex flex-col gap-3">
        <Note>Hedera is not a CRE-supported chain, so the enclave's signed verdict is carried here by hand. Paste the <code className="font-mono">VERDICT_JSON</code> line from the workflow log; the signature is checked locally against RiskGate's trusted signer before anything is sent. A relayer only pays gas: it can neither forge nor replay a verdict.</Note>
        <label className="label" htmlFor="verdict">VERDICT_JSON</label>
        <textarea id="verdict" className="input h-28 py-1.5 font-mono text-[12px] leading-snug" placeholder='VERDICT_JSON {"verdict":{"bondId":"1","action":2,...},"signature":"0x…","chainId":296,"riskGate":"0x…","txHash":null}' value={text} onChange={(e) => { setText(e.target.value); setParsed(null); setVerified(null) }} spellCheck={false} />
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={check} disabled={!text.trim()}>Parse and verify</Button>
          {verified === true && <Badge tone="ok">signature valid for {signer?.slice(0, 8)}…</Badge>}
          {verified === false && <Badge tone="bad">signature does not match the trusted signer</Badge>}
        </div>
        {error && <Note className="text-bad">{error}</Note>}
        {parsed && (
          <div className="flex flex-col gap-2">
            <KV rows={[
              ["Bond", `#${parsed.verdict.bondId}`],
              ["Action", <ActionBadge action={actionName(parsed.verdict.action)} />],
              ["Coverage observed", fmtBps(parsed.verdict.coverageObserved)],
              ["Issued at", fmtTime(parsed.verdict.issuedAt).local],
              ["Nonce", `${parsed.verdict.nonce}${lastNonce !== undefined ? ` (last applied ${lastNonce})` : ""}`],
              ["RiskGate", <AddressChip address={parsed.riskGate} kind="contract" />],
            ]} />
            {problems.length > 0 && <ul className="text-[13px] text-warn list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <div>
              <ConfirmButton variant="primary" disabled={!address || verified !== true || problems.length > 0} busy={busy} confirm={`Send RiskGate.submit with nonce ${parsed.verdict.nonce}? ${actionName(parsed.verdict.action) === "FREEZE" ? "This halts trading." : actionName(parsed.verdict.action) === "DEFAULT" ? "This seizes the collateral." : "OK/WARN are recorded only."}`} onConfirm={submit}>
                Submit verdict
              </ConfirmButton>
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
