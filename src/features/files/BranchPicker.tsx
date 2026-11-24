// Branch/tag selector: a filterable dropdown over the cached list (revalidated by the Files tab).
import { useEffect, useMemo, useRef, useState } from "react";
import type { GitRef, RefList, RepoSummary } from "../../ipc/types";
import { useFiles, type SelectedRef } from "../../stores/files";
import { ago } from "../../shared/lib/format";
import { BranchIcon, CheckIcon, ChevronIcon, TagIcon } from "../../shared/ui/Icons";

interface Props {
  repo: RepoSummary;
  refs: RefList | undefined;
  current: SelectedRef | null;
  refName: string | null;
  refreshing: boolean;
}

export function BranchPicker({ repo, refs, current, refName, refreshing }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const isTag = current?.kind === "tag";
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="t-fast flex h-7 max-w-[260px] items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-fg hover:bg-hover"
      >
        <span className="text-subtle">{isTag ? <TagIcon size={12} /> : <BranchIcon size={12} />}</span>
        <span className="truncate font-mono text-[11.5px]">{refName ?? "…"}</span>
        <ChevronIcon size={10} className="rotate-90 text-subtle" />
      </button>
      {open && (
        <Menu
          repo={repo}
          refs={refs}
          current={current}
          refreshing={refreshing}
          close={() => setOpen(false)}
          startOnTags={isTag}
        />
      )}
    </div>
  );
}

function Menu({
  repo,
  refs,
  current,
  refreshing,
  close,
  startOnTags,
}: {
  repo: RepoSummary;
  refs: RefList | undefined;
  current: SelectedRef | null;
  refreshing: boolean;
  close: () => void;
  startOnTags: boolean;
}) {
  const [tab, setTab] = useState<"branch" | "tag">(startOnTags ? "tag" : "branch");
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const defaultBranch = refs?.defaultBranch ?? repo.defaultBranch;
  const all = (tab === "branch" ? refs?.branches : refs?.tags) ?? [];
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const l = needle ? all.filter((r) => r.name.toLowerCase().includes(needle)) : all.slice();
    // Default branch first, then GitHub's order (most recent commit first).
    if (tab === "branch") l.sort((a, b) => Number(b.name === defaultBranch) - Number(a.name === defaultBranch));
    return l;
  }, [all, q, tab, defaultBranch]);
  const total = tab === "branch" ? refs?.branchesTotal : refs?.tagsTotal;

  useEffect(() => setCursor(0), [q, tab]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (r: GitRef | undefined) => {
    if (!r?.treeSha) return;
    const sel: SelectedRef | null =
      tab === "branch" && r.name === defaultBranch ? null : { name: r.name, kind: tab, treeSha: r.treeSha };
    useFiles.getState().setRef(repo.id, sel);
    close();
  };

  const isCurrent = (r: GitRef) =>
    current ? current.kind === tab && current.name === r.name : tab === "branch" && r.name === defaultBranch;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = (d: number) => {
      e.preventDefault();
      setCursor((c) => Math.min(list.length - 1, Math.max(0, c + d)));
    };
    if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else if (e.key === "Enter") {
      e.preventDefault();
      pick(list[cursor]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      setTab((t) => (t === "branch" ? "tag" : "branch"));
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else return;
    e.stopPropagation();
  };

  return (
    <div
      onKeyDown={onKeyDown}
      className="absolute left-0 top-full z-30 mt-1 w-[320px] overflow-hidden rounded-lg border border-line bg-elev"
      style={{ boxShadow: "var(--shadow)" }}
    >
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        spellCheck={false}
        placeholder={tab === "branch" ? "Filter branches" : "Filter tags"}
        className="h-9 w-full border-b border-line bg-transparent px-3 text-[12.5px] outline-none"
      />
      <div className="flex gap-1 border-b border-line px-2 pt-1.5">
        {(["branch", "tag"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2 pb-1.5 text-[11.5px] ${tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {t === "branch" ? "Branches" : "Tags"}
            <span className="ml-1 text-subtle">{(t === "branch" ? refs?.branchesTotal : refs?.tagsTotal) ?? ""}</span>
          </button>
        ))}
      </div>
      <div ref={listRef} className="max-h-[320px] overflow-y-auto p-1">
        {list.length === 0 && (
          <div className="py-6 text-center text-[12px] text-subtle">
            {!refs ? (refreshing ? "Loading…" : "Not loaded") : q ? "No matches" : tab === "branch" ? "No branches" : "No tags"}
          </div>
        )}
        {list.map((r, i) => (
          <div
            key={r.name}
            data-i={i}
            onMouseMove={() => i === cursor || setCursor(i)}
            onClick={() => pick(r)}
            className={`flex h-8 items-center gap-2 rounded-md px-2 text-[12px] ${i === cursor ? "bg-active" : ""}`}
          >
            <span className="flex w-3 shrink-0 justify-center text-accent">{isCurrent(r) && <CheckIcon size={11} />}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg">{r.name}</span>
            {tab === "branch" && r.name === defaultBranch && (
              <span className="shrink-0 rounded-full border border-line-strong px-1.5 text-[10px] text-muted">default</span>
            )}
            <span className="shrink-0 text-[11px] text-subtle">{r.committedAt ? ago(r.committedAt) : ""}</span>
          </div>
        ))}
        {total != null && total > all.length && !q && (
          <div className="px-2 py-1.5 text-[11px] text-subtle">
            Showing {all.length} of {total}, most recent first.
          </div>
        )}
      </div>
    </div>
  );
}
