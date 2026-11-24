// Ctrl+K command palette: repositories, files, issues and PRs (FTS + fuzzy, ranked in Rust) and commands.
// Typing ">" first searches commands only.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as ipc from "../../ipc/commands";
import type { FileHit, IssueHit, RepoSummary } from "../../ipc/types";
import { useFiles } from "../../stores/files";
import { useRepos } from "../../stores/repos";
import { useUi } from "../../stores/ui";
import { useNav } from "../../stores/nav";
import { useSession } from "../../stores/session";
import { useActions } from "../../stores/actions";
import { fuzzyScore } from "../../shared/lib/fuzzy";
import { ago } from "../../shared/lib/format";
import {
  BookIcon,
  CommandIcon,
  ExternalIcon,
  FileIcon,
  FolderIcon,
  IssueIcon,
  PinIcon,
  PlusIcon,
  CopyIcon,
  CodeIcon,
  DownloadIcon,
  PrIcon,
  RefreshIcon,
  SearchIcon,
  SunIcon,
  WorkflowIcon,
} from "../../shared/ui/Icons";
import { Kbd } from "../../shared/ui/Kbd";
import { RepoGlyph } from "../repos/RepoGlyph";
import { openRepo } from "../repos/open";
import { cloneToFolder, copyCloneUrl, openInVscode } from "../repos/quick";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

type Item =
  | { kind: "repo"; repo: RepoSummary }
  | { kind: "file"; hit: FileHit; repo: RepoSummary }
  | { kind: "issue"; hit: IssueHit; repo: RepoSummary }
  | { kind: "cmd"; cmd: Command };

