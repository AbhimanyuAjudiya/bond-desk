import { useState } from "react"
import { useAccount, useReadContracts } from "wagmi"
import { oracleAbi, tokenAbi, vaultAbi } from "../../config/abi"
import { GAS } from "../../config/chain"
import { DEP } from "../../config/deployments"
import { Badge, ConfirmButton, Empty, Field, Input, KV, Loading, Note, Panel } from "../../components/ui"
import { useRoles } from "../../hooks/data"
import { useTx } from "../../hooks/useTx"
import type { Bond } from "../../lib/api"
import { coverageBand, gaugeFraction } from "../../lib/coverage"
import { fmtBps, fmtHbar, fmtUsd8, fmtUsdc, parseTinybar, parseWeibar } from "../../lib/format"

export function Collateral({ bond }: { bond: Bond }) {
  const id = BigInt(bond.id)
  const roles = useRoles(bond.terms.issuer, bond.token)
  const q = useReadContracts({
    contracts: [
      { abi: vaultAbi, address: DEP.vault, functionName: "collateral", args: [id] },
      { abi: vaultAbi, address: DEP.vault, functionName: "coverageBps", args: [id] },
      { abi: vaultAbi, address: DEP.vault, functionName: "minCoverageBps" },
      { abi: oracleAbi, address: DEP.oracle, functionName: "hbarUsd" },
      { abi: tokenAbi, address: bond.token, functionName: "totalSupply" },
      { abi: vaultAbi, address: DEP.vault, functionName: "seizures", args: [id] },
    ],
    query: { refetchInterval: 12_000 },
  })
  if (q.isLoading) return <Panel title="Collateral"><Loading /></Panel>
  const collateral = (q.data?.[0]?.result as bigint | undefined) ?? 0n
  const coverage = q.data?.[1]?.status === "success" ? (q.data[1].result as bigint) : null
  const min = (q.data?.[2]?.result as bigint | undefined) ?? 0n
  const price = q.data?.[3]?.status === "success" ? (q.data[3].result as bigint) : null
  const supply = (q.data?.[4]?.result as bigint | undefined) ?? 0n
  const seizure = q.data?.[5]?.result as readonly [bigint, bigint] | undefined
  const band = coverageBand(coverage, min)
  const principal = (supply * BigInt(bond.faceValue)) / 10n ** BigInt(bond.terms.bondDecimals)
  // tinybar (1e8) * price8 (1e8) -> USDC (1e6): same formula as CollateralVault.coverageBps
  const collateralUsd = price === null ? null : (collateral * price * 10n ** BigInt(bond.terms.settlementDecimals)) / 10n ** 16n
  const frac = gaugeFraction(coverage, min)
  const tone = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", neutral: "var(--neutral)" }[band.tone]
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
      <div className="flex flex-col gap-3 min-w-0">
        <Panel title="Coverage" aside={<Badge tone={band.tone}>{band.label}</Badge>}>
          <div className="p-3 flex flex-col gap-4">
            <div className="flex items-baseline gap-3">
              <span className="num text-[34px] leading-none" style={{ color: tone }}>{coverage === null ? "—" : fmtBps(coverage)}</span>
              <span className="text-[12px] text-muted">collateral value ÷ outstanding principal</span>
            </div>
            <svg viewBox="0 0 600 34" className="w-full h-9" role="img" aria-label={`Coverage gauge: ${band.label}`}>
              <rect x="0" y="12" width="200" height="10" rx="2" fill="var(--bad-soft)" />
              <rect x="200" y="12" width="200" height="10" fill="var(--warn-soft)" />
              <rect x="400" y="12" width="200" height="10" rx="2" fill="var(--ok-soft)" />
              {coverage !== null && <rect x={Math.max(0, frac * 600 - 3)} y="6" width="6" height="22" rx="1" fill={tone} />}
              <text x="200" y="32" fontSize="10" textAnchor="middle" fill="var(--muted)" className="num">floor {fmtBps(min, 0)}</text>
              <text x="400" y="32" fontSize="10" textAnchor="middle" fill="var(--muted)" className="num">2× floor {fmtBps(min * 2n, 0)}</text>
              <text x="598" y="32" fontSize="10" textAnchor="end" fill="var(--muted)" className="num">100%</text>
            </svg>
            <p className="text-[12px] leading-snug">{band.sentence} Bands follow the vault's public withdrawal floor; the enclave's own WARN, FREEZE and DEFAULT thresholds are private and only visible through the verdicts it signs.</p>
            <KV rows={[
              ["Collateral", `${fmtHbar(collateral)} HBAR${collateralUsd !== null ? ` ≈ ${fmtUsdc(collateralUsd)} USD` : ""}`],
              ["HBAR/USD mark", price === null ? "feed stale" : fmtUsd8(price)],
              ["Outstanding principal", `${fmtUsdc(principal)} USDC`],
              ["Withdrawal floor", `${fmtBps(min)} coverage`],
              ["Seized", seizure && seizure[0] !== 0n ? `${fmtHbar(seizure[1])} HBAR at snapshot ${seizure[0]}` : "no"],
            ]} />
            <Note>Collateral is native HBAR held by CollateralVault in tinybar (8 decimals). The JSON-RPC relay expresses value in 18-decimal weibar, so a 1 HBAR deposit is sent as 10^18 and stored as 10^8.</Note>
          </div>
        </Panel>
      </div>
      {roles.isIssuer ? <IssuerCollateral bond={bond} collateral={collateral} coverage={coverage} min={min} /> : (
        <Panel title="Issuer panel"><Empty>Deposits and withdrawals are shown to the issuer wallet ({bond.terms.issuer.slice(0, 8)}…). Anyone can watch coverage here.</Empty></Panel>
      )}
    </div>
  )
}

