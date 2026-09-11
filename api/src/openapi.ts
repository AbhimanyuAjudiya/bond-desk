// OpenAPI 3.1 document for the Bond Desk API. Descriptions are written for LLM agents (Bazantic gateway consumers).
const big = (description: string) => ({ type: "string", pattern: "^[0-9]+$", description })
const nbig = (description: string) => ({ type: ["string", "null"], pattern: "^[0-9]+$", description })
const addr = (description: string) => ({ type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description })
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra })
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const obj = (properties: Record<string, unknown>, description?: string) => ({ type: "object", required: Object.keys(properties), properties, ...(description ? { description } : {}) })
const arr = (items: unknown) => ({ type: "array", items })
const res = (description: string, schema: unknown) => ({ description, content: { "application/json": { schema } } })
const err = (code: string, description: string) => res(description, { ...ref("Error"), examples: [{ error: code }] })

const STATUS = ["Active", "Frozen", "Matured", "Defaulted", "None"]
const ACTION = ["OK", "WARN", "FREEZE", "DEFAULT"]

const addrParam = { name: "address", in: "path", required: true, description: "EVM address (0x + 40 hex)", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }
const idParam = { name: "id", in: "path", required: true, description: "Bond id (1..bondCount). Use the `id` field from listBonds.", schema: { type: "string", pattern: "^[0-9]+$" } }

