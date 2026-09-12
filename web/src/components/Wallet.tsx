import { useEffect, useRef, useState } from "react"
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi"
import { chain } from "../config/chain"
import { fmtUnits, shortAddress } from "../lib/format"
import { AddressChip, Button, cx } from "./ui"

/** Connect / account chip. Injected (MetaMask) in every build; burner wallets appear only in dev. */
export function WalletChip() {
  const { address, isConnected, chainId, connector } = useAccount()
  const { connectors, connect, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const bal = useBalance({ address, query: { enabled: !!address, refetchInterval: 20_000 } })
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey) }
  }, [open])

  if (isConnected && address) {
    const wrong = chainId !== chain.id
    return (
      <div ref={ref} className="relative">
        <button type="button" className={cx("btn font-mono text-[11px]", wrong && "border-bad text-bad")} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
          <span className={cx("h-2 w-2 rounded-full", wrong ? "bg-bad" : "bg-ok")} aria-hidden />
          {shortAddress(address)}
          {bal.data && !wrong && <span className="text-muted hidden sm:inline">{fmtUnits(bal.data.value, 18, 0, 2)} ℏ</span>}
        </button>
        {open && (
          <div role="menu" className="absolute right-0 mt-1 w-64 panel shadow-lg p-3 text-[12px] flex flex-col gap-2 z-40">
            <div className="flex items-center justify-between"><span className="label">Account</span><AddressChip address={address} /></div>
            <div className="flex items-center justify-between"><span className="label">Wallet</span><span>{connector?.name}</span></div>
            <div className="flex items-center justify-between"><span className="label">Network</span><span className={wrong ? "text-bad" : ""}>{wrong ? `chain ${chainId}` : chain.name}</span></div>
            {bal.data && <div className="flex items-center justify-between"><span className="label">Balance</span><span className="num">{fmtUnits(bal.data.value, 18, 0, 4)} HBAR</span></div>}
            <Button size="sm" onClick={() => { disconnect(); setOpen(false) }}>Disconnect</Button>
          </div>
        )}
      </div>
    )
  }
  // Connecting never forces the chain: a wallet that refuses (or cannot) add Hedera testnet still connects, and
  // NetworkGuard then offers the switch with an explicit add-chain request and a visible error.
  const pick = (c: (typeof connectors)[number]) => { connect({ connector: c }); setOpen(false) }
  const label = (c: (typeof connectors)[number]) => (c.id === "injected" ? "Other browser wallet (window.ethereum)" : c.name)
  const discovered = connectors.filter((c) => c.id !== "injected")
  return (
    <div ref={ref} className="relative">
      <Button variant="primary" busy={isPending} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Connect
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-72 panel shadow-lg p-1.5 z-40 flex flex-col">
          {discovered.length === 0 && (
            <p className="text-[12px] text-muted px-2.5 py-1.5">No wallet extension announced itself. Install MetaMask (or any EVM wallet that supports custom networks), then reload.</p>
          )}
          {connectors.map((c) => (
            <button key={c.uid} role="menuitem" className="text-left text-[12px] px-2.5 py-1.5 rounded-sm hover:bg-surface-2" onClick={() => pick(c)}>
              {label(c)}
            </button>
          ))}
          <p className="text-[11px] text-muted px-2.5 pt-1.5 border-t border-border mt-1">EVM wallets only (MetaMask, Rabby, …) on Hedera testnet, chain {chain.id}. HashPack is not an EVM wallet.</p>
        </div>
      )}
      {error && !open && <p className="absolute right-0 mt-1 w-72 text-bad text-[12px] panel p-2 z-40">{error.message.split("\n")[0]}</p>}
    </div>
  )
}

/** Blocks the page's actions until the wallet is on Hedera testnet; MetaMask gets an add-chain prompt when needed. */
export function NetworkGuard() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()
  if (!isConnected || chainId === chain.id) return null
  const rpc = chain.rpcUrls.default.http[0]!
  // wallet_switchEthereumChain first; a wallet that does not know chain 296 gets wallet_addEthereumChain with these exact parameters.
  const add = () => switchChain({
    chainId: chain.id,
    addEthereumChainParameter: { chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [rpc], blockExplorerUrls: [chain.blockExplorers!.default.url] },
  })
  return (
    <div className="bg-bad-soft text-bad text-[12px] px-3 py-1.5 flex flex-col gap-1" role="alert">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Your wallet is on chain {chainId ?? "?"}. Bond Desk runs on {chain.name} (chain {chain.id}).</span>
        <Button size="sm" busy={isPending} onClick={add}>Switch to {chain.name}</Button>
      </div>
      {error && <span className="text-[12px]">{error.message.split("\n")[0]}</span>}
      <span className="text-[12px] opacity-90">If your wallet cannot add it, add the network by hand: name {chain.name} · chain ID {chain.id} · RPC {rpc} · symbol HBAR · explorer {chain.blockExplorers!.default.url}.</span>
    </div>
  )
}
