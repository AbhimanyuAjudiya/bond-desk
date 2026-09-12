import { useQueries, useQuery } from "@tanstack/react-query"
import type { Address } from "viem"
import { useAccount, useReadContract, useReadContracts } from "wagmi"
import { ROLES, erc20Abi, oracleAbi, registryAbi, tokenAbi, vaultAbi } from "../config/abi"
import { DEP } from "../config/deployments"
import { api, type Bond, type BondSummary, type DeskEvent, type Eligibility, type Health, type Orderbook, type Risk, type VerdictRow } from "../lib/api"

const every = (ms: number) => ({ refetchInterval: ms, staleTime: ms / 2 })

export const useBonds = () => useQuery({ queryKey: ["bonds"], queryFn: () => api<{ bonds: BondSummary[] }>("/bonds"), ...every(15_000) })
export const useBond = (id: string) => useQuery({ queryKey: ["bond", id], queryFn: () => api<Bond>(`/bonds/${id}`), ...every(15_000), enabled: /^\d+$/.test(id) })
export const useOrderbook = (id: string) => useQuery({ queryKey: ["orderbook", id], queryFn: () => api<Orderbook>(`/bonds/${id}/orderbook`), ...every(6_000) })
/** One book per bond for the desk's depth column; the same keys as useOrderbook, so the bond page finds them warm. */
export const useOrderbooks = (ids: string[]) =>
  useQueries({ queries: ids.map((id) => ({ queryKey: ["orderbook", id], queryFn: () => api<Orderbook>(`/bonds/${id}/orderbook`), ...every(15_000) })) })
export const useRisk = (id: string) => useQuery({ queryKey: ["risk", id], queryFn: () => api<Risk>(`/bonds/${id}/risk`), ...every(15_000) })
export const useVerdicts = (id: string) => useQuery({ queryKey: ["verdicts", id], queryFn: () => api<{ bondId: string; verdicts: VerdictRow[] }>(`/bonds/${id}/verdicts`), ...every(20_000) })
export const useEvents = (limit = 60) => useQuery({ queryKey: ["events", limit], queryFn: () => api<{ events: DeskEvent[] }>(`/events?limit=${limit}`), ...every(15_000) })
export const useHealth = () => useQuery({ queryKey: ["healthz"], queryFn: () => api<Health>("/healthz"), ...every(10_000), retry: 1 })
export const useEligibility = (address?: Address) =>
  useQuery({ queryKey: ["eligibility", address], queryFn: () => api<Eligibility>(`/wallets/${address}/eligibility`), enabled: !!address, ...every(20_000) })

/** HBAR/USD from NavOracle (8 decimals); undefined + error when the feed is stale. */
export const useHbarUsd = () => useReadContract({ abi: oracleAbi, address: DEP.oracle, functionName: "hbarUsd", query: every(30_000) })
export const useMinCoverage = () => useReadContract({ abi: vaultAbi, address: DEP.vault, functionName: "minCoverageBps", query: { staleTime: 300_000 } })

/** Who the connected wallet is to the desk: registry admin, bond issuer, ATS officer roles. */
export const useRoles = (issuer?: Address, token: Address = DEP.token) => {
  const { address } = useAccount()
  const q = useReadContracts({
    contracts: address
      ? [
          { abi: registryAbi, address: DEP.registry, functionName: "isAdmin", args: [address] },
          { abi: tokenAbi, address: token, functionName: "hasRole", args: [ROLES.KYC, address] },
          { abi: tokenAbi, address: token, functionName: "hasRole", args: [ROLES.FREEZE_MANAGER, address] },
          { abi: tokenAbi, address: token, functionName: "hasRole", args: [ROLES.PAUSER, address] },
        ]
      : [],
    query: { enabled: !!address, ...every(30_000) },
  })
  const b = (i: number) => q.data?.[i]?.result === true
  return {
    address,
    isAdmin: b(0),
    isKycOfficer: b(1),
    isFreezeManager: b(2),
    isPauser: b(3),
    isIssuer: !!address && !!issuer && address.toLowerCase() === issuer.toLowerCase(),
    loading: !!address && q.isLoading,
  }
}

/** Balances and allowances that gate order forms. */
export const useWalletFunds = (token: Address = DEP.token, settlement: Address = DEP.settlement) => {
  const { address } = useAccount()
  const q = useReadContracts({
    contracts: address
      ? [
          { abi: erc20Abi, address: settlement, functionName: "balanceOf", args: [address] },
          { abi: erc20Abi, address: settlement, functionName: "allowance", args: [address, DEP.market] },
          { abi: tokenAbi, address: token, functionName: "balanceOf", args: [address] },
          { abi: tokenAbi, address: token, functionName: "allowance", args: [address, DEP.market] },
          { abi: erc20Abi, address: settlement, functionName: "allowance", args: [address, DEP.lifecycle] },
        ]
      : [],
    query: { enabled: !!address, ...every(12_000) },
  })
  const n = (i: number) => (q.data?.[i]?.result as bigint | undefined) ?? 0n
  return { usdc: n(0), usdcAllowance: n(1), bonds: n(2), bondAllowance: n(3), usdcAllowanceLifecycle: n(4), loaded: !!q.data, refetch: q.refetch }
}