export const openapi = (publicUrl: string) => ({
  openapi: "3.1.0",
  info: {
    title: "Bond Desk API",
    version: "1.0.0",
    description:
      "API over Bond Desk on Hedera testnet (the same host serves the Bond Desk web app to browsers): ATS-issued corporate bonds, an on-chain order book with ATS compliance at every fill, HBAR collateral valued by Chainlink feeds, and TEE-signed risk verdicts. " +
      "Typical agent flow: listBonds (pick Active bonds, highest currentYieldBps) -> getWalletEligibility (can this wallet hold it?) -> getBondRisk (skip FREEZE/DEFAULT, mention WARN) -> answer with the HashScan link. " +
      "All big numbers are decimal strings; timestamps are unix seconds; prices are settlement-token base units per whole bond token; bps = basis points (10000 = 100%).",
  },
  servers: [{ url: publicUrl }],
  paths: {
    "/bonds": {
      get: {
        operationId: "listBonds",
        summary: "List every bond with price, yield, coverage and status",
        description:
          "Call this before recommending a bond. Returns all registered bonds with best bid/ask from the on-chain order book, the Chainlink-derived collateral coverage and the current yield. " +
          "Only bonds with status Active can be traded; Frozen bonds reject fills until a risk verdict lifts the freeze.",
        "x-agent-hints": [
          "Sort by currentYieldBps desc; break ties by lower bestAsk.",
          "Filter status == 'Active' before recommending; Frozen/Matured/Defaulted cannot be bought.",
          "bestAsk == '0' means nobody is selling right now; say so instead of quoting a price.",
          "coverageBps null means the price feed is stale; treat as unknown risk, not as safe.",
          "Follow up with getWalletEligibility for the user's wallet and getBondRisk for the chosen bond.",
        ],
        responses: { "200": res("Bonds", obj({ bonds: arr(ref("BondSummary")) })), "502": err("upstream", "Hedera RPC or mirror node unavailable") },
      },
    },
    "/bonds/{id}": {
      get: {
        operationId: "getBond",
        summary: "One bond with its raw on-chain terms",
        description: "Same fields as listBonds plus the raw BondTerms struct from BondRegistry. Use when you need issuer, decimals or the exact coupon schedule.",
        parameters: [idParam],
        responses: { "200": res("Bond", ref("Bond")), "404": err("bond-not-found", "Unknown bond id"), "502": err("upstream", "Hedera RPC unavailable") },
      },
    },
    "/bonds/{id}/orderbook": {
      get: {
        operationId: "getOrderbook",
        summary: "Open bids/asks and the last 50 fills",
        description:
          "Order book rebuilt from BondMarket storage (open, unexpired orders only; expiry '0' = good-till-cancelled) plus recent Filled events from the Hedera mirror node. " +
          "Bids are sorted price desc, asks price asc. Cost of taking an order = amount * price / 10^bondDecimals in settlement base units, before the market fee.",
        parameters: [idParam],
        responses: { "200": res("Orderbook", ref("Orderbook")), "404": err("bond-not-found", "Unknown bond id"), "502": err("upstream", "Hedera RPC or mirror node unavailable") },
      },
    },
    "/bonds/{id}/risk": {
      get: {
        operationId: "getBondRisk",
        summary: "Collateral coverage, status and the last risk verdict",
        description:
          "Live RiskGate snapshot: coverageBps = collateral value / outstanding face value in bps (10000 = 100%). lastVerdict is the most recent EIP-712 verdict signed inside the Chainlink CRE enclave and applied on Hedera. " +
          "Interpretation: OK = healthy, WARN = mention the risk, FREEZE = trading halted (do not recommend), DEFAULT = collateral seized.",
        parameters: [idParam],
        responses: { "200": res("Risk", ref("Risk")), "404": err("bond-not-found", "Unknown bond id"), "502": err("upstream", "Hedera RPC or mirror node unavailable") },
      },
    },
    "/wallets/{address}/eligibility": {
      get: {
        operationId: "getWalletEligibility",
        summary: "Can this wallet hold a bond? (Hedera account, HBAR for gas, ATS KYC)",
        description:
          "Checks, per bond, whether an EVM address can receive the ATS bond token: the wallet must exist as a Hedera account (mirror node), hold HBAR for gas, and be KYC-granted on the token. " +
          "canHold is false with a reason otherwise. Call this before telling a user to buy; a fill for a non-KYC wallet reverts on-chain.",
        parameters: [
          { name: "address", in: "path", required: true, description: "EVM address (0x + 40 hex)", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } },
          { name: "bondId", in: "query", required: false, description: "Restrict to one bond; omit for all bonds", schema: { type: "string", pattern: "^[0-9]+$" } },
        ],
        responses: {
          "200": res("Eligibility", ref("Eligibility")),
          "400": err("bad-address", "Malformed EVM address"),
          "404": err("bond-not-found", "Unknown bondId"),
          "502": err("upstream", "Hedera RPC or mirror node unavailable"),
        },
      },
    },
    "/bonds/{id}/verdicts": {
      get: {
        operationId: "listBondVerdicts",
        summary: "Every risk verdict applied to a bond, newest first",
        description:
          "VerdictApplied events from RiskGate (mirror node, newest 100 logs of the contract). Each row is one EIP-712 verdict the enclave signed and a relayer landed: the action, the coverage the enclave observed, the per-bond nonce and who relayed it.",
        parameters: [idParam],
        responses: { "200": res("Verdicts", obj({ bondId: big("Bond id"), verdicts: arr(ref("VerdictRow")) })), "404": err("bond-not-found", "Unknown bond id"), "502": err("upstream", "Mirror node unavailable") },
      },
    },
    "/events": {
      get: {
        operationId: "listEvents",
        summary: "Recent desk activity across every contract, newest first",
        description:
          "Decoded events from BondMarket (OrderPlaced, OrderCancelled, Filled), BondLifecycle (Funded, CouponPaid, CouponClaimed, CouponScheduled, Redeemed), RiskGate (VerdictApplied, Unfrozen), CollateralVault (Deposited, Withdrawn, Seized), BondRegistry (StatusChanged, ...) and the ATS token (KycGranted, KycRevoked). " +
          "Read from the mirror node's newest 100 logs per contract; `args` keys follow the Solidity event parameter names, enums stay numeric (status: 0 None 1 Active 2 Frozen 3 Matured 4 Defaulted; action: 0 OK 1 WARN 2 FREEZE 3 DEFAULT).",
        parameters: [{ name: "limit", in: "query", required: false, description: "Rows to return (1..200, default 50)", schema: { type: "integer", minimum: 1, maximum: 200 } }],
        responses: { "200": res("Events", obj({ events: arr(ref("Event")) })), "502": err("upstream", "Mirror node unavailable") },
      },
    },
    "/wallets/{address}/kyc": {
      post: {
        operationId: "requestTestnetKyc",
        summary: "Testnet only: ask the compliance-officer bot to grant this wallet KYC on every bond token",
        "x-testnet-only": true,
        description:
          "Self-service KYC for Hedera testnet. The wallet signs the EIP-191 message `Bond Desk testnet KYC request for <checksummed address> at <unix minute>` and posts the signature; the API verifies it (five-minute window), then the compliance officer key held by the API performs what ats/script/CreateBond.s.sol does: addIssuer if the bond issuer is not yet an SSI issuer, then grantKyc(account, vc id, now-1, now+10y, issuer). " +
          "On testnet the officer is a bot that approves anyone who asks; in production it is a human or a KYC provider. The token, not this API, enforces the result at every transfer. " +
          "Rate limited to three requests per hour per address and per IP, one in-flight transaction per address. Returns 503 when the deployment has no officer key.",
        parameters: [addrParam],
        requestBody: { required: true, content: { "application/json": { schema: ref("KycRequest") } } },
        responses: {
          "200": res("Result per bond token", ref("KycResult")),
          "400": err("stale-signature", "Malformed body, bad address, or a signature older than five minutes"),
          "401": err("bad-signature", "Signature does not recover to the address in the path"),
          "409": err("pending", "A transaction for this address is still in flight"),
          "429": err("rate-limited", "More than three requests in an hour"),
          "502": err("tx-failed", "The officer's transaction reverted (message carries the decoded reason)"),
          "503": err("kyc-desk-offline", "COMPLIANCE_OFFICER_KEY is not configured on this deployment"),
        },
      },
      delete: {
        operationId: "revokeTestnetKyc",
        summary: "Testnet only: revoke this wallet's own KYC on every bond token",
        "x-testnet-only": true,
        description:
          "Same signature scheme with the message `Bond Desk testnet KYC revocation for <checksummed address> at <unix minute>`; the officer key calls revokeKyc(account). The bond issuer's own KYC cannot be revoked here (403). After this, fills to or from the wallet revert with ComplianceRejected(0x10, InvalidKycStatus).",
        parameters: [addrParam],
        requestBody: { required: true, content: { "application/json": { schema: ref("KycRequest") } } },
        responses: {
          "200": res("Result per bond token", ref("KycResult")),
          "400": err("stale-signature", "Malformed body, bad address, or a signature older than five minutes"),
          "401": err("bad-signature", "Signature does not recover to the address in the path"),
          "403": err("issuer-kyc", "The issuer's KYC is not self-service"),
          "409": err("pending", "A transaction for this address is still in flight"),
          "429": err("rate-limited", "More than three requests in an hour"),
          "502": err("tx-failed", "The officer's transaction reverted"),
          "503": err("kyc-desk-offline", "COMPLIANCE_OFFICER_KEY is not configured on this deployment"),
        },
      },
    },
    "/healthz": {
      get: {
        operationId: "healthz",
        summary: "Liveness and latest Hedera block",
        description: "ok=false means the API is up but the Hedera RPC is unreachable; retry other calls later.",
        responses: { "200": res("Health", ref("Health")) },
      },
    },
  },
  components: {
    schemas: {
      Error: obj({ error: str("Machine-readable code", { enum: ["bond-not-found", "bad-address", "upstream", "not-found", "internal", "bad-request", "stale-signature", "bad-signature", "pending", "rate-limited", "tx-failed", "kyc-desk-offline", "issuer-kyc"] }) }),
      BondSummary: obj({
        id: big("Bond id"),
        symbol: str("Bond token symbol"),
        token: addr("ATS bond token (ERC-20 compatible security token)"),
        settlement: addr("Settlement token (stablecoin) the book is quoted in"),
        vault: addr("CollateralVault holding the HBAR collateral"),
        faceValue: big("Face value per whole bond token, in settlement base units"),
        couponRateBps: big("Annual coupon rate in bps"),
        couponInterval: big("Seconds between coupons"),
        nextCoupon: big("Unix time of the next scheduled coupon"),
        maturity: big("Unix time of maturity"),
        status: str("Lifecycle status; only Active is tradable", { enum: STATUS }),
        mark: big("Oracle mark: settlement base units per whole bond token"),
        coverageBps: nbig("Collateral coverage in bps; null when the price feed is stale"),
        bestBid: big("Highest open bid price ('0' = none)"),
        bestAsk: big("Lowest open ask price ('0' = none)"),
        currentYieldBps: big("faceValue * couponRateBps / bestAsk, or couponRateBps when there is no ask"),
        links: obj({ token: str("HashScan page of the token"), orderbook: str("getOrderbook URL"), risk: str("getBondRisk URL") }),
      }),
      Bond: {
        allOf: [ref("BondSummary"), obj({
          terms: obj({
            token: addr("Bond token"), settlement: addr("Settlement token"), issuer: addr("Issuer wallet"),
            bondDecimals: { type: "integer" }, settlementDecimals: { type: "integer" },
            faceValue: big("Face value"), couponRateBps: big("Coupon bps"), couponInterval: big("Seconds"), nextCoupon: big("Unix time"), maturity: big("Unix time"),
            status: { type: "integer", description: "0 None, 1 Active, 2 Frozen, 3 Matured, 4 Defaulted" },
          }, "Raw BondRegistry.terms(id)"),
        })],
      },
      Order: obj({ orderId: big("Order id"), maker: addr("Maker"), amount: big("Bond tokens (base units)"), price: big("Settlement base units per whole bond token"), expiry: big("Unix time; '0' = good-till-cancelled") }),
      Trade: obj({ orderId: big("Order that was filled"), maker: addr("Maker"), taker: addr("Taker"), amount: big("Filled amount"), price: big("Fill price"), txHash: str("Hedera EVM transaction hash"), timestamp: big("Unix time") }),
      Orderbook: obj({ bondId: big("Bond id"), bestBid: big("Best bid"), bestAsk: big("Best ask"), bids: arr(ref("Order")), asks: arr(ref("Order")), trades: arr(ref("Trade")) }),
      Verdict: obj({ action: str("Applied action", { enum: ACTION }), coverageObserved: big("Coverage bps the enclave observed"), nonce: big("Verdict nonce"), txHash: str("Transaction that applied it"), timestamp: big("Unix time") }),
      Risk: obj({
        bondId: big("Bond id"), status: str("Lifecycle status", { enum: STATUS }), coverageBps: nbig("Coverage bps; null = stale feed"),
        mark: big("Oracle mark"), lastNonce: big("Last applied verdict nonce"), blockTime: big("Chain time of the snapshot"),
        lastVerdict: { oneOf: [ref("Verdict"), { type: "null" }], description: "null when no verdict has been applied yet" },
      }),
      WalletBond: obj({
        bondId: big("Bond id"), token: addr("Bond token"), kycGranted: { type: "boolean" },
        canHold: { type: "boolean", description: "true only when the account exists, KYC is granted and the bond is Active" },
        reason: str("Why canHold is what it is", { enum: ["kyc-granted", "no-kyc", "no-hedera-account", "bond-not-active"] }),
      }),
      Eligibility: obj({
        address: addr("Queried EVM address"),
        hederaAccount: { type: ["string", "null"], description: "Hedera account id (0.0.x) or null when the address has never been funded" },
        hbarTinybar: big("HBAR balance in tinybar (1e8 = 1 HBAR)"),
        hbarSufficientForGas: { type: "boolean", description: "true when balance >= 1 HBAR" },
        tokens: arr(obj({ tokenId: str("HTS token id"), balance: big("Balance") })),
        bonds: arr(ref("WalletBond")),
      }),
      VerdictRow: obj({ action: str("Applied action", { enum: ACTION }), coverageObserved: big("Coverage bps the enclave observed"), nonce: big("Verdict nonce"), relayer: addr("Wallet that relayed the verdict"), txHash: str("Transaction that applied it"), timestamp: big("Unix time") }),
      Event: obj({
        contract: str("Emitting contract", { enum: ["BondMarket", "BondLifecycle", "RiskGate", "CollateralVault", "BondRegistry", "BondToken"] }),
        address: addr("Contract address"), name: str("Event name as declared in Solidity"),
        args: { type: "object", additionalProperties: true, description: "Decoded parameters keyed by name; big numbers as decimal strings" },
        txHash: str("Hedera EVM transaction hash"), timestamp: big("Unix time"),
        blockNumber: { type: ["integer", "null"], description: "Block number when the mirror node reports one" },
      }),
      KycRequest: obj({
        minute: { type: "integer", description: "floor(unix seconds / 60) used in the signed message; must be within five minutes of now" },
        signature: str("EIP-191 personal_sign of the message by the wallet in the path", { pattern: "^0x[0-9a-fA-F]+$" }),
      }),
      KycResult: obj({
        address: addr("Wallet acted on"), officer: addr("Compliance officer wallet that signed the transactions"),
        action: str("What was requested", { enum: ["grant", "revoke"] }),
        results: arr(obj({
          bondId: big("Bond id"), token: addr("ATS bond token"),
          result: str("Outcome on this token", { enum: ["granted", "already-granted", "revoked", "not-granted"] }),
          txHashes: arr(str("Transaction hashes (addIssuer then grantKyc, or revokeKyc); empty when nothing changed")),
        })),
      }),
      Health: obj({ ok: { type: "boolean" }, chainId: { type: "integer", const: 296 }, block: { type: ["string", "null"], description: "Latest block number (decimal string), null when RPC is down" }, kycDesk: { type: "boolean", description: "true when the testnet KYC desk (POST/DELETE /wallets/{address}/kyc) is configured" } }),
    },
  },
})
