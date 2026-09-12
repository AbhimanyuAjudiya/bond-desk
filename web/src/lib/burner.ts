import { createWalletClient, http, type Hex, type WalletClient } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createConnector } from "wagmi"
import { RPC_URL, chain } from "../config/chain"

// Dev-only wallets built from private keys in web/.env.local, so real testnet transactions can be driven from the
// in-app browser. Imported through a DEV-guarded dynamic import: never part of a production bundle.
const NAMES = ["investor 1", "investor 2", "investor 3", "issuer", "officer", "relayer"]
const STORAGE = "bond-desk:burner"

export const burnerConnectors = (keys: string) =>
  keys.split(",").map((k) => k.trim()).filter((k) => /^0x[0-9a-fA-F]{64}$/.test(k)).map((key, i) => burner(NAMES[i] ?? `wallet ${i + 1}`, key as Hex))

const burner = (name: string, key: Hex) =>
  createConnector<WalletClient>((config) => {
    const account = privateKeyToAccount(key)
    const id = `burner-${name.replace(/\s+/g, "-")}`
    const client = createWalletClient({ account, chain, transport: http(RPC_URL) })
    return {
      id,
      name: `Burner: ${name}`,
      type: "burner",
      async connect({ withCapabilities }: { withCapabilities?: boolean } = {}) {
        localStorage.setItem(STORAGE, id)
        const accounts = withCapabilities ? [{ address: account.address, capabilities: {} }] : [account.address]
        return { accounts: accounts as never, chainId: chain.id as number }
      },
      async disconnect() {
        if (localStorage.getItem(STORAGE) === id) localStorage.removeItem(STORAGE)
      },
      async getAccounts() {
        return [account.address]
      },
      async getChainId() {
        return chain.id
      },
      async getProvider() {
        return client // wagmi skips connectors whose provider is falsy when reconnecting
      },
      async getClient() {
        return client
      },
      async isAuthorized() {
        return localStorage.getItem(STORAGE) === id
      },
      async switchChain({ chainId }) {
        const c = config.chains.find((x) => x.id === chainId)
        if (!c) throw new Error(`Burner wallets only know chain ${chain.id}`)
        return c
      },
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {},
    }
  })
