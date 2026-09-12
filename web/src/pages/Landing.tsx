import type { ReactNode } from "react"
import { Link } from "react-router"
import { hashscanTx } from "../config/chain"
import { Copy, Refreshed, cx } from "../components/ui"
import { useBonds, useHbarUsd, useHealth, useMinCoverage, useRisk } from "../hooks/data"
import { API_URL } from "../lib/api"
import { coverageBand } from "../lib/coverage"
import { countdown, fmtBps, fmtInt, fmtPrice, fmtUsd8, intervalName, shortHash } from "../lib/format"

const OPENAPI = `${API_URL}/openapi.json`
const DOCS = "https://bond-desk.mintlify.site"
const MCP = "https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com/mcp"
const RECIPE = "https://bazantic.com/recipes/best-eligible-hedera-bond-recommendation"
const SCHEDULE = "https://hashscan.io/testnet/schedule/0.0.10482928"
const TX = {
  issuance: "0xf12ba21df080b14138f1a48adc31bb777ed192278d71f87ae98c021212bcf173",
  fill: "0x07e85a43f2528f87172d71beaf61f60d8f0552859d01b29bf7536dbb7d067bd4",
  verdict: "0xe1bc8a6d205c62d0d0123a91a77100dcb8da5a77810fbbe0e85de4de5f2e5cb2",
  freeze: "0x79168dab6bc406a757a4c7aa76039f94da662512430ec9cae4e6611ad6657b5a",
}

