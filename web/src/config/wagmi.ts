import { createConfig, http, type CreateConnectorFn } from "wagmi"
import { injected } from "wagmi/connectors"
import { RPC_URL, chain } from "./chain"

/**
 * Every EIP-6963 wallet the browser announces (MetaMask, Rabby, Backpack, …) becomes its own connector so the user picks
 * one by name; the plain `injected()` entry is the fallback for wallets that only set window.ethereum. In dev, burner
 * wallets from VITE_BURNER_KEYS are added and tree-shaken out of production builds.
 */
/** True when at least one wallet answers the EIP-6963 handshake; such wallets get their own named connector. */
async function walletsAnnounce(): Promise<boolean> {
  if (typeof window === "undefined") return false
  return new Promise((resolve) => {
    let found = false
    const on = () => { found = true }
    window.addEventListener("eip6963:announceProvider", on)
    window.dispatchEvent(new Event("eip6963:requestProvider"))
    setTimeout(() => { window.removeEventListener("eip6963:announceProvider", on); resolve(found) }, 150)
  })
}

export async function makeConfig() {
  // Dev only: `?burners=1` ignores every installed wallet so a recording or an automated run uses the demo keys and an
  // extension that auto-connects (Phantom does) cannot take the session over.
  const burnersOnly = import.meta.env.DEV && new URLSearchParams(window.location.search).has("burners")
  // The generic window.ethereum connector only when nothing announces itself: listing it beside a discovered wallet
  // shows the same extension twice, and disconnecting one lets the other reconnect.
  const connectors: CreateConnectorFn[] = burnersOnly || (await walletsAnnounce()) ? [] : [injected({ shimDisconnect: true })]
  if (import.meta.env.DEV && import.meta.env.VITE_BURNER_KEYS) {
    const { burnerConnectors } = await import("../lib/burner")
    connectors.push(...burnerConnectors(String(import.meta.env.VITE_BURNER_KEYS)))
  }
  return createConfig({
    chains: [chain],
    connectors,
    multiInjectedProviderDiscovery: !burnersOnly,
    // hashio caps JSON-RPC batches at 100; parallel reads from one render share a batch
    transports: { [chain.id]: http(RPC_URL, { batch: { batchSize: 50, wait: 16 } }) },
  })
}
