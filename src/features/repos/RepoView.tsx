import { useEffect } from "react";
import type { Language } from "../../ipc/types";
import { useRepos } from "../../stores/repos";
import { ago, compact } from "../../shared/lib/format";
import { BranchIcon, ClockIcon, ForkIcon, IssueIcon, PinIcon, PrIcon, StarIcon } from "../../shared/ui/Icons";
import { useUi, type RepoTab } from "../../stores/ui";
import { Readme } from "../readme/Readme";
import { ActionsPanel } from "../actions/ActionsPanel";
import { FilesPanel } from "../files/FilesPanel";
import { IssuesPanel } from "../issues/IssuesPanel";
import { IssueDetail } from "../issues/IssueDetail";
import { useNav } from "../../stores/nav";
import { RepoGlyph } from "./RepoGlyph";

export function RepoView({ repoId }: { repoId: number }) {
  const repo = useRepos((s) => s.byId.get(repoId));
  const langs = useRepos((s) => s.languages[repoId]);
  const loadLanguages = useRepos((s) => s.loadLanguages);
  const setPinned = useRepos((s) => s.setPinned);
  const tab = useUi((s) => s.repoTab);
  const route = useNav((s) => s.stack[s.stack.length - 1]);

  useEffect(() => {
    void loadLanguages(repoId);
  }, [repoId, langs, loadLanguages]);

  if (!repo) {
    return (
      <div className="flex flex-1 items-center justify-center text-subtle">
        This repository is no longer available to your account.
      </div>
    );
  }

  // Files and the issue/PR lists fill the window height (they scroll on their own); the rest scroll the page.
  const isList = tab === "issues" || tab === "prs";
  const detail = isList && route.kind === "issue" && route.isPr === (tab === "prs") ? route : null;
  const fill = tab === "files" || (isList && !detail);
  return (
    <div className={`min-w-0 flex-1 overflow-y-auto ${fill ? "flex flex-col" : ""}`}>
      <div className={`mx-auto w-full px-8 ${fill ? "flex min-h-[560px] max-w-[1280px] flex-1 flex-col pb-4 pt-6" : "max-w-[920px] py-6"}`}>
        <div className="flex items-start gap-3">
          {repo.iconSha && <RepoGlyph repo={repo} size={29} />}
          <div className="min-w-0 flex-1">
            <h1 className="selectable truncate text-[18px] font-semibold tracking-tight">
              <span className="font-normal text-muted">{repo.owner} / </span>
              {repo.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge>{repo.isPrivate ? "Private" : "Public"}</Badge>
              {repo.isFork && <Badge>Fork</Badge>}
              {repo.isArchived && <Badge tone="warn">Archived</Badge>}
            </div>
          </div>
          <button
            onClick={() => void setPinned(repo.id, !repo.pinned)}
            className={`t-fast flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] ${
              repo.pinned ? "border-line-strong bg-active text-fg" : "border-line text-muted hover:bg-hover hover:text-fg"
            }`}
          >
            <PinIcon size={12} filled={repo.pinned} />
            {repo.pinned ? "Pinned" : "Pin"}
          </button>
        </div>

        {repo.description && <p className="selectable mt-3 text-[13.5px] text-muted">{repo.description}</p>}

        {repo.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {repo.topics.map((t) => (
              <span key={t} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted">
          <Stat icon={<StarIcon size={13} />} label={`${compact(repo.stars)} stars`} />
          <Stat icon={<ForkIcon size={13} />} label={`${compact(repo.forks)} forks`} />
          <Stat icon={<IssueIcon size={13} />} label={`${compact(repo.openIssues)} open issues`} />
          <Stat icon={<PrIcon size={13} />} label={`${compact(repo.openPrs)} open PRs`} />
          {repo.defaultBranch && <Stat icon={<BranchIcon size={13} />} label={repo.defaultBranch} mono />}
          <Stat
            icon={<ClockIcon size={13} />}
            label={repo.pushedAt ? `pushed ${ago(repo.pushedAt)} ago` : "never pushed"}
            title={repo.pushedAt ? new Date(repo.pushedAt * 1000).toLocaleString() : undefined}
          />
        </div>

        {langs && langs.length > 0 && <LanguageBar langs={langs} />}

        <Tabs repoOpenIssues={repo.openIssues} repoOpenPrs={repo.openPrs} />
        {fill ? (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            {tab === "files" ? <FilesPanel repo={repo} /> : <IssuesPanel key={tab} repo={repo} isPr={tab === "prs"} />}
          </div>
        ) : (
          <div className="mt-5">
            {detail ? (
              <IssueDetail key={`${detail.isPr}:${detail.number}`} repo={repo} number={detail.number} isPr={detail.isPr} />
            ) : tab === "readme" ? (
              <Readme repo={repo} />
            ) : (
              <ActionsPanel repo={repo} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Tabs({ repoOpenIssues, repoOpenPrs }: { repoOpenIssues: number; repoOpenPrs: number }) {
  const tab = useUi((s) => s.repoTab);
  const setTab = useUi((s) => s.setRepoTab);
  const items: [RepoTab, string, string, number?][] = [
    ["readme", "README", "g d"],
    ["files", "Files", "g f"],
    ["issues", "Issues", "g i", repoOpenIssues],
    ["prs", "Pull requests", "g p", repoOpenPrs],
    ["actions", "Actions", "g a"],
  ];
  return (
    <div className="mt-7 flex gap-1 border-b border-line">
      {items.map(([id, label, keys, n]) => (
        <button
          key={id}
          title={keys}
          onClick={() => setTab(id)}
          className={`t-fast -mb-px border-b-2 px-3 pb-2 pt-1 text-[12.5px] ${
            tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
          }`}
        >
          {label}
          {!!n && <span className="ml-1.5 rounded-full bg-active px-1.5 text-[10.5px] text-muted">{compact(n)}</span>}
        </button>
      ))}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <span
      className={`rounded-full border px-2 py-px text-[11px] ${
        tone === "warn" ? "border-warn/40 text-warn" : "border-line-strong text-muted"
      }`}
    >
      {children}
    </span>
  );
}

function Stat({ icon, label, mono, title }: { icon: React.ReactNode; label: string; mono?: boolean; title?: string }) {
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <span className="text-subtle">{icon}</span>
      <span className={mono ? "font-mono text-[11.5px]" : ""}>{label}</span>
    </span>
  );
}

function LanguageBar({ langs }: { langs: Language[] }) {
  const total = langs.reduce((n, l) => n + l.bytes, 0) || 1;
  return (
    <div className="mt-5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-active">
        {langs.map((l) => (
          <div
            key={l.name}
            title={`${l.name} ${((l.bytes / total) * 100).toFixed(1)}%`}
            style={{ width: `${(l.bytes / total) * 100}%`, background: l.color ?? "var(--fg-subtle)" }}
            className="border-r border-bg last:border-r-0"
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
        {langs.map((l) => (
          <span key={l.name} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: l.color ?? "var(--fg-subtle)" }} />
            <span className="text-fg">{l.name}</span>
            <span className="text-subtle">{((l.bytes / total) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
