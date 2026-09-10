// Chainlink Liquidation Protection Challenge (Sepolia). Runs entirely inside the TEE: the wallet
// key and the HF policy are secrets, reads and sends go over JSON-RPC in two batched HTTP calls.
import { CronCapability, Runner, type TeeRuntime, handlerInTee } from "@chainlink/cre-sdk"
import { type Address, type Hex, decodeFunctionResult, encodeFunctionData } from "viem"
import { z } from "zod"
import { decideLiq } from "../shared/decide"
import { batchSettled, ethCall, ethCallFrom, gasPrice, hex, nonceOf, rpc, sendRaw } from "../shared/rpc"
import { addressOf, asKey, signLegacy } from "../shared/tx"

const address = z.custom<Address>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v))
const configSchema = z.object({
  schedule: z.string(),
  rpcUrl: z.string().startsWith("https://"),
  chainId: z.number().int(),
  lending: address,
  veth: address,
  vusd: address,
  gasLimit: z.string().regex(/^\d+$/),
  secretIds: z.object({
    walletKey: z.string(),
    triggerHf: z.string(),
    targetHf: z.string(),
    maxRepay: z.string(),
    maxDeposit: z.string(),
    cooldownSecs: z.string(),
  }),
})
type Config = z.infer<typeof configSchema>

// ChallengeLending: getUserPosition returns 6 fields; calcHF is non-view but fine under eth_call.
const LENDING = [
  {
    type: "function",
    name: "getUserPosition",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "collateral", type: "uint256" },
      { name: "debt", type: "uint256" },
      { name: "hf", type: "uint256" },
      { name: "numOperations", type: "uint256" },
      { name: "lastUpdateTime", type: "uint256" },
      { name: "cumulativeDebtTime", type: "uint256" },
    ],
  },
  { type: "function", name: "calcHF", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "vETHPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const
const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const

const STATUS: Record<string, string> = { safe: "SAFE", "no-debt": "SAFE", cooldown: "COOLDOWN", "no-reserve": "NO_RESERVE" }

const run = async (runtime: TeeRuntime<Config>) => {
  const c = runtime.config
  const ids = c.secretIds
  const wanted = [ids.walletKey, ids.triggerHf, ids.targetHf, ids.maxRepay, ids.maxDeposit, ids.cooldownSecs]
  const secrets = runtime.getSecrets(wanted.map((id) => ({ id }))).result() // ONE secrets round-trip
  const secret = (id: string) => {
    const s = secrets[id]
    if (!s) throw new Error(`secret missing: ${id}`)
    return s.value
  }
  const key = asKey(secret(ids.walletKey))
  const me = addressOf(key)
  const policy = {
    triggerHf: BigInt(secret(ids.triggerHf)),
    targetHf: BigInt(secret(ids.targetHf)),
    maxRepay: BigInt(secret(ids.maxRepay)),
    maxDeposit: BigInt(secret(ids.maxDeposit)),
    cooldownSecs: BigInt(secret(ids.cooldownSecs)),
  }

  // HTTP #1: all eight reads in one JSON-RPC batch.
  const r = rpc(runtime, c.rpcUrl)
  // The ninth sub-call probes the challenge's onlyActive gate with a simulated repay(1): outside a scoring
  // scenario the contract reverts "Scenario has not started" and we must not spend gas on a doomed tx.
  const settled = batchSettled(r, [
    ethCall(c.lending, encodeFunctionData({ abi: LENDING, functionName: "getUserPosition", args: [me] })),
    ethCall(c.lending, encodeFunctionData({ abi: LENDING, functionName: "calcHF", args: [me] })),
    ethCall(c.lending, encodeFunctionData({ abi: LENDING, functionName: "vETHPrice" })),
    ethCall(c.vusd, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [me] })),
    ethCall(c.veth, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [me] })),
    nonceOf(me, "latest"),
    nonceOf(me, "pending"),
    gasPrice(),
    ethCallFrom(me, c.lending, encodeFunctionData({ abi: LENDING, functionName: "repay", args: [1n] })),
  ])
  // Any probe failure means a real repay would fail the same way (gate closed, allowance, paused...):
  // skip this run instead of paying gas for a revert. The reason is the node's text, never a policy value.
  const probe = settled[8]
  if (probe.error !== undefined) {
    runtime.log(`liq plan=scenario-inactive (${/not started/i.test(probe.error) ? "gate closed" : "probe failed"})`)
    return { status: "INACTIVE" }
  }
  // calcHF is informational (hfChain= in the log); every other read is required.
  const failed = settled.slice(0, 8).find((s, i) => i !== 1 && s.error !== undefined)
  if (failed) throw new Error(`rpc read failed: ${failed.error}`)
  const [posRaw, hfRaw, priceRaw, vusdRaw, vethRaw, nLatest, nPending, gp] = settled.slice(0, 8).map((s) => s.result)
  if (hex(nPending) > hex(nLatest)) {
    runtime.log("liq plan=pending-tx")
    return { status: "PENDING" }
  }
  const [collateral, debt, , , lastUpdateTime] = decodeFunctionResult({ abi: LENDING, functionName: "getUserPosition", data: posRaw as Hex })
  const plan = decideLiq(
    {
      collateral,
      debt,
      price: hex(priceRaw),
      vusdBal: hex(vusdRaw),
      vethBal: hex(vethRaw),
      lastUpdateTime,
      now: BigInt(Math.floor(runtime.now().getTime() / 1000)),
    },
    policy,
  )
  const hf = plan.hf.toString()
  if (plan.repay === 0n && plan.deposit === 0n) {
    runtime.log(`liq hf=${hf} hfChain=${hfRaw === undefined ? "n/a" : hex(hfRaw)} plan=${plan.reason}`)
    return { status: STATUS[plan.reason], hf }
  }

  // Sign repay (nonce n) then deposit (nonce n+1); HTTP #2 sends both in one batch.
  const tx = { chainId: c.chainId, to: c.lending, gas: BigInt(c.gasLimit), gasPrice: hex(gp) }
  let nonce = Number(hex(nLatest))
  const signed: Hex[] = []
  if (plan.repay > 0n)
    signed.push(await signLegacy(key, { ...tx, nonce: nonce++, data: encodeFunctionData({ abi: LENDING, functionName: "repay", args: [plan.repay] }) }))
  if (plan.deposit > 0n)
    signed.push(await signLegacy(key, { ...tx, nonce: nonce++, data: encodeFunctionData({ abi: LENDING, functionName: "deposit", args: [plan.deposit] }) }))
  // Settled, not thrown: if the node rejects one send, still log and return the hash of the one it accepted.
  const sends = batchSettled(r, signed.map(sendRaw))
  const txHashes = sends.flatMap((s) => (s.error === undefined ? [s.result as Hex] : []))
  sends.forEach((s, i) => s.error !== undefined && runtime.log(`liq send #${i} (${i === 0 && plan.repay > 0n ? "repay" : "deposit"}) rejected: ${s.error}`))
  runtime.log(`liq hf=${hf} hfChain=${hfRaw === undefined ? "n/a" : hex(hfRaw)} plan=defend txs=${txHashes.length}/${sends.length}`)
  return { status: "DEFENDED", hf, repay: plan.repay.toString(), deposit: plan.deposit.toString(), txHashes }
}

const initWorkflow = (config: Config) => [handlerInTee(new CronCapability().trigger({ schedule: config.schedule }), run, {})]

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

await main()
