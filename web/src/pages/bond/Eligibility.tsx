import { useAccount, useReadContracts } from "wagmi"
import { tokenAbi } from "../../config/abi"
import { FAUCET } from "../../config/chain"
import { KycDesk } from "../../components/SelfService"
import { AddressChip, Badge, Empty, ErrorNote, Ext, KV, Loading, Note, Panel } from "../../components/ui"
import { useEligibility, useHealth } from "../../hooks/data"
import type { Bond } from "../../lib/api"
import { explainReason, isAllowanceOnly } from "../../lib/errors"
import { fmtInt } from "../../lib/format"

/** The connected wallet's standing with this bond's token, spelled out, plus the testnet KYC desk. */
export function Eligibility({ bond }: { bond: Bond }) {
  const { address } = useAccount()
  const elig = useEligibility(address)
  const health = useHealth()
  const q = useReadContracts({
    contracts: address
      ? [
          { abi: tokenAbi, address: bond.token, functionName: "getKycStatusFor", args: [address] },
          { abi: tokenAbi, address: bond.token, functionName: "isInControlList", args: [address] },
          { abi: tokenAbi, address: bond.token, functionName: "balanceOf", args: [address] },
          { abi: tokenAbi, address: bond.token, functionName: "canTransferFrom", args: [bond.terms.issuer, address, 1n, "0x"] },
          { abi: tokenAbi, address: bond.token, functionName: "canTransferFrom", args: [address, bond.terms.issuer, 1n, "0x"] },
          { abi: tokenAbi, address: bond.token, functionName: "paused" },
        ]
      : [],
    query: { enabled: !!address, refetchInterval: 15_000 },
  })
  if (!address) return <Panel title="Eligibility"><Empty>Connect a wallet to see whether this bond's token will accept transfers to it.</Empty></Panel>
  if (q.isLoading) return <Panel title="Eligibility"><Loading /></Panel>
  if (q.isError) return <Panel title="Eligibility"><ErrorNote error={q.error} /></Panel>
  const kyc = q.data?.[0]?.result === 1
  const frozen = q.data?.[1]?.result === true
  const balance = (q.data?.[2]?.result as bigint | undefined) ?? 0n
  const inbound = q.data?.[3]?.result as readonly [boolean, `0x${string}`, `0x${string}`] | undefined
  const outbound = q.data?.[4]?.result as readonly [boolean, `0x${string}`, `0x${string}`] | undefined
  const paused = q.data?.[5]?.result === true
  const mine = elig.data?.bonds.find((b) => b.bondId === bond.id)
  const hasAccount = elig.data ? elig.data.hederaAccount !== null : true
  const decision = (probe: typeof inbound, what: string) =>
    !probe ? null : probe[0]
      ? <>The token <strong>allows</strong> {what} (code {probe[1]}, allowed).</>
      : isAllowanceOnly(probe[2])
        ? <>The token's compliance checks <strong>pass</strong> for {what}: KYC granted, not frozen, not paused. Its last check, the operator's allowance, is the market's to hold (the issuer approved it), so a fill through the market goes ahead; this read-only probe has no operator, hence code {probe[1]}.</>
        : <>The token <strong>refuses</strong> {what}: {explainReason(probe[2])} (code {probe[1]}).</>
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
      <Panel title="Your standing with this bond" aside={<AddressChip address={address} />}>
        <div className="p-3 flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={kyc ? "ok" : "bad"}>{kyc ? "KYC granted" : "no KYC"}</Badge>
            <Badge tone={frozen ? "bad" : "ok"}>{frozen ? "frozen" : "not frozen"}</Badge>
            <Badge tone={hasAccount ? "ok" : "warn"}>{hasAccount ? "Hedera account" : "no Hedera account"}</Badge>
            <Badge tone={bond.status === "Active" ? "ok" : "warn"}>bond {bond.status}</Badge>
            {paused && <Badge tone="warn">token paused</Badge>}
          </div>
          <KV rows={[
            ["Bond balance", `${fmtInt(balance)} ${bond.symbol}`],
            ["Hedera account", elig.data?.hederaAccount ?? (elig.isLoading ? "…" : "none yet")],
            ["HBAR for gas", elig.data ? `${(Number(elig.data.hbarTinybar) / 1e8).toFixed(4)} HBAR${elig.data.hbarSufficientForGas ? "" : " (low)"}` : "…"],
          ]} />
          <div className="text-[12px] leading-snug flex flex-col gap-1.5">
            <p>{decision(inbound, `a transfer of one ${bond.symbol} from the issuer to you`)}</p>
            <p>{decision(outbound, `a transfer of one ${bond.symbol} from you to the issuer`)}</p>
            {mine && !mine.canHold && mine.reason === "bond-not-active" && <p>KYC is in place, but the bond is not Active, so the market will refuse fills until a risk verdict or the admin reopens it.</p>}
            {!hasAccount && <p>This address has never received HBAR, so Hedera does not know it as an account yet; fund it from the faucet before anything else.</p>}
          </div>
          <Note>Read live from the token: getKycStatusFor, isInControlList (what setAddressFrozen sets) and canTransferFrom(from, to, 1, ""). The market runs the same canTransferFrom before it moves a single unit of USDC.</Note>
        </div>
      </Panel>
      <Panel title="Testnet KYC desk">
        <div className="p-3 flex flex-col gap-3">
          <Note>
            On testnet the compliance officer is a bot that approves anyone who asks: you sign a message, the API verifies it and the officer key calls grantKyc on the token with the same arguments the issuance script used.
            In production the officer is a human or a KYC provider. Either way, the token enforces the result at every transfer; this page only asks.
          </Note>
          {health.data?.kycDesk === false ? (
            <Note className="text-warn">The KYC desk is offline on this API deployment (no officer key configured).</Note>
          ) : (
            <KycDesk granted={kyc} someGranted={kyc} disabled={elig.isLoading} onDone={() => { elig.refetch(); q.refetch() }} />
          )}
          {!hasAccount && <Note>Need HBAR first? <Ext href={FAUCET}>Hedera testnet faucet</Ext></Note>}
        </div>
      </Panel>
    </div>
  )
}
