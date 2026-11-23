import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { syncNow } from "../../ipc/commands";
import { useSession } from "../../stores/session";
import { useUi } from "../../stores/ui";
import { useRepos } from "../../stores/repos";
import { useNav } from "../../stores/nav";
import { ago } from "../lib/format";
import {
  CloseIcon,
  MaximizeIcon,
  MinimizeIcon,
  MonitorIcon,
  MoonIcon,
  RefreshIcon,
  SearchIcon,
  SunIcon,
} from "./Icons";
import { Kbd } from "./Kbd";

const win = getCurrentWindow();

export function Titlebar() {
  const status = useSession((s) => s.status);
  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center border-b border-line bg-elev pl-3"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-[12px] font-semibold tracking-tight">
        <Logo />
        <span data-tauri-drag-region>Scrinium</span>
      </div>
      <div data-tauri-drag-region className="flex flex-1 justify-center">
        {status === "signedIn" && <SwitcherButton />}
      </div>
      {status === "signedIn" && (
        <div className="flex items-center gap-0.5 pr-1">
          <SyncIndicator />
          <ThemeButton />
          <AccountMenu />
        </div>
      )}
      {status !== "signedIn" && <ThemeButton />}
      <WindowControls />
    </header>
  );
}

function Logo() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden data-tauri-drag-region>
      <rect x="3" y="2.5" width="10" height="2.6" rx="1.3" fill="var(--accent)" />
      <rect x="3" y="6.7" width="10" height="2.6" rx="1.3" fill="var(--accent)" opacity="0.7" />
      <rect x="3" y="10.9" width="10" height="2.6" rx="1.3" fill="var(--accent)" />
    </svg>
  );
}

function SwitcherButton() {
  const open = useUi((s) => s.setPaletteOpen);
  return (
    <button
      onClick={() => open(true)}
      className="t-fast flex h-6 w-[340px] items-center gap-2 rounded-md border border-line bg-bg px-2 text-[12px] text-subtle hover:border-line-strong hover:text-muted"
    >
      <SearchIcon size={12} />
      <span className="flex-1 text-left">Search or run a command…</span>
      <Kbd>Ctrl</Kbd>
      <Kbd>K</Kbd>
    </button>
  );
}

function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`t-fast flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg ${props.className ?? ""}`}
    />
  );
}

function SyncIndicator() {
  const sync = useUi((s) => s.sync);
  // Re-render every 30s so "synced 3m ago" stays roughly true.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const label = sync.running
    ? "Syncing"
    : sync.lastError
      ? "Sync failed"
      : sync.lastSuccessAt
        ? `Synced ${ago(sync.lastSuccessAt)}`
        : "Not synced";
  const title = sync.lastError ?? (sync.lastSuccessAt ? new Date(sync.lastSuccessAt * 1000).toLocaleString() : "");
  return (
    <div className="flex items-center gap-1">
      <span
        title={title}
        className={`flex items-center gap-1.5 px-1 text-[11px] ${sync.lastError && !sync.running ? "text-danger" : "text-subtle"}`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${sync.running ? "bg-accent" : sync.lastError ? "bg-danger" : "bg-success"}`}
        />
        {label}
      </span>
      <IconButton title="Sync now" onClick={() => void syncNow()} disabled={sync.running}>
        <RefreshIcon size={13} />
      </IconButton>
    </div>
  );
}

function ThemeButton() {
  const theme = useUi((s) => s.theme);
  const cycle = useUi((s) => s.cycleTheme);
  const Icon = theme === "system" ? MonitorIcon : theme === "dark" ? MoonIcon : SunIcon;
  return (
    <IconButton title={`Theme: ${theme}`} onClick={cycle}>
      <Icon size={13} />
    </IconButton>
  );
}

function AccountMenu() {
  const account = useSession((s) => s.account);
  const signOut = useSession((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  if (!account) return null;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={account.login}
        className="t-fast flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover"
      >
        {account.avatarUrl ? (
          <img src={`${account.avatarUrl}&s=40`} alt="" className="h-[18px] w-[18px] rounded-full" />
        ) : (
          <span className="text-[11px] font-semibold">{account.login[0]?.toUpperCase()}</span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 top-8 z-50 w-56 rounded-lg bg-elev p-1 text-[12px]"
          style={{ boxShadow: "var(--shadow)" }}
        >
          <div className="px-2 py-1.5">
            <div className="font-medium">{account.login}</div>
            <div className="text-subtle">
              {account.authKind === "pat" ? "Personal access token" : "GitHub device sign-in"}
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            className="t-fast w-full rounded-md px-2 py-1.5 text-left hover:bg-hover"
            onClick={async () => {
              setOpen(false);
              await signOut();
              useRepos.getState().clear();
              useNav.getState().reset();
            }}
          >
            Sign out and clear cache
          </button>
        </div>
      )}
    </div>
  );
}

function WindowControls() {
  const btn =
    "t-fast flex h-9 w-11 items-center justify-center text-muted hover:bg-hover hover:text-fg";
  return (
    <div className="flex self-stretch">
      <button className={btn} title="Minimize" onClick={() => void win.minimize()}>
        <MinimizeIcon />
      </button>
      <button className={btn} title="Maximize" onClick={() => void win.toggleMaximize()}>
        <MaximizeIcon />
      </button>
      <button
        className="t-fast flex h-9 w-11 items-center justify-center text-muted hover:bg-[#e81123] hover:text-white"
        title="Close"
        onClick={() => void win.close()}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
