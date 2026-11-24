// Virtualized file tree. Folders load their listing from SQLite when expanded.
// Keys (while focused): j/k or arrows move, l/Right expands, h/Left collapses or goes to the
// parent, Enter opens a file or toggles a folder. Handled keys don't reach the global map.
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileEntry } from "../../ipc/types";
import { EMPTY_FILES, useFiles } from "../../stores/files";
import { ChevronIcon, FileIcon, FolderIcon, SubmoduleIcon } from "../../shared/ui/Icons";

type Row = { kind: "entry"; e: FileEntry; depth: number } | { kind: "loading"; depth: number; dir: string };

const ROW = 24;

export function FileTree({ repoId, treeSha }: { repoId: number; treeSha: string }) {
  const st = useFiles((s) => s.byRepo[repoId]) ?? EMPTY_FILES;
  const dirs = useFiles((s) => s.dirs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  const { rows, missing } = useMemo(() => {
    const rows: Row[] = [];
    const missing: string[] = [];
    const walk = (dir: string, depth: number) => {
      const list = dirs[`${treeSha}:${dir}`];
      if (!list) {
        missing.push(dir);
        if (depth > 0) rows.push({ kind: "loading", depth, dir });
        return;
      }
      for (const e of list) {
        rows.push({ kind: "entry", e, depth });
        if (e.kind === "tree" && st.expanded[e.path]) walk(e.path, depth + 1);
      }
    };
    walk("", 0);
    return { rows, missing };
  }, [dirs, treeSha, st.expanded]);

  useEffect(() => {
    const { loadDir } = useFiles.getState();
    for (const d of missing) void loadDir(treeSha, d).catch(() => {});
  }, [missing, treeSha]);

  const cursor = useMemo(
    () => (st.sel ? rows.findIndex((r) => r.kind === "entry" && r.e.path === st.sel) : -1),
    [rows, st.sel],
  );

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 12,
  });

  useEffect(() => {
    if (cursor >= 0) virt.scrollToIndex(cursor, { align: "auto" });
  }, [cursor, virt]);

  // Focus the tree when the tab opens so j/k work right away.
  useEffect(() => {
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  const activate = (e: FileEntry) => {
    const f = useFiles.getState();
    if (e.kind === "tree") {
      f.select(repoId, e.path);
      f.toggleDir(repoId, e.path);
    } else if (e.kind === "blob") {
      f.openFile(repoId, e.path);
    } else {
      f.select(repoId, e.path);
    }
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const f = useFiles.getState();
    const row = cursor >= 0 ? rows[cursor] : undefined;
    const e = row?.kind === "entry" ? row.e : undefined;
    const moveTo = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (r?.kind === "entry") f.select(repoId, r.e.path);
    };
    let handled = true;
    switch (ev.key) {
      case "j":
      case "ArrowDown":
        moveTo(cursor < 0 ? 0 : cursor + 1);
        break;
      case "k":
      case "ArrowUp":
        moveTo(cursor < 0 ? 0 : cursor - 1);
        break;
      case "PageDown":
        moveTo(cursor + 20);
        break;
      case "PageUp":
        moveTo(cursor - 20);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(rows.length - 1);
        break;
      case "l":
      case "ArrowRight":
        if (e?.kind === "tree") f.toggleDir(repoId, e.path, true);
        else if (e?.kind === "blob") f.openFile(repoId, e.path);
        break;
      case "h":
      case "ArrowLeft":
        if (e?.kind === "tree" && st.expanded[e.path]) f.toggleDir(repoId, e.path, false);
        else if (e && e.path.includes("/")) f.select(repoId, e.path.slice(0, e.path.lastIndexOf("/")));
        break;
      case "Enter":
      case " ":
        if (e) activate(e);
        break;
      default:
        handled = false;
    }
    if (handled) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="min-h-0 flex-1 overflow-auto py-1 outline-none"
    >
      <div style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((v) => {
          const r = rows[v.index];
          const pad = 8 + r.depth * 14;
          if (r.kind === "loading") {
            return (
              <div key={`l:${r.dir}`} className="absolute left-0 right-0 flex items-center text-[12px] text-subtle" style={{ top: v.start, height: ROW, paddingLeft: pad + 18 }}>
                …
              </div>
            );
          }
          const e = r.e;
          const isDir = e.kind === "tree";
          const open = isDir && !!st.expanded[e.path];
          const active = st.open === e.path;
          const cur = v.index === cursor;
          return (
            <div
              key={e.path}
              title={e.kind === "commit" ? `${e.path} (submodule)` : e.path}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => {
                scrollRef.current?.focus({ preventScroll: true });
                activate(e);
              }}
              className={`absolute left-0 right-0 flex cursor-default items-center gap-1.5 whitespace-nowrap pr-3 text-[12.5px] ${
                active ? "bg-active text-fg" : cur ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg"
              } ${cur && focused ? "shadow-[inset_2px_0_0_var(--accent)]" : ""}`}
              style={{ top: v.start, height: ROW, paddingLeft: pad }}
            >
              <span className={`flex w-3 shrink-0 justify-center text-subtle ${open ? "rotate-90" : ""}`}>
                {isDir && <ChevronIcon size={10} />}
              </span>
              <span className={`shrink-0 ${isDir ? "text-accent" : "text-subtle"}`}>
                {isDir ? <FolderIcon size={13} open={open} /> : e.kind === "commit" ? <SubmoduleIcon size={13} /> : <FileIcon size={13} />}
              </span>
              <span className="truncate">{e.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
