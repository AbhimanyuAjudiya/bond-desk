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

/** Everything a new wallet needs, in one row: HBAR for gas, test USDC, and KYC on the bond tokens. */
export function SelfService() {
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
    <Panel title="Testnet self-service" aside={<span>for the connected wallet · nothing here is real money</span>}>
      <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <span className="label">1 · HBAR for gas</span>
          <Note>Every transaction is paid in HBAR. The portal faucet funds any EVM address.</Note>
          <div className="flex items-center gap-3">
            <Ext href={FAUCET} className="text-[12px]">Hedera faucet</Ext>
            {elig.data && <span className="text-[11px] text-muted">balance <span className="num text-fg">{(Number(elig.data.hbarTinybar) / 1e8).toFixed(2)}</span> HBAR{elig.data.hbarSufficientForGas ? "" : ", low"}</span>}
          </div>
        </div>
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <span className="label">2 · Test USDC</span>
          <Note>The settlement token is a mock USDC with an open mint. Orders are quoted and settled in it.</Note>
          <div><ConfirmButton size="sm" confirm="Mint 10,000 USDC to your wallet?" onConfirm={mint} busy={busy} disabled={!address}>Get 10,000 test USDC</ConfirmButton></div>
        </div>
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <span className="label">3 · KYC on the bond tokens</span>
          <Note>Each bond is an ATS security token that refuses transfers for wallets without KYC. On testnet the officer is a bot that approves anyone; the token still does the enforcing.</Note>
          {health.data?.kycDesk === false ? (
            <Note className="text-warn">The KYC desk is offline on this deployment (no officer key). An officer can still grant KYC from the Compliance page.</Note>
          ) : (
            <KycDesk granted={granted} someGranted={someGranted} disabled={!address || elig.isLoading} onDone={() => elig.refetch()} size="sm" />
          )}
        </div>
      </div>
    </Panel>
  )
}

export function KycDesk({ granted, someGranted, disabled, onDone, size = "md" }: { granted: boolean; someGranted: boolean; disabled?: boolean; onDone?: () => void; size?: "sm" | "md" }) {
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
        <ConfirmButton confirm="Sign a message proving you control this wallet; the officer bot then calls grantKyc on every bond token." variant="primary" size={size} onConfirm={() => m.mutateAsync("request").catch(() => {})} busy={m.isPending} disabled={disabled}>
          Request testnet KYC
        </ConfirmButton>
      )}
      {someGranted && (
        <ConfirmButton confirm="Sign a message; the officer bot calls revokeKyc. Fills to or from this wallet will then be refused by the token." variant="danger" size={size} onConfirm={() => m.mutateAsync("revocation").catch(() => {})} busy={m.isPending} disabled={disabled}>
          Revoke my KYC
        </ConfirmButton>
      )}
      {granted && <span className="text-[11px] text-ok">KYC granted on every bond token.</span>}
    </div>
  )
}

export const TxHashes = ({ hashes }: { hashes: string[] }) => <span className="inline-flex gap-2">{hashes.map((h) => <TxLink key={h} hash={h} />)}</span>
export { Button }
