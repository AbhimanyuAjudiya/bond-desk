import { createConfig, http, type CreateConnectorFn } from "wagmi"
import { injected } from "wagmi/connectors"
import { RPC_URL, chain } from "./chain"

/** Injected (MetaMask) only; in dev, burner wallets from VITE_BURNER_KEYS are added and tree-shaken out of production builds. */
export async function makeConfig() {
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })]
  if (import.meta.env.DEV && import.meta.env.VITE_BURNER_KEYS) {
    const { burnerConnectors } = await import("../lib/burner")
    connectors.push(...burnerConnectors(String(import.meta.env.VITE_BURNER_KEYS)))
  }
  return createConfig({
    chains: [chain],
    connectors,
    multiInjectedProviderDiscovery: false,
    // hashio caps JSON-RPC batches at 100; parallel reads from one render share a batch
    transports: { [chain.id]: http(RPC_URL, { batch: { batchSize: 50, wait: 16 } }) },
  })
}
