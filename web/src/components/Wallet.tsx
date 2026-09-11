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
        <button type="button" className={cx("btn font-mono", wrong && "border-bad text-bad")} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
          <span className={cx("h-2 w-2 rounded-full", wrong ? "bg-bad" : "bg-ok")} aria-hidden />
          {shortAddress(address)}
          {bal.data && !wrong && <span className="text-muted hidden sm:inline">{fmtUnits(bal.data.value, 18, 0, 2)} ℏ</span>}
        </button>
        {open && (
          <div role="menu" className="absolute right-0 mt-1 w-64 panel shadow-lg p-3 text-[13px] flex flex-col gap-2 z-40">
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
  return (
    <div ref={ref} className="relative">
      <Button variant="primary" busy={isPending} onClick={() => (connectors.length === 1 ? connect({ connector: connectors[0]!, chainId: chain.id }) : setOpen((o) => !o))} aria-haspopup="menu" aria-expanded={open}>
        Connect wallet
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-60 panel shadow-lg p-1.5 z-40 flex flex-col">
          {connectors.map((c) => (
            <button key={c.uid} role="menuitem" className="text-left text-[13px] px-2.5 py-1.5 rounded hover:bg-surface-2" onClick={() => { connect({ connector: c, chainId: chain.id }); setOpen(false) }}>
              {c.type === "injected" ? "Browser wallet (MetaMask)" : c.name}
            </button>
          ))}
          {error && <p className="text-bad text-[12px] px-2.5 py-1">{error.message.split("\n")[0]}</p>}
        </div>
      )}
    </div>
  )
}

/** Blocks the page's actions until the wallet is on Hedera testnet; MetaMask gets an add-chain prompt when needed. */
export function NetworkGuard() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()
  if (!isConnected || chainId === chain.id) return null
  return (
    <div className="bg-bad-soft text-bad text-[13px] px-4 py-2 flex flex-wrap items-center justify-between gap-2" role="alert">
      <span>Your wallet is on chain {chainId ?? "?"}. Bond Desk runs on {chain.name} (chain {chain.id}, RPC {chain.rpcUrls.default.http[0]}).</span>
      <span className="flex items-center gap-2">
        {error && <span className="text-[12px]">{error.message.split("\n")[0]}</span>}
        <Button size="sm" busy={isPending} onClick={() => switchChain({ chainId: chain.id })}>Switch to {chain.name}</Button>
      </span>
    </div>
  )
}
