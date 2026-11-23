// Workflows and recent runs of a repo. Cached rows show at once; a refresh follows.
import { useEffect, useMemo, useState } from "react";
import * as ipc from "../../ipc/commands";
import type { RepoSummary, Run, Workflow } from "../../ipc/types";
import { isLive, useActions } from "../../stores/actions";
import { useUi } from "../../stores/ui";
import { ago } from "../../shared/lib/format";
import { ExternalIcon, PlayIcon, RefreshIcon, WorkflowIcon } from "../../shared/ui/Icons";
import { RunStatus } from "./RunStatus";

/** While a run is queued or in progress, re-check this often. */
const LIVE_POLL_MS = 10_000;

export function ActionsPanel({ repo }: { repo: RepoSummary }) {
  const data = useActions((s) => s.byRepo[repo.id]);
  const error = useActions((s) => s.errors[repo.id]);
  const refreshing = useActions((s) => !!s.refreshing[repo.id]);
  const [filter, setFilter] = useState<number | null>(null);

  useEffect(() => {
    setFilter(null);
    void useActions.getState().load(repo.id);
  }, [repo.id]);

  const live = !!data?.runs.some((r) => isLive(r.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void useActions.getState().refresh(repo.id), LIVE_POLL_MS);
    return () => clearInterval(t);
  }, [live, repo.id]);

  const names = useMemo(() => new Map(data?.workflows.map((w) => [w.id, w.name])), [data]);
  const runs = useMemo(
    () => (filter == null ? data?.runs : data?.runs.filter((r) => r.workflowId === filter)) ?? [],
    [data, filter],
  );

  if (!data || data.checkedAt == null) {
    if (error) return <Note>Couldn't load Actions: {error}</Note>;
    return <Note>{refreshing ? "Fetching workflows…" : ""}</Note>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[11.5px] text-subtle">
        <span>{error ? <span className="text-warn">Offline copy · {error}</span> : `Checked ${ago(data.checkedAt)} ago`}</span>
        <button
          title="Refresh"
          disabled={refreshing}
          onClick={() => void useActions.getState().refresh(repo.id)}
          className="t-fast ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <RefreshIcon size={12} />
        </button>
      </div>

      {data.workflows.length === 0 ? (
        <Note>This repository has no workflows.</Note>
      ) : (
        <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-5">
          <WorkflowList repo={repo} workflows={data.workflows} filter={filter} setFilter={setFilter} />
          <div className="min-w-0">
            <div className="mb-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wide text-subtle">
              {filter == null ? "Recent runs" : `Runs of ${names.get(filter) ?? "workflow"}`}
            </div>
            {runs.length === 0 ? (
              <Note>No runs yet.</Note>
            ) : (
              <div className="flex flex-col">
                {runs.map((r) => (
                  <RunRow key={r.id} run={r} workflow={names.get(r.workflowId)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowList({
  repo,
  workflows,
  filter,
  setFilter,
}: {
  repo: RepoSummary;
  workflows: Workflow[];
  filter: number | null;
  setFilter: (id: number | null) => void;
}) {
  const setRunDialog = useUi((s) => s.setRunDialog);
  const row = (active: boolean) =>
    `t-fast group flex h-8 items-center gap-2 rounded-md px-2 text-[12.5px] ${
      active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"
    }`;
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wide text-subtle">Workflows</div>
      <div className={row(filter == null)} onClick={() => setFilter(null)}>
        <span className="flex-1">All workflows</span>
      </div>
      {workflows.map((w) => {
        const canRun = w.dispatchable && w.state === "active" && !repo.isArchived;
        return (
          <div key={w.id} className={row(filter === w.id)} onClick={() => setFilter(w.id)} title={w.path}>
            <WorkflowIcon size={12} className="shrink-0 text-subtle" />
            <span className={`min-w-0 flex-1 truncate ${w.state === "active" ? "" : "line-through opacity-60"}`}>{w.name}</span>
            {canRun && (
              <button
                title="Run workflow"
                onClick={(e) => {
                  e.stopPropagation();
                  setRunDialog({ repoId: repo.id, workflowId: w.id });
                }}
                className="t-fast flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:border-line-strong hover:text-fg"
              >
                <PlayIcon size={10} />
                Run
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunRow({ run, workflow }: { run: Run; workflow: string | undefined }) {
  return (
    <div
      onClick={() => void ipc.openExternal(run.htmlUrl)}
      title="Open on GitHub"
      className="t-fast group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover"
    >
      <RunStatus run={run} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-fg">{run.title || run.name || workflow || `Run ${run.runNumber}`}</div>
        <div className="truncate text-[11px] text-subtle">
          {workflow ?? run.name} #{run.runNumber}
          {run.headBranch && <span className="font-mono"> · {run.headBranch}</span>}
          {` · ${run.event.replace(/_/g, " ")}`}
          {run.actor && ` · ${run.actor}`}
        </div>
      </div>
      <span className="shrink-0 text-[11px] text-subtle" title={new Date(run.createdAt * 1000).toLocaleString()}>
        {isLive(run.status) ? (run.status ?? "").replace(/_/g, " ") : ago(run.updatedAt)}
      </span>
      <ExternalIcon size={12} className="shrink-0 text-subtle opacity-0 group-hover:opacity-100" />
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-[12px] text-subtle">{children}</div>;
}
