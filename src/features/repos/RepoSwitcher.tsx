import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RepoSummary } from "../../ipc/types";
import { useRepos } from "../../stores/repos";
import { useUi, type SwitcherFilters, type Tri } from "../../stores/ui";
import { useNav } from "../../stores/nav";
import { fuzzyScore } from "../../shared/lib/fuzzy";
import { ago, compact } from "../../shared/lib/format";
import { PinIcon, SearchIcon, StarIcon } from "../../shared/ui/Icons";
import { Kbd } from "../../shared/ui/Kbd";
import { RepoGlyph } from "./RepoGlyph";
import { openRepo } from "./open";

const ROW = 44;

function passes(r: RepoSummary, f: SwitcherFilters) {
  if (f.owner && r.owner !== f.owner) return false;
  if (f.language && r.primaryLanguage !== f.language) return false;
  if (f.visibility === "public" && r.isPrivate) return false;
  if (f.visibility === "private" && !r.isPrivate) return false;
  const tri = (v: boolean, t: Tri) => (t === "only" ? v : t === "hide" ? !v : true);
  return tri(r.isFork, f.forks) && tri(r.isArchived, f.archived);
}

/** Recent-use order for an empty query: pinned, then last opened, then last pushed. */
function byRecent(a: RepoSummary, b: RepoSummary) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const ao = a.lastOpenedAt ?? 0;
  const bo = b.lastOpenedAt ?? 0;
  if (ao !== bo) return bo - ao;
  return (b.pushedAt ?? 0) - (a.pushedAt ?? 0);
}

export function RepoSwitcher() {
  const open = useUi((s) => s.switcherOpen);
  const setOpen = useUi((s) => s.setSwitcherOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ background: "var(--overlay)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[11vh] z-50 flex w-[min(680px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-elev"
          style={{ boxShadow: "var(--shadow)" }}
        >
          <Dialog.Title className="sr-only">Switch repository</Dialog.Title>
          {open && <SwitcherBody close={() => setOpen(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SwitcherBody({ close }: { close: () => void }) {
  const repos = useRepos((s) => s.repos);
  const filters = useUi((s) => s.switcherFilters);
  const setFilters = useUi((s) => s.setSwitcherFilters);
  const route = useNav((s) => s.stack[s.stack.length - 1]);
  const currentId = route.kind === "repo" ? route.repoId : null;
  const [query, setQuery] = useState("");

  const { owners, languages } = useMemo(() => {
    const owners = [...new Set(repos.map((r) => r.owner))].sort((a, b) => a.localeCompare(b));
    const counts = new Map<string, number>();
    for (const r of repos) if (r.primaryLanguage) counts.set(r.primaryLanguage, (counts.get(r.primaryLanguage) ?? 0) + 1);
    const languages = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
    return { owners, languages };
  }, [repos]);

  const results = useMemo(() => {
    const pool = repos.filter((r) => passes(r, filters));
    const q = query.trim();
    if (!q) return pool.sort(byRecent);
    return pool
      .map((r) => {
        // A match on the bare name ranks above one that needs the owner prefix.
        const byName = fuzzyScore(q, r.name);
        return { r, s: Math.max(fuzzyScore(q, r.fullName), byName >= 0 ? byName + 50 : -1) };
      })
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || byRecent(a.r, b.r))
      .map((x) => x.r);
  }, [repos, filters, query]);

  // With no query, start on the second entry when the first is the repo already open (quick toggle).
  const initialCursor = !query && results.length > 1 && results[0].id === currentId ? 1 : 0;
  const [cursor, setCursor] = useState(initialCursor);
  useEffect(() => setCursor(initialCursor), [query, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 10,
  });
  useEffect(() => {
    if (results.length) virt.scrollToIndex(cursor, { align: "auto" });
  }, [cursor, results.length, virt]);

  const choose = (r: RepoSummary | undefined) => {
    if (!r) return;
    close();
    openRepo(r.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = (d: number) => {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, Math.max(0, c + d)));
    };
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) step(1);
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) step(-1);
    else if (e.key === "PageDown") step(8);
    else if (e.key === "PageUp") step(-8);
    else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[cursor]);
    }
  };

  const active =
    filters.owner || filters.language || filters.visibility !== "all" || filters.forks !== "all" || filters.archived !== "all";

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex h-11 items-center gap-2.5 border-b border-line px-3.5">
        <SearchIcon size={14} className="text-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          placeholder="Search repositories"
          className="flex-1 bg-transparent text-[14px] outline-none"
        />
        <span className="text-[11px] text-subtle">{results.length}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <Select value={filters.owner} onChange={(owner) => setFilters({ owner })}
          options={[["", "Any owner"], ...owners.map((o) => [o, o] as [string, string])]} />
        <Select value={filters.language} onChange={(language) => setFilters({ language })}
          options={[["", "Any language"], ...languages.map((l) => [l, l] as [string, string])]} />
        <Select value={filters.visibility} onChange={(v) => setFilters({ visibility: v as SwitcherFilters["visibility"] })}
          options={[["all", "Public + private"], ["public", "Public"], ["private", "Private"]]} />
        <Select value={filters.forks} onChange={(v) => setFilters({ forks: v as Tri })}
          options={[["all", "Forks: show"], ["hide", "Forks: hide"], ["only", "Forks: only"]]} />
        <Select value={filters.archived} onChange={(v) => setFilters({ archived: v as Tri })}
          options={[["all", "Archived: show"], ["hide", "Archived: hide"], ["only", "Archived: only"]]} />
        {active && (
          <button
            className="t-fast ml-auto text-[11px] text-subtle hover:text-fg"
            onClick={() => setFilters({ owner: "", language: "", visibility: "all", forks: "all", archived: "all" })}
          >
            Reset
          </button>
        )}
      </div>

      <div ref={scrollRef} className="max-h-[min(440px,55vh)] overflow-y-auto p-1.5">
        {results.length === 0 && <div className="py-8 text-center text-[12px] text-subtle">No repositories match</div>}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((v) => {
            const r = results[v.index];
            const sel = v.index === cursor;
            return (
              <div
                key={r.id}
                onMouseMove={() => sel || setCursor(v.index)}
                onClick={() => choose(r)}
                style={{ position: "absolute", top: 0, left: 0, right: 0, height: ROW, transform: `translateY(${v.start}px)` }}
                className={`flex items-center gap-3 rounded-lg px-2.5 ${sel ? "bg-active" : ""}`}
              >
                <RepoGlyph repo={r} size={14} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-[13px]">
                    <span className="text-subtle">{r.owner}/</span>
                    <span className="font-medium text-fg">{r.name}</span>
                    {r.pinned && <PinIcon size={11} filled className="text-subtle" />}
                    {r.id === currentId && <span className="text-[11px] text-subtle">· open</span>}
                  </div>
                  <div className="truncate text-[11.5px] text-subtle">{r.description ?? " "}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-subtle">
                  {r.primaryLanguage && <span>{r.primaryLanguage}</span>}
                  {r.stars > 0 && (
                    <span className="flex items-center gap-0.5">
                      <StarIcon size={11} />
                      {compact(r.stars)}
                    </span>
                  )}
                  <span className="w-7 text-right">{ago(r.pushedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex h-8 items-center gap-3 border-t border-line px-3 text-[11px] text-subtle">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
        <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  const on = value !== "" && value !== "all";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`t-fast h-6 max-w-[170px] rounded-md border px-1.5 text-[11.5px] outline-none ${
        on ? "border-accent bg-accent-soft text-fg" : "border-line bg-bg text-muted hover:border-line-strong"
      }`}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
