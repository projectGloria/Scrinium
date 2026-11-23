import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRepos } from "../../stores/repos";
import { useUi } from "../../stores/ui";
import { useNav } from "../../stores/nav";
import { useSession } from "../../stores/session";
import { sidebarNav } from "../../shared/keys/useGlobalKeys";
import { PinIcon, SearchIcon } from "../../shared/ui/Icons";
import { Kbd } from "../../shared/ui/Kbd";
import { RepoGlyph } from "./RepoGlyph";
import { openRepo } from "./open";
import { prefetchReadme } from "../readme/Readme";

const ROW = 28;

export function Sidebar() {
  const repos = useRepos((s) => s.repos);
  const loaded = useRepos((s) => s.loaded);
  const filter = useUi((s) => s.sidebarFilter);
  const setFilter = useUi((s) => s.setSidebarFilter);
  const cursor = useUi((s) => s.sidebarCursor);
  const setCursor = useUi((s) => s.setSidebarCursor);
  const syncing = useUi((s) => s.sync.running);
  const login = useSession((s) => s.account?.login);
  const route = useNav((s) => s.stack[s.stack.length - 1]);
  const activeId = route.kind === "repo" ? route.repoId : null;

  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
  }, [repos, filter]);

  // Let global keys (j/k/Enter) drive this list.
  sidebarNav.count = items.length;
  sidebarNav.open = (i) => {
    const r = items[i];
    if (r) openRepo(r.id);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    sidebarNav.filterInput = filterRef.current;
  }, []);

  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 16,
  });

  useEffect(() => {
    if (cursor < items.length) virt.scrollToIndex(cursor, { align: "auto" });
  }, [cursor, items.length, virt]);

  // Resting on a repo for a moment warms its README (a 304 costs no rate limit).
  const cursorId = items[cursor]?.id;
  useEffect(() => {
    if (cursorId == null || cursorId === activeId) return;
    const t = setTimeout(() => prefetchReadme(cursorId), 150);
    return () => clearTimeout(t);
  }, [cursorId, activeId]);

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-elev">
      <div className="p-2">
        <div className="t-fast flex h-7 items-center gap-2 rounded-md border border-line bg-bg px-2 focus-within:border-accent">
          <SearchIcon size={12} className="text-subtle" />
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (filter) setFilter("");
                else e.currentTarget.blur();
                e.stopPropagation();
              } else if (e.key === "ArrowDown" || e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
                if (e.key === "Enter") sidebarNav.open(0);
              }
            }}
            spellCheck={false}
            placeholder="Filter repositories"
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
          />
          {!filter && <Kbd>/</Kbd>}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {loaded && items.length === 0 && (
          <div className="px-2 py-6 text-center text-[12px] text-subtle">
            {filter ? "No matches" : syncing ? "Fetching your repositories…" : "No repositories yet"}
          </div>
        )}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((v) => {
            const r = items[v.index];
            const isActive = r.id === activeId;
            const isCursor = v.index === cursor;
            return (
              <div
                key={r.id}
                onClick={() => {
                  setCursor(v.index);
                  openRepo(r.id);
                }}
                style={{ position: "absolute", top: 0, left: 0, right: 0, height: ROW, transform: `translateY(${v.start}px)` }}
                className={`t-fast flex items-center gap-2 rounded-md px-2 text-[12.5px] ${
                  isActive ? "bg-active text-fg" : isCursor ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg"
                } ${isCursor ? "ring-1 ring-inset ring-line-strong" : ""}`}
              >
                <RepoGlyph repo={r} />
                <span className="min-w-0 flex-1 truncate">
                  {r.owner !== login && <span className="text-subtle">{r.owner}/</span>}
                  {r.name}
                </span>
                {r.pinned && <PinIcon size={11} filled className="shrink-0 text-subtle" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex h-7 items-center border-t border-line px-3 text-[11px] text-subtle">
        {items.length} {items.length === 1 ? "repository" : "repositories"}
      </div>
    </aside>
  );
}
