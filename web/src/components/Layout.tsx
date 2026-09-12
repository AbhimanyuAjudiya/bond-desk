import { useState } from "react"
import { NavLink, Outlet, useNavigate } from "react-router"
import { useBonds } from "../hooks/data"
import { useHotkeys } from "../hooks/useHotkeys"
import { API_URL } from "../lib/api"
import { Ticker } from "./Ticker"
import { NetworkGuard, WalletChip } from "./Wallet"
import { cx } from "./ui"

const nav = [
  { to: "/desk", label: "Desk", key: "d" },
  { to: "/compliance", label: "Compliance", key: "c" },
  { to: "/activity", label: "Activity", key: "a" },
]

const KEYS: [string, string][] = [
  ["d", "desk"], ["c", "compliance"], ["a", "activity"], ["1 … 9", "open bond n"],
  ["j / k", "move in a list"], ["Enter", "open the row, confirm a button"], ["[ / ]", "previous / next tab on a bond"],
  ["b / s", "buy or sell in the order form"], ["↑ / ↓", "nudge a price by 0.005"], ["Esc", "cancel, close"], ["?", "this list"],
]

export function Layout() {
  const navigate = useNavigate()
  const bonds = useBonds()
  const [help, setHelp] = useState(false)
  const ids = (bonds.data?.bonds ?? []).map((b) => b.id)
  const digits = Object.fromEntries(ids.slice(0, 9).map((id, i) => [String(i + 1), () => navigate(`/bonds/${id}`)]))
  useHotkeys({
    d: () => navigate("/desk"),
    c: () => navigate("/compliance"),
    a: () => navigate("/activity"),
    "?": () => setHelp((h) => !h),
    Escape: () => setHelp(false),
    ...digits,
  })
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-[1440px] px-3 min-h-10 py-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <NavLink to="/" className="display text-[18px] leading-none whitespace-nowrap">Bond Desk</NavLink>
          <span className="badge bg-warn-soft text-warn cursor-help" title="Hedera testnet, chain 296. Nothing here is real money; the bond, the USDC and the collateral are test assets.">testnet</span>
          {/* on phones the nav takes its own line under the wordmark and the wallet chip */}
          <nav className="flex items-center gap-0.5 text-[12px] order-3 w-full -mx-2 sm:order-none sm:w-auto sm:mx-0" aria-label="Primary">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cx("px-2 py-1 rounded-sm inline-flex items-center gap-1.5", isActive ? "bg-surface-3 text-fg font-medium" : "text-muted hover:text-fg")} title={`shortcut: ${n.key}`}>
                {n.label}<kbd className="hidden md:inline">{n.key}</kbd>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="btn btn-sm hidden sm:inline-flex" onClick={() => setHelp((h) => !h)} aria-expanded={help} aria-controls="hotkeys" title="Keyboard shortcuts (?)">Keys <kbd>?</kbd></button>
            <WalletChip />
          </div>
        </div>
      </header>
      <Ticker />
      <NetworkGuard />
      <main className="mx-auto w-full max-w-[1440px] px-3 py-3 flex-1 flex flex-col gap-3">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-[1440px] px-3 py-3 text-[11px] text-muted flex flex-wrap gap-x-4 gap-y-1 border-t border-border">
        <span>Bond Desk, ETHOnline 2026</span>
        <a className="link" href="https://github.com/AbhimanyuAjudiya/bond-desk" target="_blank" rel="noreferrer">Source</a>
        <a className="link" href={`${API_URL}/openapi.json`} target="_blank" rel="noreferrer">API document</a>
        <a className="link" href="https://bond-desk.mintlify.site" target="_blank" rel="noreferrer">Docs</a>
        <a className="link" href="https://hashscan.io/testnet" target="_blank" rel="noreferrer">HashScan</a>
        <span className="sm:ml-auto">Hedera testnet, chain 296. Nothing here is real money.</span>
      </footer>
      {help && (
        <div id="hotkeys" role="dialog" aria-label="Keyboard shortcuts" className="fixed bottom-3 left-3 z-50 panel shadow-lg p-3 w-[300px]">
          <div className="flex items-baseline justify-between mb-2"><span className="text-[12px] font-semibold">Keyboard</span><button type="button" className="text-faint hover:text-fg text-[14px] leading-none" onClick={() => setHelp(false)} aria-label="Close">×</button></div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
            {KEYS.map(([k, what]) => (
              <div key={k} className="contents"><dt className="num text-fg whitespace-nowrap">{k}</dt><dd className="text-muted">{what}</dd></div>
            ))}
          </dl>
          <p className="note mt-2">Shortcuts pause while you type in a field.</p>
        </div>
      )}
    </div>
  )
}
