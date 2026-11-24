// Issues or pull requests of a repo: cached list at once, then a throttled revalidation.
// Keys (while the list is focused): j/k or arrows move, Enter opens, / filters by title.
// Handled keys don't reach the global map.
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as ipc from "../../ipc/commands";
import type { IssueSummary, RepoSummary, StateFilter } from "../../ipc/types";
import { listKey, useIssues } from "../../stores/issues";
import { useNav } from "../../stores/nav";
import { ago } from "../../shared/lib/format";
import { fuzzyScore } from "../../shared/lib/fuzzy";
import { ExternalIcon, RefreshIcon, SearchIcon } from "../../shared/ui/Icons";
import { CheckMark, LabelChip, StateIcon } from "./parts";

const ROW = 52;

export function IssuesPanel({ repo, isPr }: { repo: RepoSummary; isPr: boolean }) {
  const key = listKey(repo.id, isPr);
  const list = useIssues((s) => s.lists[key]);
  const filter = useIssues((s) => s.filter[isPr ? "prs" : "issues"]);
  const error = useIssues((s) => s.errors[key]);
  const refreshing = useIssues((s) => !!s.refreshing[key]);
  const cursorNumber = useIssues((s) => s.cursor[key]);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText("");
    void useIssues.getState().load(repo.id, isPr);
  }, [repo.id, isPr]);

  const items = useMemo(() => {
    const all = list && list.filter === filter ? list.items : [];
    const q = text.trim();
    if (!q) return all;
    if (/^#?\d+$/.test(q)) return all.filter((it) => String(it.number).startsWith(q.replace("#", "")));
    return all
      .map((it) => ({ it, s: fuzzyScore(q, it.title) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);
  }, [list, filter, text]);

  const cursor = Math.max(0, items.findIndex((it) => it.number === cursorNumber));

  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 10,
  });

  useEffect(() => {
    if (items.length) virt.scrollToIndex(cursor, { align: "auto" });
  }, [cursor, items.length, virt]);

  // Focus the list when the tab opens (or a detail closes) so j/k work right away.
  useEffect(() => {
    scrollRef.current?.focus({ preventScroll: true });
  }, [repo.id, isPr]);

  const { setCursor, setFilter, refresh } = useIssues.getState();
  const open = (it: IssueSummary | undefined) => {
    if (!it) return;
    setCursor(repo.id, isPr, it.number);
    useNav.getState().openIssue(repo.id, it.number, isPr);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const moveTo = (i: number) => {
      const it = items[Math.max(0, Math.min(items.length - 1, i))];
      if (it) setCursor(repo.id, isPr, it.number);
    };
    let handled = true;
    switch (ev.key) {
      case "j":
      case "ArrowDown":
        moveTo(cursor + 1);
        break;
      case "k":
      case "ArrowUp":
        moveTo(cursor - 1);
        break;
      case "PageDown":
        moveTo(cursor + 10);
        break;
      case "PageUp":
        moveTo(cursor - 10);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(items.length - 1);
        break;
      case "Enter":
        open(items[cursor]);
        break;
      case "/":
        inputRef.current?.focus();
        break;
      default:
        handled = false;
    }
    if (handled) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  const onInputKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape" || ev.key === "Enter" || ev.key === "ArrowDown") {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === "Escape" && text) setText("");
      else scrollRef.current?.focus({ preventScroll: true });
    }
  };

  const noun = isPr ? "pull requests" : "issues";
  const webUrl = `${repo.htmlUrl}/${isPr ? "pulls" : "issues"}`;
  const tabs: [StateFilter, string][] = [
    ["open", `Open${list ? ` ${list.open}` : ""}`],
    ["closed", `Closed${list ? ` ${list.closed}` : ""}`],
    ["all", "All"],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex rounded-md border border-line p-0.5">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(repo.id, isPr, id)}
              className={`t-fast h-6 rounded px-2.5 text-[12px] ${filter === id ? "bg-active text-fg" : "text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-line px-2 focus-within:border-line-strong">
          <SearchIcon size={12} className="shrink-0 text-subtle" />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onInputKey}
            spellCheck={false}
            placeholder={`Filter ${noun} by title or #number   /`}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-subtle"
          />
        </div>
        <button
          title="Refresh"
          disabled={refreshing}
          onClick={() => void refresh(repo.id, isPr, true)}
          className="t-fast flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <RefreshIcon size={12} />
        </button>
        <button
          title="Open on GitHub"
          onClick={() => void ipc.openExternal(webUrl)}
          className="t-fast flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <ExternalIcon size={12} />
        </button>
      </div>

      <div className="mb-1 px-1 text-[11px] text-subtle">
        {error ? (
          <span className="text-warn">{list?.syncedAt ? "Offline copy" : "Couldn't load"} · {error}</span>
        ) : list?.syncedAt ? (
          `Checked ${ago(list.syncedAt)} ago`
        ) : refreshing ? (
          `Fetching ${noun}…`
        ) : (
          " "
        )}
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="min-h-0 flex-1 overflow-y-auto outline-none"
      >
        {items.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-subtle">
            {!list ? "" : text ? "No matches." : filter === "open" ? `No open ${noun}.` : `No ${noun} cached.`}
          </div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((v) => {
              const it = items[v.index];
              const cur = v.index === cursor;
              return (
                <div
                  key={it.number}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => open(it)}
                  className={`absolute left-0 right-0 flex cursor-default items-center gap-3 rounded-md px-2 ${
                    cur ? "bg-hover" : "hover:bg-hover"
                  } ${cur && focused ? "shadow-[inset_2px_0_0_var(--accent)]" : ""}`}
                  style={{ top: v.start, height: ROW }}
                >
                  <StateIcon item={it} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[12.5px] text-fg">{it.title}</span>
                      {it.labels.slice(0, 4).map((l) => (
                        <LabelChip key={l.name} label={l} />
                      ))}
                    </div>
                    <div className="truncate text-[11px] text-subtle">
                      #{it.number} · {it.state === "OPEN" ? `opened ${ago(it.createdAt)} ago` : `${it.state === "MERGED" ? "merged" : "closed"} ${ago(it.mergedAt ?? it.closedAt)} ago`}
                      {it.author && ` by ${it.author}`}
                      {` · updated ${ago(it.updatedAt)} ago`}
                    </div>
                  </div>
                  {it.checksState && <CheckMark state={it.checksState} />}
                  <span className={`w-8 shrink-0 text-right text-[11px] ${it.commentsCount ? "text-muted" : "text-transparent"}`}>
                    💬 {it.commentsCount}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
