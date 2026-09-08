// JSON-RPC over the CRE HTTP client. One batch = ONE HTTP call against the 5-calls-per-execution budget.
import { HTTPClient, type TeeRuntime } from "@chainlink/cre-sdk"
import type { Hex } from "viem"

export type Rpc = { runtime: TeeRuntime<unknown>; url: string; client: HTTPClient; timeout: string }
export type RpcCall = { method: string; params: unknown[] }

// `client` is injectable so unit tests can count sendRequest calls without a DON.
export const rpc = (runtime: TeeRuntime<any>, url: string, timeout = "9s", client = new HTTPClient()): Rpc => ({
  runtime,
  url,
  client,
  timeout,
})

export type Settled = { result: unknown; error?: undefined } | { error: string; result?: undefined }

// Per-call outcomes, never throws on a JSON-RPC error: use for sends, where a rejected item must not hide the accepted ones.
export const batchSettled = (r: Rpc, calls: RpcCall[]): Settled[] => {
  const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c })))
  const res = r.client
    .sendRequest(r.runtime, {
      url: r.url,
      method: "POST",
      body: Buffer.from(body).toString("base64"),
      multiHeaders: { "Content-Type": { values: ["application/json"] } },
      timeout: r.timeout,
    })
    .result()
  if (res.statusCode >= 400) throw new Error(`rpc http ${res.statusCode}`)
  const parsed = JSON.parse(new TextDecoder().decode(res.body))
  const arr: any[] = Array.isArray(parsed) ? parsed : [parsed] // ponytail: non-array => endpoint without batch support
  if (arr.length !== calls.length) throw new Error(`rpc batch size mismatch ${arr.length}/${calls.length}`)
  arr.sort((a, b) => a.id - b.id)
  return arr.map((e) => (e.error ? { error: String(e.error.message) } : { result: e.result }))
}

// Reads: throw on the first per-item error.
export const batch = (r: Rpc, calls: RpcCall[]): unknown[] =>
  batchSettled(r, calls).map((e, i) => {
    if (e.error !== undefined) throw new Error(`rpc ${calls[i].method}: ${e.error}`)
    return e.result
  })

export const call = (r: Rpc, method: string, params: unknown[]): unknown => batch(r, [{ method, params }])[0]
export const ethCall = (to: Hex, data: Hex): RpcCall => ({ method: "eth_call", params: [{ to, data }, "latest"] })
export const ethCallFrom = (from: Hex, to: Hex, data: Hex): RpcCall => ({ method: "eth_call", params: [{ from, to, data }, "latest"] })
export const nonceOf = (addr: Hex, tag: "latest" | "pending" = "latest"): RpcCall => ({
  method: "eth_getTransactionCount",
  params: [addr, tag],
})
export const gasPrice = (): RpcCall => ({ method: "eth_gasPrice", params: [] })
export const sendRaw = (signed: Hex): RpcCall => ({ method: "eth_sendRawTransaction", params: [signed] })
export const hex = (v: unknown): bigint => BigInt(typeof v === "string" ? v : "0x0")