export function Palette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ background: "var(--overlay)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[11vh] z-50 flex w-[min(640px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-elev"
          style={{ boxShadow: "var(--shadow)" }}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          {open && <PaletteBody close={() => setOpen(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function useCommands(close: () => void): Command[] {
  const route = useNav((s) => s.stack[s.stack.length - 1]);
  const repoId = route.kind === "home" ? null : route.repoId;
  const repo = useRepos((s) => (repoId != null ? s.byId.get(repoId) : undefined));
  const workflows = useActions((s) => (repoId != null ? s.byRepo[repoId]?.workflows : undefined));
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    // Cached workflow list only; the Actions tab does the network refresh.
    if (repoId != null && !useActions.getState().byRepo[repoId]) {
      void ipc.actionsGet(repoId).then((a) =>
        useActions.setState((s) => ({ byRepo: { ...s.byRepo, [repoId]: s.byRepo[repoId] ?? a } })),
      );
    }
  }, [repoId]);

  return useMemo(() => {
    const ui = useUi.getState();
    const after = (fn: () => void) => () => {
      close();
      fn();
    };
    const list: Command[] = [];
    if (repo) {
      list.push(
        { id: "readme", label: "Show README", hint: repo.name, icon: <BookIcon size={13} />, run: after(() => ui.setRepoTab("readme")) },
        { id: "files", label: "Show Files", hint: repo.name, icon: <FolderIcon size={13} />, run: after(() => ui.setRepoTab("files")) },
        { id: "issues", label: "Show Issues", hint: repo.name, icon: <IssueIcon size={13} />, run: after(() => ui.setRepoTab("issues")) },
        { id: "prs", label: "Show Pull requests", hint: repo.name, icon: <PrIcon size={13} />, run: after(() => ui.setRepoTab("prs")) },
        { id: "actions", label: "Show Actions", hint: repo.name, icon: <WorkflowIcon size={13} />, run: after(() => ui.setRepoTab("actions")) },
        ...(workflows ?? [])
          .filter((w) => w.dispatchable && w.state === "active")
          .map((w) => ({
            id: `run:${w.id}`,
            label: `Run workflow: ${w.name}`,
            hint: repo.name,
            icon: <WorkflowIcon size={13} />,
            run: after(() => {
              ui.setRepoTab("actions");
              ui.setRunDialog({ repoId: repo.id, workflowId: w.id });
            }),
          })),
        { id: "web", label: "Open on GitHub", hint: repo.fullName, icon: <ExternalIcon size={13} />, run: after(() => void ipc.openExternal(repo.htmlUrl)) },
        { id: "copy-https", label: "Copy clone URL (HTTPS)", hint: repo.name, icon: <CopyIcon size={13} />, run: after(() => void copyCloneUrl(repo, false)) },
        { id: "copy-ssh", label: "Copy clone URL (SSH)", hint: repo.name, icon: <CopyIcon size={13} />, run: after(() => void copyCloneUrl(repo, true)) },
        { id: "clone", label: "Clone to folder…", hint: repo.name, icon: <DownloadIcon size={13} />, run: after(() => void cloneToFolder(repo)) },
        { id: "vscode", label: "Open in VS Code", hint: repo.name, icon: <CodeIcon size={13} />, run: after(() => void openInVscode(repo)) },
        {
          id: "pin",
          label: repo.pinned ? "Unpin repository" : "Pin repository",
          hint: repo.name,
          icon: <PinIcon size={13} />,
          run: after(() => void useRepos.getState().setPinned(repo.id, !repo.pinned)),
        },
      );
    }
    list.push(
      { id: "create", label: "Create repository…", icon: <PlusIcon size={13} />, run: after(() => ui.setCreateRepoOpen(true)) },
      { id: "switch", label: "Switch repository (with filters)", hint: "Ctrl P", icon: <SearchIcon size={13} />, run: after(() => ui.setSwitcherOpen(true)) },
      { id: "sync", label: "Sync now", icon: <RefreshIcon size={13} />, run: after(() => void ipc.syncNow()) },
      { id: "theme", label: "Change theme", hint: `now: ${theme}`, icon: <SunIcon size={13} />, run: after(() => ui.cycleTheme()) },
      {
        id: "signout",
        label: "Sign out and clear cache",
        icon: <CommandIcon size={13} />,
        run: after(async () => {
          await useSession.getState().signOut();
          useRepos.getState().clear();
          useNav.getState().reset();
        }),
      },
    );
    return list;
  }, [repo, workflows, theme, close]);
}

function PaletteBody({ close }: { close: () => void }) {
  const byId = useRepos((s) => s.byId);
  const commands = useCommands(close);
  const [query, setQuery] = useState("");
  const [repoIds, setRepoIds] = useState<number[]>([]);
  const [fileHits, setFileHits] = useState<FileHit[]>([]);
  const [issueHits, setIssueHits] = useState<IssueHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const cmdOnly = query.startsWith(">");
  const q = (cmdOnly ? query.slice(1) : query).trim();

  // Rust ranks repos; only the latest response is applied.
  const seq = useRef(0);
  useEffect(() => {
    if (cmdOnly) {
      setRepoIds([]);
      setFileHits([]);
      setIssueHits([]);
      return;
    }
    const n = ++seq.current;
    void ipc.paletteSearch(q, 40, 30, 20).then((r) => {
      if (n !== seq.current) return;
      setRepoIds(r.repos);
      setFileHits(r.files);
      setIssueHits(r.issues);
    });
  }, [q, cmdOnly]);

  const items = useMemo<Item[]>(() => {
    const repos: Item[] = repoIds.flatMap((id) => {
      const repo = byId.get(id);
      return repo ? [{ kind: "repo" as const, repo }] : [];
    });
    const cmds: Item[] = (q
      ? commands
          .map((cmd) => ({ cmd, s: Math.max(fuzzyScore(q, cmd.label), fuzzyScore(q, cmd.hint ?? "") - 300) }))
          .filter((x) => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.cmd)
      : commands
    ).map((cmd) => ({ kind: "cmd" as const, cmd }));
    if (cmdOnly) return cmds;
    const files: Item[] = fileHits.flatMap((hit) => {
      const repo = byId.get(hit.repoId);
      return repo ? [{ kind: "file" as const, hit, repo }] : [];
    });
    const issues: Item[] = issueHits.flatMap((hit) => {
      const repo = byId.get(hit.repoId);
      return repo ? [{ kind: "issue" as const, hit, repo }] : [];
    });
    // A "#123" query is about issues/PRs only. Otherwise strong repo matches first, then files,
    // issues/PRs; empty query: a few recent repos, then commands.
    if (/^#\d+$/.test(q)) return [...issues, ...cmds];
    return q ? [...repos.slice(0, 12), ...files, ...issues, ...repos.slice(12), ...cmds] : [...repos.slice(0, 8), ...cmds];
  }, [repoIds, fileHits, issueHits, byId, commands, q, cmdOnly]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const choose = (it: Item | undefined) => {
    if (!it) return;
    if (it.kind === "repo") {
      close();
      openRepo(it.repo.id);
    } else if (it.kind === "file") {
      close();
      openRepo(it.repo.id);
      useUi.getState().setRepoTab("files");
      // Palette paths come from the default branch.
      useFiles.getState().openFile(it.repo.id, it.hit.path, null);
    } else if (it.kind === "issue") {
      close();
      openRepo(it.repo.id);
      useUi.getState().setRepoTab(it.hit.isPr ? "prs" : "issues");
      useNav.getState().openIssue(it.repo.id, it.hit.number, it.hit.isPr);
    } else it.cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = (d: number) => {
      e.preventDefault();
      setCursor((c) => Math.min(items.length - 1, Math.max(0, c + d)));
    };
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) step(1);
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) step(-1);
    else if (e.key === "PageDown") step(8);
    else if (e.key === "PageUp") step(-8);
    else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[cursor]);
    }
  };

  const firstCmd = items.findIndex((it) => it.kind === "cmd");

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex h-11 items-center gap-2.5 border-b border-line px-3.5">
        <SearchIcon size={14} className="text-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          placeholder="Search repos, files, issues and PRs (#123), or > for commands"
          className="flex-1 bg-transparent text-[14px] outline-none"
        />
      </div>

      <div ref={listRef} className="max-h-[min(460px,58vh)] overflow-y-auto p-1.5">
        {items.length === 0 && <div className="py-8 text-center text-[12px] text-subtle">No results</div>}
        {items.map((it, i) => {
          const sel = i === cursor;
          const prev = items[i - 1]?.kind;
          const header =
            it.kind === prev
              ? null
              : it.kind === "repo"
                ? i === 0 ? "Repositories" : null
                : it.kind === "file"
                  ? "Files"
                  : it.kind === "issue"
                    ? "Issues & pull requests"
                    : i === firstCmd ? "Commands" : null;
          const key =
            it.kind === "repo"
              ? `r${it.repo.id}`
              : it.kind === "file"
                ? `f${it.hit.repoId}:${it.hit.path}`
                : it.kind === "issue"
                  ? `i${it.hit.repoId}#${it.hit.number}`
                  : `c${it.cmd.id}`;
          return (
            <div key={key}>
              {header && <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wide text-subtle">{header}</div>}
              <div
                data-i={i}
                onMouseMove={() => sel || setCursor(i)}
                onClick={() => choose(it)}
                className={`flex h-9 items-center gap-3 rounded-lg px-2.5 ${sel ? "bg-active" : ""}`}
              >
                {it.kind === "repo" ? (
                  <RepoRow repo={it.repo} />
                ) : it.kind === "file" ? (
                  <FileRow hit={it.hit} repo={it.repo} />
                ) : it.kind === "issue" ? (
                  <IssueRow hit={it.hit} repo={it.repo} />
                ) : (
                  <CmdRow cmd={it.cmd} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex h-8 items-center gap-3 border-t border-line px-3 text-[11px] text-subtle">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="flex items-center gap-1"><Kbd>Enter</Kbd> run</span>
        <span className="flex items-center gap-1"><Kbd>&gt;</Kbd> commands only</span>
        <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
      </div>
    </div>
  );
}

function RepoRow({ repo }: { repo: RepoSummary }) {
  return (
    <>
      <RepoGlyph repo={repo} size={14} />
      <div className="min-w-0 flex-1 truncate text-[13px]">
        <span className="text-subtle">{repo.owner}/</span>
        <span className="font-medium text-fg">{repo.name}</span>
        {repo.description && <span className="ml-2 text-[11.5px] text-subtle">{repo.description}</span>}
      </div>
      <span className="shrink-0 text-[11px] text-subtle">{ago(repo.pushedAt)}</span>
    </>
  );
}

function FileRow({ hit, repo }: { hit: FileHit; repo: RepoSummary }) {
  const slash = hit.path.lastIndexOf("/");
  return (
    <>
      <span className="flex w-[14px] shrink-0 justify-center text-subtle">
        <FileIcon size={13} />
      </span>
      <div className="min-w-0 flex-1 truncate text-[13px]">
        <span className="font-medium text-fg">{hit.path.slice(slash + 1)}</span>
        {slash > 0 && <span className="ml-2 font-mono text-[11px] text-subtle">{hit.path.slice(0, slash)}</span>}
      </div>
      <span className="shrink-0 truncate text-[11px] text-subtle">{repo.name}</span>
    </>
  );
}

function IssueRow({ hit, repo }: { hit: IssueHit; repo: RepoSummary }) {
  const Icon = hit.isPr ? PrIcon : IssueIcon;
  const cls = hit.state === "OPEN" ? "text-success" : hit.state === "MERGED" || !hit.isPr ? "text-accent" : "text-danger";
  return (
    <>
      <span className={`flex w-[14px] shrink-0 justify-center ${cls}`}>
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1 truncate text-[13px]">
        <span className="text-fg">{hit.title}</span>
        <span className="ml-2 text-[11px] text-subtle">#{hit.number}</span>
      </div>
      <span className="shrink-0 truncate text-[11px] text-subtle">{repo.name}</span>
    </>
  );
}

function CmdRow({ cmd }: { cmd: Command }) {
  return (
    <>
      <span className="flex w-[14px] shrink-0 justify-center text-subtle">{cmd.icon}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{cmd.label}</span>
      {cmd.hint && <span className="shrink-0 truncate text-[11px] text-subtle">{cmd.hint}</span>}
    </>
  );
}
