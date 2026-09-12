# Dashboard steps — putting the three-service Recipe live, and the recording

> **Status 2026-09-12 06:43 UTC.** Steps 2 and 4 are done, without the dashboard: the control MCP
> (`https://api.bazantic.com/control-mcp`, section 5) accepted the CLI session, and
> `bazantic_recipe_unpublish` → `bazantic_recipe_update` (the four fields of `recipe-update.json`) →
> `bazantic_recipe_publish` ran in three seconds; publish validated all seven bindings live, including
> `getTransactions` on the mirror-node gateway whose inventory the control plane reports as `oversized_inventory`.
> The public catalog now shows the three-service description and a non-empty `output_example`. What is still
> dashboard-only: the listing copy (step 1), the two **Test** runs and *Use as output example* (step 3), and the
> recording (step 6).

Everything here is click work in the bazantic.com dashboard (signed in as **Abhimanyu**) because the released CLI
(`@bazantic/cli` 0.8.0) has no `recipe` command and the CLI session cannot edit a listing (`gateway.md`, section 8).
The texts to paste are in this file and, machine-readable, in `recipe-update.json` (a valid *update file* in the
format `https://bazantic.com/docs/recipes` documents: `description`, `prompt_template`, `tool_bindings`,
`output_example`). The Recipe's name and handle never change: the handle is derived from the name and immutable, and
the public URL <https://bazantic.com/recipes/best-eligible-hedera-bond-recommendation> depends on it.

## 0. Before you start (terminal, 1 minute)

```sh
baz whoami                                                    # Abhimanyu · gateway:read/write, recipe:read/write
baz gateway list --json | jq '.listings[] | {name, slug, status}'   # three gateways, all "active"
export BOC=https://4q4fqndwcnhxrfk6thlgjnodca.bazgateway.com
curl -s -X POST "$BOC/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | sed -n 's/^data: //p' | jq -r '.result.tools[].name'
# must list getGroupObservations — Publish validates live tool bindings, so the MCP must be compiled first
curl -s https://api.bazantic.com/v1/recipes/best-eligible-hedera-bond-recommendation | jq '.output_example'   # {} today
```

Re-derive the expected numbers right before the test runs (`recipe.md`, "Hand-derived expected result"): the chain is
live and the KYC wallet's balance and transaction count move whenever someone runs the demo.

## 1. Fix the three gateway listings (Overview → Your Listings)

For each gateway, open its listing and edit the copy; the description limit is 600 characters and the tag limit is 5
(over either, the save fails with only "We couldn't save your changes").

1. **Bond Desk API (Hedera)** — replace the description with the text in `gateway.md` section 8 (it names the Recipe
   correctly: *Best Eligible Hedera Bond Recommendation*, and names the two other services). Tags unchanged. Save.
2. **Hedera Mirror Node (testnet)** — replace the last sentence of the description as in section 8. Save.
3. **Bank of Canada Valet** — replace the auto-generated description with section 8's text; tagline
   `Government of Canada benchmark yields and rates, keyless, daily.`; tags `canada, yields, benchmark, rates, data`;
   documentation URL `https://www.bankofcanada.ca/valet/docs`; product website `https://www.bankofcanada.ca`. Upstream
   auth stays *No auth* (registered with `--auth-type none`). Press *Test connection* (expect `Connection OK`). Leave
   the four prices at $0.01 unless you want to match the spec's 500/200 millicents — the extension in the spec was not
   applied at registration, and the served `/openapi.yaml` still shows it, so setting 500/500/200/200 here makes the
   two agree. Save.
4. Verify without logging in: `curl -s https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com/.well-known/agent-card.json | jq .description`
   shows the new Bond Desk text.

## 2. Update the Recipe (Dashboard → Recipes → Best Eligible Hedera Bond Recommendation)

