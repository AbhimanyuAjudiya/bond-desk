// Run once from the CRE_ETH_PRIVATE_KEY wallet (bun run setup:challenge, reads workflow/.env):
// approve vUSD/vETH to the lending contract if the allowance is 0, then join() if not yet joined.
import { type Address, type Hex, createPublicClient, createWalletClient, http, maxUint256, parseAbi } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import config from "../liquidation-protection/config.staging.json"

const raw = process.env.CRE_ETH_PRIVATE_KEY
if (!raw) throw new Error("CRE_ETH_PRIVATE_KEY missing (put it in workflow/.env)")
const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex)
const transport = http(config.rpcUrl)
const pub = createPublicClient({ chain: sepolia, transport })
const wallet = createWalletClient({ account, chain: sepolia, transport })
const lending = config.lending as Address

const erc20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
])
const lendingAbi = parseAbi([
  "function getUserPosition(address user) view returns (uint256 collateral, uint256 debt, uint256 hf, uint256 numOperations, uint256 lastUpdateTime, uint256 cumulativeDebtTime)",
  "function join()",
])

const wait = async (label: string, hash: Hex) => {
  const rc = await pub.waitForTransactionReceipt({ hash })
  console.log(`${label}: ${hash} (${rc.status})`)
  if (rc.status !== "success") throw new Error(`${label} reverted`)
}

console.log(`wallet: ${account.address}`)
for (const [name, token] of [
  ["vUSD", config.vusd as Address],
  ["vETH", config.veth as Address],
] as const) {
  const allowance = await pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [account.address, lending] })
  if (allowance > 0n) console.log(`approve ${name}: already set`)
  else await wait(`approve ${name}`, await wallet.writeContract({ address: token, abi: erc20, functionName: "approve", args: [lending, maxUint256] }))
}
const [collateral] = await pub.readContract({ address: lending, abi: lendingAbi, functionName: "getUserPosition", args: [account.address] })
if (collateral > 0n) console.log(`join: already joined (collateral=${collateral})`)
else await wait("join", await wallet.writeContract({ address: lending, abi: lendingAbi, functionName: "join" }))
console.log("record the join tx hash in docs/cre-evidence/challenge.md")