function IssuerCollateral({ bond, collateral, coverage, min }: { bond: Bond; collateral: bigint; coverage: bigint | null; min: bigint }) {
  const { address } = useAccount()
  const tx = useTx()
  const [dep, setDep] = useState("1")
  const [wd, setWd] = useState("1")
  const [busy, setBusy] = useState<string | null>(null)
  const id = BigInt(bond.id)
  const run = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); try { await fn() } finally { setBusy(null) } }
  const valid = (s: string) => /^\d+(\.\d{1,8})?$/.test(s.trim()) && Number(s) > 0
  const wdTiny = valid(wd) ? parseTinybar(wd) : 0n
  const afterBps = coverage !== null && collateral > 0n && wdTiny <= collateral ? (coverage * (collateral - wdTiny)) / collateral : null
  return (
    <Panel title="Issuer" aside={<span>you are the issuer</span>}>
      <div className="p-3 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Field label="Deposit collateral (HBAR)" htmlFor="dep" hint="Allowed while Active or Frozen; topping up is how a freeze gets lifted.">
            <Input id="dep" className="num" inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} />
          </Field>
          <ConfirmButton variant="primary" disabled={!valid(dep) || !address} busy={busy === "dep"} confirm={`Send ${dep} HBAR to the vault for bond #${bond.id}?`}
            onConfirm={() => run("dep", () => tx({ title: "Deposit collateral", summary: `Deposit ${dep} HBAR (${parseWeibar(dep).toString()} weibar on the relay, ${parseTinybar(dep).toString()} tinybar on chain) into bond #${bond.id}'s collateral.`, abi: vaultAbi, address: DEP.vault, functionName: "deposit", args: [id], value: parseWeibar(dep) }))}>
            Deposit {valid(dep) ? dep : "…"} HBAR
          </ConfirmButton>
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Field label="Withdraw collateral (HBAR)" htmlFor="wd" hint={afterBps !== null ? `coverage after: about ${fmtBps(afterBps)} (floor ${fmtBps(min)})` : `vault holds ${fmtHbar(collateral)} HBAR`}>
            <Input id="wd" className="num" inputMode="decimal" value={wd} onChange={(e) => setWd(e.target.value)} />
          </Field>
          {afterBps !== null && afterBps < min && <Note className="text-warn">That would drop coverage under the floor; the vault will revert with CoverageTooLow.</Note>}
          <ConfirmButton disabled={!valid(wd) || !address || wdTiny > collateral} busy={busy === "wd"} confirm={`Withdraw ${wd} HBAR from the vault (gas limit 400,000: the relay under-estimates value transfers)?`}
            onConfirm={() => run("wd", () => tx({ title: "Withdraw collateral", summary: `Withdraw ${wd} HBAR (${wdTiny.toString()} tinybar) of collateral from bond #${bond.id} to your wallet.`, abi: vaultAbi, address: DEP.vault, functionName: "withdraw", args: [id, wdTiny], gas: GAS.vaultWithdraw }))}>
            Withdraw {valid(wd) ? wd : "…"} HBAR
          </ConfirmButton>
          <Note>Withdrawals are allowed while Active or Matured and only down to the coverage floor. The transaction is sent with gas 400,000 because hashio's eth_estimateGas under-estimates calls that forward native value.</Note>
        </div>
      </div>
    </Panel>
  )
}
