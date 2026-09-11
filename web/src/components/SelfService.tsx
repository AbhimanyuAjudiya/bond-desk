import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { getAddress } from "viem"
import { useAccount, useSignMessage } from "wagmi"
import { erc20Abi } from "../config/abi"
import { FAUCET } from "../config/chain"
import { DEP } from "../config/deployments"
import { useEligibility, useHealth } from "../hooks/data"
import { useTx } from "../hooks/useTx"
import { ApiError, api, kycMessage, type KycResult } from "../lib/api"
import { parseUsdc } from "../lib/format"
import { useToasts } from "./Toasts"
import { Button, ConfirmButton, Ext, Note, Panel, TxLink } from "./ui"

const TEN_K = parseUsdc("10000")

/** Everything a judge needs to try the desk with their own wallet: test USDC, HBAR for gas, and KYC on the bond token. */
export function SelfService({ compact }: { compact?: boolean }) {
  const { address } = useAccount()
  const tx = useTx()
  const health = useHealth()
  const elig = useEligibility(address)
  const [busy, setBusy] = useState(false)
  const granted = elig.data?.bonds.every((b) => b.kycGranted) ?? false
  const someGranted = elig.data?.bonds.some((b) => b.kycGranted) ?? false

  const mint = async () => {
    if (!address) return
    setBusy(true)
    try {
      await tx({ title: "Get testnet USDC", summary: "Mint 10,000 test USDC to your wallet (MockUSDC has an open mint).", abi: erc20Abi, address: DEP.settlement, functionName: "mint", args: [address, TEN_K] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Testnet self-service" aside={<span>for the connected wallet</span>}>
      <div className={compact ? "p-4 flex flex-col gap-4" : "p-4 grid gap-4 md:grid-cols-3"}>
        <div className="flex flex-col gap-2">
          <h4 className="text-[13px] font-semibold">1 · HBAR for gas</h4>
          <Note>Every transaction here is paid in HBAR. The Hedera portal faucet gives testnet HBAR to any EVM address.</Note>
          <div><Ext href={FAUCET}>Hedera testnet faucet</Ext></div>
          {elig.data && <Note>Your balance: <span className="num text-fg">{(Number(elig.data.hbarTinybar) / 1e8).toFixed(2)} HBAR</span>{elig.data.hbarSufficientForGas ? "" : " — below the 1 HBAR the desk suggests for a few fills."}</Note>}
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-[13px] font-semibold">2 · Test USDC</h4>
          <Note>The settlement token is a mock USDC with an open <code className="font-mono">mint</code>. Orders are quoted and settled in it.</Note>
          <div><ConfirmButton confirm="Mint 10,000 USDC to your wallet?" onConfirm={mint} busy={busy} disabled={!address}>Get 10,000 test USDC</ConfirmButton></div>
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-[13px] font-semibold">3 · KYC on the bond token</h4>
          <Note>
            The bond is an ATS security token: every transfer is checked on-chain and refused for wallets without KYC. On testnet the compliance officer is a bot that approves anyone who asks;
            in production it is a human or a KYC provider. The point is that the <em>token</em>, not this page, enforces the result.
          </Note>
          {health.data?.kycDesk === false ? (
            <Note className="text-warn">The KYC desk is offline on this API deployment (no officer key configured). A KYC officer can still grant KYC from the Compliance page.</Note>
          ) : (
            <KycDesk granted={granted} someGranted={someGranted} disabled={!address || elig.isLoading} onDone={() => elig.refetch()} />
          )}
        </div>
      </div>
    </Panel>
  )
}

export function KycDesk({ granted, someGranted, disabled, onDone }: { granted: boolean; someGranted: boolean; disabled?: boolean; onDone?: () => void }) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const toasts = useToasts()
  const m = useMutation({
    mutationFn: async (verb: "request" | "revocation") => {
      if (!address) throw new Error("Connect a wallet first.")
      const checksummed = getAddress(address)
      const minute = Math.floor(Date.now() / 60_000)
      const signature = await signMessageAsync({ message: kycMessage(verb, checksummed, minute) })
      const id = toasts.push({ title: verb === "request" ? "Requesting KYC" : "Revoking KYC", state: "pending", detail: "Signature verified by the API; the officer bot is sending the transaction on Hedera…" })
      try {
        const r = await api<KycResult>(`/wallets/${checksummed}/kyc`, { method: verb === "request" ? "POST" : "DELETE", body: JSON.stringify({ minute, signature }) })
        const changed = r.results.filter((x) => x.txHashes.length > 0)
        const hash = changed.at(-1)?.txHashes.at(-1)
        toasts.update(id, { state: "confirmed", hash, detail: changed.length === 0 ? (verb === "request" ? "This wallet already had KYC on every bond token." : "This wallet had no KYC to revoke.") : `${verb === "request" ? "KYC granted" : "KYC revoked"} on ${changed.length} bond token${changed.length > 1 ? "s" : ""} by officer ${r.officer.slice(0, 8)}….` })
        onDone?.()
        return r
      } catch (e) {
        toasts.update(id, { state: "failed", detail: e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e) })
        throw e
      }
    },
  })
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!granted && (
        <ConfirmButton confirm="Sign a message proving you control this wallet; the officer bot then calls grantKyc on the bond token." variant="primary" size="md" onConfirm={() => m.mutateAsync("request").catch(() => {})} busy={m.isPending} disabled={disabled}>
          Request testnet KYC
        </ConfirmButton>
      )}
      {someGranted && (
        <ConfirmButton confirm="Sign a message; the officer bot calls revokeKyc. Fills to or from this wallet will then be refused by the token." variant="danger" onConfirm={() => m.mutateAsync("revocation").catch(() => {})} busy={m.isPending} disabled={disabled}>
          Revoke my KYC
        </ConfirmButton>
      )}
      {granted && <span className="text-[12px] text-ok">KYC granted on every bond token.</span>}
    </div>
  )
}

export const TxHashes = ({ hashes }: { hashes: string[] }) => <span className="inline-flex gap-2">{hashes.map((h) => <TxLink key={h} hash={h} />)}</span>
export { Button }