export function Landing() {
  return (
    <div className="flex flex-col gap-10 md:gap-14 pb-4">
      <header className="pt-4 md:pt-10 max-w-[900px]">
        <p className="label">Bond Desk · ETHOnline 2026 · Hedera testnet</p>
        <h1 className="mt-4 text-[34px] leading-[1.08] sm:text-[44px] md:text-[54px] tracking-tight text-balance">
          A corporate bond desk on Hedera. The token enforces compliance; an enclave polices the collateral.
        </h1>
        <p className="mt-5 text-[16px] md:text-[17px] leading-relaxed max-w-[62ch] text-muted">
          The policy is private, the verdict is public and verifiable. The thresholds that decide a freeze never leave the enclave; every verdict it signs lands on chain with the coverage it saw, so anyone can check that a freeze was justified without learning where the line sits.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link to="/desk" className="btn btn-primary h-10 px-5 text-[14px]">Open the desk</Link>
          <a className="link text-[14px]" href={DOCS} target="_blank" rel="noreferrer">Read the docs ↗</a>
        </div>
      </header>

      <LiveStrip />

      <Section n="02" title="How a fill is judged">
        <p className="prose max-w-[68ch] text-[15px]">
          An order is a row in <code className="font-mono text-[13px]">BondMarket</code>. Taking it calls <code className="font-mono text-[13px]">fill(orderId, amount)</code>, and before anything moves the market asks the bond token itself: <code className="font-mono text-[13px]">canTransferFrom(seller, buyer, amount)</code>. The token is an Asset Tokenization Studio security token, so the answer comes from its own KYC list, its control list and its pause flag, as an EIP-1066 code. Only <em>allowed</em> lets settlement continue: USDC from buyer to seller plus the fee, then bonds from seller to buyer, in one transaction. Any other answer reverts as <code className="font-mono text-[13px]">ComplianceRejected(code, reason)</code> and nothing has moved. The app runs the same call as a dry run first, so the refusal reaches you as a sentence before you sign.
        </p>
        <div className="scroll-x mt-6 -mx-1 px-1"><FillDiagram /></div>
      </Section>

      <Section n="03" title="How a freeze happens">
        <p className="prose max-w-[68ch] text-[15px]">
          Once an hour a Chainlink CRE workflow runs inside an enclave. It reads <code className="font-mono text-[13px]">RiskGate.snapshot(bondId)</code> over plain JSON-RPC: collateral, the HBAR/USD mark, outstanding principal, the last nonce. It compares coverage with thresholds that exist only as CRE secrets, then signs an EIP-712 <code className="font-mono text-[13px]">Verdict</code> with a key that never leaves the enclave. The enclave's own submit key, or any relayer that copies the log line, calls <code className="font-mono text-[13px]">RiskGate.submit</code>. The contract recovers the signer, requires the nonce to increase and the verdict to be fresh, and does not care who sent it. FREEZE moves the registry to Frozen and the market stops filling; DEFAULT seizes the collateral. What went in stays private; what came out is on chain, with the coverage it saw.
        </p>
        <div className="scroll-x mt-6 -mx-1 px-1"><VerdictDiagram /></div>
      </Section>

      <Section n="04" title="Receipts">
        <p className="note max-w-[68ch]">Five things that happened on Hedera testnet, in the order they happened. Every hash opens on HashScan.</p>
        <div className="scroll-x mt-4 border-y border-border">
          <table className="table min-w-[720px]">
            <thead><tr><th className="w-[26%]">What happened</th><th className="w-[22%]">Receipt</th><th>What it shows</th></tr></thead>
            <tbody>
              <tr>
                <td className="align-top">Issuance through the live ATS factory</td>
                <td className="align-top"><Hash hash={TX.issuance} /></td>
                <td className="align-top prose text-[13px]"><code className="font-mono text-[12px]">deployBond</code> on the Asset Tokenization Studio factory that was already on testnet, no fork and no redeploy of ATS. Bond 1, BDB27, face 1 USDC, 5% paid daily.</td>
              </tr>
              <tr>
                <td className="align-top">A wallet without KYC tries to fill</td>
                <td className="align-top text-muted">a read, not a transaction</td>
                <td className="align-top prose text-[13px]">
                  <code className="font-mono text-[12px]">fill(1, 10)</code> called from <span className="num">0x3b44…1cb3</span> comes back <code className="font-mono text-[12px]">ComplianceRejected(0x10, InvalidKycStatus)</code>: the token refused before anything was signed, so there is nothing to link. The same order, filled by a wallet with KYC: <Hash hash={TX.fill} />.
                </td>
              </tr>
              <tr>
                <td className="align-top">Coupon 3, paid by the Schedule Service on its own</td>
                <td className="align-top"><a className="link font-mono text-[12px] whitespace-nowrap" href={SCHEDULE} target="_blank" rel="noreferrer">schedule 0.0.10482928 ↗</a></td>
                <td className="align-top prose text-[13px]">Executed at <span className="num">1789208092.013</span> with nobody sending a transaction: coupon 2 had scheduled it from inside itself, and the contract's HBAR float paid for it. Coupon 3 armed coupon 4 the same way.</td>
              </tr>
              <tr>
                <td className="align-top">A verdict from the CRE network</td>
                <td className="align-top"><Hash hash={TX.verdict} /></td>
                <td className="align-top prose text-[13px]"><code className="font-mono text-[12px]">VerdictApplied(1, WARN, 595, nonce 4)</code>, sent by the enclave's own submit key on 2026-09-12 at 07:00 UTC. The thresholds it compared against are not in the transaction, and cannot be read from it.</td>
              </tr>
              <tr>
                <td className="align-top">The enclave freezes the market on its own</td>
                <td className="align-top"><Hash hash={TX.freeze} /></td>
                <td className="align-top prose text-[13px]">The issuer withdrew 20 HBAR at 11:03 UTC; at the next hourly run, 12:00:01 UTC, the same workflow found coverage at 4.48% and signed FREEZE: <code className="font-mono text-[12px]">VerdictApplied(1, FREEZE, 448, nonce 10)</code> and the registry's Active → Frozen in one transaction. Nobody relayed it. The admin unfroze it once the collateral was back.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section n="05" title="Three doors">
        <dl className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-[max-content_minmax(0,1fr)] text-[15px]">
          <dt className="display text-[22px] leading-tight">The app</dt>
          <dd className="prose max-w-[68ch]">
            This page and the desk behind it: every bond, its order book, your standing with the token, coupons, collateral and the risk gate. Any EVM wallet on Hedera testnet; test USDC and KYC are self-service. <Link className="link" to="/desk">Open the desk</Link>
          </dd>
          <dt className="display text-[22px] leading-tight">The API</dt>
          <dd className="prose max-w-[68ch]">
            Every screen is a JSON route on the same origin: <code className="font-mono text-[13px]">/bonds</code>, <code className="font-mono text-[13px]">/bonds/1/orderbook</code>, <code className="font-mono text-[13px]">/bonds/1/risk</code>, <code className="font-mono text-[13px]">/wallets/{"{address}"}/eligibility</code>, <code className="font-mono text-[13px]">/events</code>. A browser gets the page, a program gets the document. <a className="link" href={`${DOCS}/api/overview`} target="_blank" rel="noreferrer">API reference ↗</a> · <a className="link" href={OPENAPI} target="_blank" rel="noreferrer">OpenAPI document ↗</a>
          </dd>
          <dt className="display text-[22px] leading-tight">Agents</dt>
          <dd className="prose max-w-[68ch]">
            The same API sits behind a Bazantic gateway with x402 payment and an MCP endpoint, and a published Recipe chains it with a Hedera mirror-node gateway to recommend the best bond a wallet is eligible to hold.
            <span className="block mt-2 font-mono text-[12px] break-all">{MCP} <Copy text={MCP} label="Copy MCP URL" /></span>
            <a className="link" href={RECIPE} target="_blank" rel="noreferrer">Best eligible Hedera bond recommendation, the Recipe ↗</a>
          </dd>
        </dl>
      </Section>
    </div>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-5 grid grid-cols-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)] md:gap-10">
      <div>
        <span className="num text-[11px] text-muted">{n}</span>
        <h2 className="text-[26px] leading-tight mt-1">{title}</h2>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

