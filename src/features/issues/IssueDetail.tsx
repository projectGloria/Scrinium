// One issue or PR: body, labels, status, checks summary (PRs) and comments. The cached copy shows
// at once; body/comments/checks are revalidated in the background. Esc goes back to the list.
import { useEffect, useState } from "react";
import * as ipc from "../../ipc/commands";
import type { Check, RepoSummary } from "../../ipc/types";
import { useIssues, useDetail } from "../../stores/issues";
import { ago } from "../../shared/lib/format";
import { loadRenderer, MarkdownBody } from "../../shared/markdown/MarkdownBody";
import { BranchIcon, ExternalIcon, RefreshIcon } from "../../shared/ui/Icons";
import { Kbd } from "../../shared/ui/Kbd";
import { useNav } from "../../stores/nav";
import { CheckMark, LabelChip, StateBadge } from "./parts";

export function IssueDetail({ repo, number, isPr }: { repo: RepoSummary; number: number; isPr: boolean }) {
  const { detail, error, refreshing } = useDetail(repo.id, number);
  // The list row is enough for the header while the detail loads.
  const row = useIssues((s) => s.lists[`${repo.id}:${isPr ? 1 : 0}`]?.items.find((it) => it.number === number));

  useEffect(() => {
    void useIssues.getState().loadDetail(repo.id, number);
  }, [repo.id, number]);

  const head = detail ?? row;
  const url = detail?.htmlUrl ?? `${repo.htmlUrl}/${isPr ? "pull" : "issues"}/${number}`;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[11.5px] text-subtle">
        <button onClick={() => useNav.getState().back()} className="t-fast flex items-center gap-1.5 hover:text-fg">
          <Kbd>Esc</Kbd> {isPr ? "Pull requests" : "Issues"}
        </button>
        <span className="ml-auto">
          {error ? (
            <span className="text-warn">{detail ? "Offline copy" : "Couldn't load"} · {error}</span>
          ) : detail?.detailAt ? (
            `Checked ${ago(detail.detailAt)} ago`
          ) : refreshing ? (
            "Fetching…"
          ) : null}
        </span>
        <button
          title="Refresh"
          disabled={refreshing}
          onClick={() => void useIssues.getState().loadDetail(repo.id, number, true)}
          className="t-fast flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <RefreshIcon size={12} />
        </button>
      </div>

      <div className="flex items-start gap-3">
        <h2 className="selectable min-w-0 flex-1 text-[17px] font-semibold leading-snug tracking-tight">
          {head?.title ?? ""} <span className="font-normal text-subtle">#{number}</span>
        </h2>
        <button
          onClick={() => void ipc.openExternal(url)}
          className="t-fast flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-muted hover:bg-hover hover:text-fg"
        >
          <ExternalIcon size={12} />
          Open on GitHub
        </button>
      </div>

      {head && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-muted">
          <StateBadge item={head} />
          <span>
            {head.author ?? "ghost"} opened {ago(head.createdAt)} ago
            {head.state === "MERGED" && head.mergedAt ? ` · merged ${ago(head.mergedAt)} ago` : ""}
            {head.state === "CLOSED" && head.closedAt ? ` · closed ${ago(head.closedAt)} ago` : ""}
          </span>
          {detail?.headRef && (
            <span className="flex items-center gap-1 font-mono text-[11px] text-subtle">
              <BranchIcon size={11} />
              {detail.headRef} → {detail.baseRef}
            </span>
          )}
        </div>
      )}

      {head && head.labels.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {head.labels.map((l) => (
            <LabelChip key={l.name} label={l} />
          ))}
        </div>
      )}

      {isPr && detail && detail.checks.length > 0 && <Checks checks={detail.checks} />}

      <div className="mt-5 border-t border-line pt-5">
        {detail ? (
          detail.body ? (
            <Markdown src={detail.body} repo={repo} />
          ) : (
            <p className="text-[12.5px] italic text-subtle">No description provided.</p>
          )
        ) : (
          <div className="py-8 text-center text-[12px] text-subtle">{refreshing ? "Fetching…" : ""}</div>
        )}
      </div>

      {detail && detail.comments.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wide text-subtle">
            {detail.comments.length} comment{detail.comments.length === 1 ? "" : "s"}
          </div>
          <div className="flex flex-col gap-3">
            {detail.comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-line">
                <div className="border-b border-line px-3 py-1.5 text-[11.5px] text-subtle">
                  <span className="text-muted">{c.author ?? "ghost"}</span> · {ago(c.createdAt)} ago
                </div>
                <div className="px-3 py-2">
                  <Markdown src={c.body} repo={repo} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {detail && detail.commentsCount > detail.comments.length && (
        <button
          onClick={() => void ipc.openExternal(url)}
          className="t-fast mt-3 text-[12px] text-accent hover:underline"
        >
          {detail.commentsCount - detail.comments.length} more comments on GitHub
        </button>
      )}
    </div>
  );
}

function Checks({ checks }: { checks: Check[] }) {
  const count = (pred: (s: string) => boolean) => checks.filter((c) => pred(c.state)).length;
  const ok = count((s) => s === "SUCCESS");
  const bad = count((s) => ["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(s));
  const pending = count((s) => ["PENDING", "EXPECTED", "IN_PROGRESS", "QUEUED"].includes(s));
  const other = checks.length - ok - bad - pending;
  const parts = [
    bad && `${bad} failing`,
    pending && `${pending} pending`,
    ok && `${ok} passing`,
    other && `${other} skipped or neutral`,
  ].filter(Boolean);
  return (
    <div className="mt-4 rounded-lg border border-line">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px]">
        <CheckMark state={bad ? "FAILURE" : pending ? "PENDING" : ok ? "SUCCESS" : "NEUTRAL"} />
        <span className="text-muted">Checks: {parts.join(", ")}</span>
      </div>
      <div className="max-h-[200px] overflow-y-auto py-1">
        {checks.map((c, i) => (
          <div key={`${c.name}:${i}`} className="flex items-center gap-2 px-3 py-1 text-[12px]">
            <CheckMark state={c.state} size={12} />
            <span className="min-w-0 flex-1 truncate text-fg">{c.name}</span>
            <span className="text-[10.5px] lowercase text-subtle">{c.state.replace(/_/g, " ")}</span>
            {c.url && (
              <button title="Open details" onClick={() => void ipc.openExternal(c.url!)} className="t-fast text-subtle hover:text-fg">
                <ExternalIcon size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Issue/comment markdown (rendered lazily, relative links resolve against the repo root). */
function Markdown({ src, repo }: { src: string; repo: RepoSummary }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadRenderer().then(({ renderMarkdown }) => {
      if (!alive) return;
      setHtml(
        renderMarkdown(src, { owner: repo.owner, name: repo.name, dir: "", defaultBranch: repo.defaultBranch, htmlUrl: repo.htmlUrl }),
      );
    });
    return () => {
      alive = false;
    };
  }, [src, repo.owner, repo.name, repo.defaultBranch, repo.htmlUrl]);
  return html == null ? null : <MarkdownBody html={html} repoId={repo.id} />;
}
