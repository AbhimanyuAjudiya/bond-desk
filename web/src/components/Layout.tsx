import { NavLink, Outlet } from "react-router"
import { API_URL } from "../lib/api"
import { fmtInt, fmtUsd8 } from "../lib/format"
import { useHbarUsd, useHealth } from "../hooks/data"
import { NetworkGuard, WalletChip } from "./Wallet"
import { cx } from "./ui"

const nav = [
  { to: "/desk", label: "Desk" },
  { to: "/compliance", label: "Compliance" },
  { to: "/activity", label: "Activity" },
]

export function Layout() {
  const hbar = useHbarUsd()
  const health = useHealth()
  return (
    <div className="min-h-screen flex flex-col">
      <p className="text-[12px] text-muted text-center px-4 py-1 border-b border-border truncate">
        Hedera testnet, chain 296. Nothing here is real money; the bond, the USDC and the collateral are test assets.
      </p>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 min-h-14 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <NavLink to="/" className="display text-[22px] leading-none tracking-tight whitespace-nowrap">Bond Desk</NavLink>
          {/* on phones the nav takes its own line under the wordmark and the wallet chip */}
          <nav className="flex items-center gap-0.5 text-[13px] order-3 w-full -mx-2 sm:order-none sm:w-auto sm:mx-0" aria-label="Primary">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cx("px-2.5 py-1.5 rounded", isActive ? "bg-surface-2 text-fg font-medium" : "text-muted hover:text-fg")}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-[12px] text-muted">
            <span className="hidden md:inline-flex items-center gap-1.5" title="HBAR/USD from NavOracle (Chainlink feed, 8 decimals)">
              <span className="label">HBAR/USD</span>
              <span className={cx("num text-fg", hbar.isError && "text-warn")}>{hbar.data !== undefined ? fmtUsd8(hbar.data) : hbar.isError ? "stale" : "…"}</span>
            </span>
            <span className="hidden md:inline-flex items-center gap-1.5" title="Latest Hedera block seen by the API">
              <span className="label">Block</span>
              <span className={cx("num text-fg", health.isError && "text-bad")}>{health.data?.block ? fmtInt(health.data.block) : health.isError ? "API down" : "…"}</span>
            </span>
            <WalletChip />
          </div>
        </div>
      </header>
      <NetworkGuard />
      <main className="mx-auto w-full max-w-[1200px] px-4 py-5 flex-1 flex flex-col gap-5">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-[1200px] px-4 py-6 text-[12px] text-muted flex flex-wrap gap-x-5 gap-y-1 border-t border-border">
        <span>Bond Desk, ETHOnline 2026</span>
        <a className="link" href="https://github.com/AbhimanyuAjudiya/bond-desk" target="_blank" rel="noreferrer">Source on GitHub</a>
        <a className="link" href={`${API_URL}/openapi.json`} target="_blank" rel="noreferrer">API document</a>
        <a className="link" href="https://hashscan.io/testnet" target="_blank" rel="noreferrer">HashScan</a>
        <span className="sm:ml-auto">Hedera testnet, nothing here is real money.</span>
      </footer>
    </div>
  )
}
