import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import type { Abi, Address, ContractFunctionArgs, ContractFunctionName, Hex } from "viem"
import { useAccount, useConfig } from "wagmi"
import { getPublicClient, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions"
import { useToasts } from "../components/Toasts"
import { explainError } from "../lib/errors"

export type TxSpec<abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">> = {
  title: string
  /** What the transaction will do, in one sentence; shown while signing and kept in the tray. */
  summary: string
  abi: abi
  address: Address
  functionName: fn
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", fn>
  value?: bigint
  /** Explicit gas limit where hashio's eth_estimateGas is wrong. */
  gas?: bigint
  /** Calls that reach Hedera system contracts cannot be simulated through eth_call. */
  skipSimulation?: boolean
}
export type TxResult = { hash: Hex; status: "success" | "reverted" } | null

/**
 * One pipeline for every write: simulate (decoded revert → sentence, nothing signed), send, wait, refresh every query.
 * Returns null when the transaction did not happen (rejected, reverted in simulation); the toast already says why.
 */
export function useTx() {
  const config = useConfig()
  const { address } = useAccount()
  const toasts = useToasts()
  const qc = useQueryClient()
  return useCallback(
    async <abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">>(spec: TxSpec<abi, fn>): Promise<TxResult> => {
      if (!address) {
        toasts.push({ title: spec.title, state: "failed", detail: "Connect a wallet first." })
        return null
      }
      const id = toasts.push({ title: spec.title, state: "signing", detail: spec.summary })
      // The connector's own client signs: a string `account` here would make viem fall back to eth_sendTransaction.
      const call = { abi: spec.abi, address: spec.address, functionName: spec.functionName, args: spec.args, value: spec.value, gas: spec.gas } as Parameters<typeof writeContract>[1]
      try {
        if (!spec.skipSimulation) await simulateContract(config, { ...call, account: address } as Parameters<typeof simulateContract>[1])
        // hashio's eth_estimateGas returns the post-refund figure (a cancel that clears storage got exactly what it burned and
        // died with INSUFFICIENT_GAS), so every estimate gets 50% headroom; Hedera refunds unused gas above 80% of the limit.
        if (!call.gas) {
          const est = await getPublicClient(config)!.estimateContractGas({ ...call, account: address } as never)
          call.gas = (est * 15n) / 10n
        }
        const hash = await writeContract(config, call)
        toasts.update(id, { state: "pending", hash })
        const receipt = await waitForTransactionReceipt(config, { hash })
        qc.invalidateQueries()
        if (receipt.status === "reverted") {
          toasts.update(id, { state: "failed", detail: "The transaction was mined but reverted. See HashScan for the revert reason." })
          return { hash, status: "reverted" }
        }
        toasts.update(id, { state: "confirmed", detail: spec.summary })
        setTimeout(() => qc.invalidateQueries(), 4000) // the API caches for a few seconds
        return { hash, status: "success" }
      } catch (e) {
        toasts.update(id, { state: "failed", detail: explainError(e) })
        return null
      }
    },
    [address, config, qc, toasts],
  )
}