The editor shows, in order: **Info**, **Prompt**, **Tools this Recipe can call**, **Inputs** (starts closed),
**Advanced** (starts closed), then **Save**, then **Test**. A published Recipe is locked: **Unpublish** first ("Unpublish
to edit again"); it returns to draft and disappears from the public catalog until step 4 republishes it, so do steps
2–4 in one sitting.

1. Open the Recipe from the Recipes list and press **Unpublish**.
2. **Info** — leave the name exactly `Best Eligible Hedera Bond Recommendation`. Replace the description with the
   `description` value from `recipe-update.json` (it now names all three services and the benchmark rule).
3. **Tools this Recipe can call** — the Recipe calls only the tools bound here. The five existing bindings stay; add
   two. A binding is one gateway plus one tool name; the picker offers tools from gateways this account owns (all
   three are ours) and from the verified marketplace. Add, in this order:

   | # | Gateway (as listed) | slug | tool_name | new? |
   |---|---|---|---|---|
   | 1 | Hedera Mirror Node (testnet) | `txrkgk2mezhbln4aeo2tdji6s4` | `getAccount` | existing |
   | 2 | Hedera Mirror Node (testnet) | `txrkgk2mezhbln4aeo2tdji6s4` | `getTransactions` | **add** |
   | 3 | Bond Desk API (Hedera) | `axuvor5zujgk5hdcydzjdi742m` | `getWalletEligibility` | existing |
   | 4 | Bond Desk API (Hedera) | `axuvor5zujgk5hdcydzjdi742m` | `listBonds` | existing |
   | 5 | Bank of Canada Valet | `4q4fqndwcnhxrfk6thlgjnodca` | `getGroupObservations` | **add** |
   | 6 | Bond Desk API (Hedera) | `axuvor5zujgk5hdcydzjdi742m` | `getBondRisk` | existing |
   | 7 | Bond Desk API (Hedera) | `axuvor5zujgk5hdcydzjdi742m` | `getOrderbook` | existing |

   If the mirror-node gateway's tool list is too long for the picker (its control-server inventory answers
   `oversized_inventory` for 48 tools), type the tool name `getTransactions` exactly; it is the mirror node's
   `GET /api/v1/transactions` operation and takes `account.id`, `limit`, `order`. Do not bind `getTokensByAccountId`
   — the eligibility call already returns the token relationships.
4. **Prompt** — select all, delete, paste the `prompt_template` value from `recipe-update.json` (7 numbered steps,
   the answer paragraph, and exactly one `{{inputs}}` at the end; the editor rejects a prompt with zero or two).
5. **Inputs** — open it and leave it: one field, `wallet_address` (title "Hedera EVM Wallet Address"), example
   `0x8524F940EddC9EA98198Ee08071944a07C417D7b`.
6. **Advanced** — open it. Leave every field unchanged except **output example**: paste the `output_example` object
   from `recipe-update.json` for now (it is the hand-derived answer for the KYC wallet at 2026-09-11 19:33 UTC); step
   3 replaces it with a real run.
7. Press **Save**. If it refuses, the usual causes are a second `{{inputs}}`, a binding whose gateway is not live, or
   the 24 KiB definition limit (this update is about 7.5 KiB compact).

## 3. Test both wallets (still in the editor)

Test runs use Bazantic's operator credential and are free; each run, its inputs and its output are kept.

1. Press **Test**, enter `wallet_address = 0x8524F940EddC9EA98198Ee08071944a07C417D7b`, run. Expect **six tool calls,
   in this order**: `getAccount` → `getTransactions` (with `account.id` = `0.0.10455958`, not the 0x address) →
   `getWalletEligibility` → `listBonds` → `getGroupObservations` (`bond_yields_all`, `recent` 1) → `getBondRisk`. The
   answer must recommend BDB27 (bond 1), quote the spread over `CDN.AVG.1YTO3Y.AVG` (+175 bps against 3.30 % on
   2026-09-10 as of this writing), credit the Bank of Canada, disclose the lifted FREEZE at nonce 2 with the current
   coverage, and quote the wallet's newest transaction (name, result, time, id). Check every number against a fresh
   `curl` of the direct endpoints (`recipe.md`, example section). If it is right, press **Use as output example** —
   that replaces the pasted draft with the real output and is the `output_example` the public catalog will show.
2. Press **Test** again with `wallet_address = 0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3`. Expect **three tool
   calls** — `getAccount`, `getTransactions`, `getWalletEligibility` — then a stop: no bond can be held, bond 1 excluded
   for `no-kyc`, the wallet's account id, balance and two transactions on record quoted, and the KYC next step named.
   Steps 4–6 must not run; if `listBonds` or `getGroupObservations` fired, the prompt was pasted incompletely.
3. If a run fails with `tool_failed` on `getGroupObservations`, the Valet gateway is not forwarding: open its listing,
   press *Test connection*, and check `curl -i "$BOC/valet/observations/group/bond_yields_all/json?recent=1"` answers
   402 (not 404). If it fails on `getTransactions`, the argument was the 0x address — the prompt says to use the
   `0.0.x` id; re-run.

## 4. Republish and verify

1. Press **Publish**. The name is unchanged, so the handle stays `best-eligible-hedera-bond-recommendation` (a taken
   name would get a suffix; ours is already ours).
2. Verify from a terminal, no login needed:

