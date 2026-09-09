// Regenerates test/fixture.json, signed with a fresh throwaway key (never funded, never stored).
// Run: node --experimental-strip-types test/make-fixture.ts
import { writeFileSync } from "node:fs"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { VERDICT_TYPES, chain, domain, fromJson, type VerdictJson } from "../src/riskgate.ts"

const account = privateKeyToAccount(generatePrivateKey())
const verdict = { bondId: "1", action: 2 as const, coverageObserved: "10500", issuedAt: "1789012345", nonce: "4" }
const riskGate = "0x0000000000000000000000000000000000000000"
const signature = await account.signTypedData({
  domain: domain(chain.id, riskGate),
  types: VERDICT_TYPES,
  primaryType: "Verdict",
  message: fromJson(verdict),
})
const json: VerdictJson = { verdict, signature, chainId: chain.id, riskGate, txHash: null, signer: account.address }
writeFileSync(new URL("./fixture.json", import.meta.url), JSON.stringify(json, null, 2) + "\n")
console.log(`fixture signed by ${account.address}`)