const Hash = ({ hash }: { hash: string }) => (
  <a className="link font-mono text-[12px] whitespace-nowrap" href={hashscanTx(hash)} target="_blank" rel="noreferrer" title={hash}>{shortHash(hash)} ↗</a>
)

/** Six numbers from the API, and the time they were read. When the API is down the strip says so instead of guessing. */
function LiveStrip() {
  const bonds = useBonds()
  const risk = useRisk("1")
  const health = useHealth()
  const hbar = useHbarUsd()
  const min = useMinCoverage()
  const one = bonds.data?.bonds.find((b) => b.id === "1") ?? bonds.data?.bonds[0]
  const v = risk.data?.lastVerdict
  const band = one ? coverageBand(one.coverageBps, min.data ?? 0n) : null
  const down = bonds.isError || health.isError
  const dash = down ? "—" : "…"
  const cells: { label: string; value: ReactNode; sub: ReactNode }[] = [
    { label: "Bonds", value: bonds.data ? fmtInt(bonds.data.bonds.length) : dash, sub: bonds.data ? bonds.data.bonds.map((b) => b.symbol).join(", ") || "none registered" : down ? "API unreachable" : "" },
    { label: `Best ask${one ? `, ${one.symbol}` : ""}`, value: one ? `${fmtPrice(one.bestAsk)} USDC` : dash, sub: one ? `mark ${fmtPrice(one.mark)}` : "" },
    { label: "Coverage", value: one ? (one.coverageBps === null ? "feed stale" : fmtBps(one.coverageBps)) : dash, sub: band ? band.label : "" },
    { label: "Last verdict", value: risk.data ? (v ? v.action : "none yet") : risk.isError ? "—" : dash, sub: v ? `nonce ${v.nonce} · ${countdown(v.timestamp)}` : "" },
    { label: "Next coupon", value: one ? countdown(one.nextCoupon) : dash, sub: one ? `${fmtBps(one.couponRateBps)} ${intervalName(one.couponInterval)}` : "" },
    { label: "Block", value: health.data?.block ? fmtInt(health.data.block) : dash, sub: hbar.data !== undefined ? `HBAR/USD ${fmtUsd8(hbar.data)}` : hbar.isError ? "HBAR/USD stale" : "" },
  ]
  return (
    <section aria-label="Live from the API">
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border-t border-l border-border">
        {cells.map((c) => (
          <div key={c.label} className="border-b border-r border-border px-4 py-3 min-w-0">
            <dt className="label truncate">{c.label}</dt>
            <dd className={cx("num text-[20px] leading-tight mt-1 truncate", down && "text-muted")}>{c.value}</dd>
            <dd className="text-[12px] text-muted mt-0.5 truncate">{c.sub || " "}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[12px] text-muted">
        {down
          ? <>The API at <span className="num">{API_URL || window.location.origin}</span> is not answering, so the strip shows nothing rather than something stale.</>
          : <Refreshed at={bonds.dataUpdatedAt}>Read from the API at</Refreshed>}
      </p>
    </section>
  )
}

function FillDiagram() {
  return (
    <svg viewBox="0 0 680 206" className="diagram min-w-[600px]" role="img" aria-labelledby="fill-diagram-title">
      <title id="fill-diagram-title">A fill: the wallet calls BondMarket.fill, the market asks the token canTransferFrom, then settles or reverts ComplianceRejected.</title>
      <defs>
        <marker id="ah-fill" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" /></marker>
      </defs>
      <rect x="8" y="24" width="92" height="34" rx="2" /><text x="54" y="45" textAnchor="middle">wallet</text>
      <rect x="200" y="24" width="120" height="34" rx="2" /><text x="260" y="45" textAnchor="middle">BondMarket</text>
      <rect x="470" y="24" width="202" height="34" rx="2" /><text x="571" y="45" textAnchor="middle">bond token (ATS)</text>
      <line x1="100" y1="41" x2="198" y2="41" markerEnd="url(#ah-fill)" />
      <text x="150" y="16" textAnchor="middle">fill(orderId, amount)</text>
      <line x1="320" y1="34" x2="468" y2="34" markerEnd="url(#ah-fill)" />
      <text x="394" y="16" textAnchor="middle">canTransferFrom(seller, buyer, amount)</text>
      <line x1="470" y1="49" x2="322" y2="49" markerEnd="url(#ah-fill)" />
      <text x="394" y="76" textAnchor="middle" className="quiet">(ok, code, reason)</text>
      <line x1="260" y1="58" x2="260" y2="100" />
      <line x1="120" y1="100" x2="500" y2="100" />
      <line x1="120" y1="100" x2="120" y2="136" markerEnd="url(#ah-fill)" />
      <line x1="500" y1="100" x2="500" y2="136" markerEnd="url(#ah-fill)" />
      <text x="128" y="124" className="quiet">ok, code 0x11</text>
      <text x="508" y="124" className="quiet">anything else</text>
      <rect x="8" y="140" width="316" height="56" rx="2" />
      <text x="20" y="162">settle, in the same transaction:</text>
      <text x="20" y="180">USDC buyer→seller (+fee); bonds seller→buyer</text>
      <rect x="356" y="140" width="316" height="56" rx="2" />
      <text x="368" y="162">revert ComplianceRejected(code, reason)</text>
      <text x="368" y="180">nothing moved; the reason is decoded for you</text>
    </svg>
  )
}

function VerdictDiagram() {
  return (
    <svg viewBox="0 0 680 292" className="diagram min-w-[600px]" role="img" aria-labelledby="verdict-diagram-title">
      <title id="verdict-diagram-title">A verdict: the enclave reads RiskGate.snapshot, decides against private thresholds, signs EIP-712; a relayer or the enclave submits; RiskGate verifies signer, nonce and freshness; the registry goes Frozen.</title>
      <defs>
        <marker id="ah-verdict" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" /></marker>
      </defs>
      <rect x="8" y="24" width="160" height="34" rx="2" /><text x="88" y="45" textAnchor="middle">RiskGate (Hedera)</text>
      <rect x="400" y="8" width="272" height="118" rx="2" />
      <text x="412" y="28">enclave: Chainlink CRE workflow</text>
      <text x="412" y="50" className="quiet">reads coverage, mark, nonce</text>
      <rect x="412" y="60" width="132" height="20" rx="2" className="dashed soft" />
      <text x="420" y="74" className="quiet">private thresholds</text>
      <text x="552" y="74" className="quiet">→ action</text>
      <text x="412" y="102">signs EIP-712 Verdict(bondId, action,</text>
      <text x="412" y="116">coverageObserved, issuedAt, nonce)</text>
      <line x1="168" y1="41" x2="398" y2="41" markerEnd="url(#ah-verdict)" />
      <text x="283" y="34" textAnchor="middle">eth_call snapshot(bondId)</text>
      <line x1="536" y1="126" x2="536" y2="166" markerEnd="url(#ah-verdict)" />
      <text x="546" y="150" className="quiet">verdict + signature</text>
      <rect x="400" y="168" width="272" height="34" rx="2" />
      <text x="536" y="189" textAnchor="middle">relayer, or the enclave's own submit key</text>
      <line x1="400" y1="185" x2="310" y2="185" markerEnd="url(#ah-verdict)" />
      <text x="355" y="178" textAnchor="middle" className="quiet">submit(v,sig)</text>
      <line x1="88" y1="58" x2="88" y2="160" className="dashed soft" />
      <text x="96" y="112" className="quiet">same contract</text>
      <rect x="8" y="160" width="300" height="50" rx="2" />
      <text x="20" y="180">RiskGate.submit: recovers the signer,</text>
      <text x="20" y="197">requires nonce {">"} last and issuedAt fresh</text>
      <line x1="158" y1="210" x2="158" y2="246" markerEnd="url(#ah-verdict)" />
      <text x="168" y="232" className="quiet">FREEZE</text>
      <rect x="8" y="248" width="300" height="34" rx="2" />
      <text x="158" y="269" textAnchor="middle">BondRegistry: status → Frozen</text>
      <text x="330" y="269" className="quiet">fills stop; DEFAULT would seize the collateral</text>
    </svg>
  )
}
