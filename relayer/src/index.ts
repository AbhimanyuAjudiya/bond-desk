import { readFileSync, readdirSync, renameSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { isAddress, isHex, type Address, type Hex } from "viem"
import { chain, errorMessage, fromJson, isTransient, liveGate, verifyVerdict, type Gate, type VerdictJson } from "./riskgate.ts"

const usage = `usage:
  relayer submit --file <verdict.json> [--dry]   validate, verify EIP-712 locally, then RiskGate.submit
  relayer watch --dir <inbox>                     every 5s submit each *.json, rename to .done.json on success/skip
env: HEDERA_RPC_URL RELAYER_PRIVATE_KEY RISKGATE_ADDRESS VERDICT_SIGNER_ADDRESS DEPLOYMENTS_FILE
--dry does everything except the write; with RISKGATE_ADDRESS unset it is fully offline (no snapshot read).
exit codes: 0 ok/skipped, 1 error or revert, 2 bad signature`

const fail = (message: string, code = 1): Error => Object.assign(new Error(message), { code })

const retry = async <T>(fn: () => Promise<T>, attempts = 3): Promise<T> => {
  for (let n = 0; ; n++) {
    try {
      return await fn()
    } catch (e) {
      if (n + 1 >= attempts || !isTransient(e)) throw e
      await new Promise((r) => setTimeout(r, 2000 * 2 ** n))
    }
  }
}

export type Opts = { gate?: Gate; signer?: Address; dry: boolean }
export type Result =
  | { skipped: "delivered-direct" | "already-applied" }
  | { dry: true; offline?: true; nonce?: string; lastNonce?: string }
  | { txHash: Hex; status: "success" | "reverted"; hashscan: string }

export async function relay(file: VerdictJson, { gate, dry, ...opts }: Opts): Promise<Result> {
  if (file.chainId !== chain.id) throw fail(`chainId ${file.chainId} != ${chain.id}`)
  if (!isAddress(file.riskGate)) throw fail("riskGate is not an address")
  if (gate && file.riskGate.toLowerCase() !== gate.address.toLowerCase()) throw fail(`riskGate ${file.riskGate} != configured ${gate.address}`)
  if (!gate && !dry) throw fail("no RiskGate address: set RISKGATE_ADDRESS or DEPLOYMENTS_FILE")
  const v = fromJson(file.verdict)
  const signer = opts.signer ?? (gate ? await retry(() => gate.signer()) : file.signer)
  if (!signer) throw fail("no verdict signer known: set VERDICT_SIGNER_ADDRESS")
  if (!(await verifyVerdict(signer, file.chainId, file.riskGate, v, file.signature))) throw fail("bad signature", 2)
  console.log("verified=true")
  if (file.txHash) return { skipped: "delivered-direct" }
  if (!gate) return { dry: true, offline: true }
  // one retry unit: a transport blip after the tx landed re-reads the snapshot and reports already-applied instead of re-sending
  return retry(async () => {
    const { lastNonce } = await gate.snapshot(v.bondId)
    if (v.nonce <= lastNonce) return { skipped: "already-applied" }
    if (dry) return { dry: true, nonce: v.nonce.toString(), lastNonce: lastNonce.toString() }
    return gate.submit(v, file.signature)
  })
}

// --- CLI ---
const loadJson = (path: string) => JSON.parse(readFileSync(path, "utf8"))
const isDone = (r: Result) => !("status" in r) || r.status === "success"

function optsFromEnv(dry: boolean): Opts {
  const env = process.env
  let address = env.RISKGATE_ADDRESS
  if (!address && !dry) {
    const path = env.DEPLOYMENTS_FILE ?? resolve(import.meta.dirname, "../../deployments/testnet.json")
    try {
      address = loadJson(path).riskGate
    } catch {
      throw fail(`deployments file not readable: ${path} (set RISKGATE_ADDRESS)`)
    }
  }
  if (address && !isAddress(address)) throw fail("RISKGATE_ADDRESS is not an address")
  const key = env.RELAYER_PRIVATE_KEY as Hex | undefined
  if (!dry && !(key && isHex(key) && key.length === 66)) throw fail("RELAYER_PRIVATE_KEY missing or not a 0x-prefixed 32-byte hex key")
  return {
    dry,
    signer: env.VERDICT_SIGNER_ADDRESS as Address | undefined,
    gate: address ? liveGate(env.HEDERA_RPC_URL ?? chain.rpcUrls.default.http[0], address as Address, key) : undefined,
  }
}

async function watch(dir: string, opts: Opts): Promise<void> {
  const seen = new Set<string>() // each file is attempted once per process: no revert loops, no double-submit across ticks
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json") || name.endsWith(".done.json") || seen.has(name)) continue
        const path = join(dir, name)
        let file: VerdictJson
        try {
          file = loadJson(path)
        } catch (e) {
          console.error(JSON.stringify({ file: name, error: errorMessage(e) })) // not marked seen: a file still being written (`> inbox/x.json`) is retried next tick
          continue
        }
        seen.add(name)
        try {
          const r = await relay(file, opts)
          console.log(JSON.stringify({ file: name, ...r }))
          if (isDone(r)) renameSync(path, path.replace(/\.json$/, ".done.json"))
        } catch (e) {
          console.error(JSON.stringify({ file: name, error: errorMessage(e) }))
        }
      }
    } finally {
      busy = false
    }
  }
  setInterval(tick, 5000)
  await tick()
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { file: { type: "string" }, dir: { type: "string" }, dry: { type: "boolean" }, help: { type: "boolean" } },
  })
  const [cmd] = positionals
  if (values.help || !cmd) {
    console.log(usage)
    process.exit(values.help ? 0 : 1)
  }
  if (cmd === "submit" && values.file) {
    const r = await relay(loadJson(values.file), optsFromEnv(!!values.dry))
    console.log(JSON.stringify(r))
    if (!isDone(r)) process.exitCode = 1
  } else if (cmd === "watch" && values.dir) {
    await watch(values.dir, optsFromEnv(false))
  } else {
    throw fail(usage)
  }
}

if (process.argv[1] === import.meta.filename) {
  main().catch((e) => {
    console.error(JSON.stringify({ error: errorMessage(e) }))
    process.exit(e?.code === 2 ? 2 : 1) // only fail()'s own code 2; viem RpcErrors carry JSON-RPC codes (-32000 would exit 0)
  })
}
