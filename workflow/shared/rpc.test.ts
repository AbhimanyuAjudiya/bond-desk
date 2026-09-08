import { describe, expect, test } from "bun:test"
import type { HTTPClient } from "@chainlink/cre-sdk"
import { batch, batchSettled, rpc, sendRaw } from "./rpc"

// Node answers id 1 with a result and id 2 with an error, in reverse order.
const client = {
  sendRequest: () => ({
    result: () => ({
      statusCode: 200,
      body: new TextEncoder().encode(
        JSON.stringify([
          { jsonrpc: "2.0", id: 2, error: { code: -32000, message: "nonce too low" } },
          { jsonrpc: "2.0", id: 1, result: "0xaa" },
        ]),
      ),
    }),
  }),
} as unknown as HTTPClient
const r = rpc({} as any, "http://x", "1s", client)
const calls = [sendRaw("0x01"), sendRaw("0x02")]

describe("rpc", () => {
  test("batchSettled keeps the accepted item next to the rejected one", () => {
    expect(batchSettled(r, calls)).toEqual([{ result: "0xaa" }, { error: "nonce too low" }])
  })
  test("batch throws on the first error, naming the method", () => {
    expect(() => batch(r, calls)).toThrow("rpc eth_sendRawTransaction: nonce too low")
  })
})