```sh
curl -s https://api.bazantic.com/v1/recipes/best-eligible-hedera-bond-recommendation | jq '{name, handle, output_example}'
curl -s -X POST https://api.bazantic.com/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | sed -n 's/^data: //p; /^{/p' | jq -r '.result.tools[].name' | grep best-eligible
```

`output_example` must be non-empty and the description must name the three services. Then reopen
<https://bazantic.com/recipes/best-eligible-hedera-bond-recommendation> for the recording.

## 5. If the picker will not cooperate: the JSON route

`recipe-update.json` is a valid update file. The docs' `baz recipe unpublish <handle>` / `baz recipe update <handle>
<file>` / `baz recipe publish <handle>` will apply it once a CLI newer than 0.8.0 ships. Today the same three
operations exist as `bazantic_recipe_unpublish`, `bazantic_recipe_update` and `bazantic_recipe_publish` on the control
MCP server `https://api.bazantic.com/control-mcp`, which accepts the CLI session as a bearer token — a reasonable
fallback, but the dashboard route above shows every tool call in the Test panel, which the recording needs anyway.

## 6. Screen recording — Bazantic segment, 3 to 5 minutes

One continuous take if possible; terminal on the left, browser on the right. Set up first:

```sh
export GATEWAY=https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com
export BOC=https://4q4fqndwcnhxrfk6thlgjnodca.bazgateway.com
export MIRROR=https://txrkgk2mezhbln4aeo2tdji6s4.bazgateway.com
```

| Time | Shot | Narration |
|---|---|---|
| 0:00–0:20 | Terminal: `baz whoami`, then `baz gateway list --json \| jq '.listings[] \| {name, slug, status}'` | "Three gateways on Bazantic, all active, all registered from the CLI: our Bond Desk API, the Hedera testnet mirror node, and the Bank of Canada Valet API — the one that was on neither Bazantic nor a sponsor's list before this week." |
| 0:20–0:50 | Terminal: `curl -i "$GATEWAY/bonds" \| head -20` — pause on `402`, `payment-required`, `www-authenticate: Payment` | "Every call is paid. An unpaid request gets a 402 with an x402 challenge — USDC on Base, five thousandths of a dollar for the bond list — and an MPP challenge beside it. The API stays free at its own URL; the gateway is what makes it agent-payable." |
| 0:50–1:10 | Terminal: `curl -i "$BOC/valet/observations/group/bond_yields_all/json?recent=1" \| head -12` | "Same for the Bank of Canada gateway: one cent for the whole benchmark curve." |
| 1:10–1:40 | Terminal: `tools/list` on `$GATEWAY/mcp`, then on `$BOC/mcp` (the `curl … \| jq -r '.result.tools[].name'` one-liners from `gateway.md`) | "Bazantic compiled both OpenAPI documents into MCP servers. Our operationIds are the tool names — listBonds, getWalletEligibility, getBondRisk — and the Valet spec we wrote became getGroupObservations." |
| 1:40–2:10 | Browser: the public Recipe page, then the dashboard editor's **Tools this Recipe can call** (seven tools, three gateways) | "The Recipe is one MCP tool that chains all three: the mirror node for existence and the wallet's own history, the Bond Desk for KYC, book and risk, the Bank of Canada for the benchmark the coupon has to beat." |
| 2:10–3:40 | Browser: **Test** with the KYC wallet; keep every tool call and its arguments visible as they land; then the answer | "Six calls. The account exists, 0.0.10455958. Its history — the newest transaction quoted verbatim. Eligibility: canHold true. One active bond with an ask. The benchmark row: the one-to-three-year average, 3.30 percent, so BDB27 at 5.05 is 175 basis points over. Risk: Active, coverage under six percent, and a FREEZE in the history that the answer discloses as lifted instead of hiding or panicking about it." |
| 3:40–4:10 | Browser: **Test** with the no-KYC wallet; three calls, then the stop | "Same Recipe, a wallet without KYC: three calls and it stops. It does not price a bond this wallet cannot buy; it says what the wallet has to do first." |
| 4:10–4:30 | Terminal: `curl -s https://api.bazantic.com/v1/recipes/best-eligible-hedera-bond-recommendation \| jq '{handle, output_example}'` | "Published: the handle, the input schema and a real output example, readable with no key." |
| 4:30–4:50 | Terminal, typed but not necessarily run: `claude mcp add --transport http bazantic-recipes https://api.bazantic.com/mcp` | "Reuse is one line: `claude mcp add --transport http` against api.bazantic.com/mcp — or `baz recipe install` once the CLI ships it — and this Recipe shows up as a single tool in any agent's tool list." |

Keep the take under five minutes; the two test runs are the only shots that can run long — if a run takes more than
60 s, cut to the answer.
