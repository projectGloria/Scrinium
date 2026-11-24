// Files tab: branch/tag picker, breadcrumbs, tree and viewer. Everything renders from SQLite;
// branches are revalidated in the background and a tree is fetched once per SHA.
import { useEffect, useState } from "react";
import * as ipc from "../../ipc/commands";
import type { RepoSummary, TreeInfo } from "../../ipc/types";
import { EMPTY_FILES, useFiles } from "../../stores/files";
import { BranchPicker } from "./BranchPicker";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { Delayed } from "./Delayed";

type TreeState = { sha: string; info: TreeInfo | null; error: string | null };

export function FilesPanel({ repo }: { repo: RepoSummary }) {
  const st = useFiles((s) => s.byRepo[repo.id]) ?? EMPTY_FILES;
  const refs = useFiles((s) => s.refs[repo.id]);
  const [refsError, setRefsError] = useState<string | null>(null);
  const [refsDone, setRefsDone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Cached branches at once, then revalidate (Rust skips the request if checked < 1 min ago).
  useEffect(() => {
    let alive = true;
    const { setRefs } = useFiles.getState();
    setRefsError(null);
    setRefsDone(false);
    setRefreshing(true);
    void ipc.refsGet(repo.id).then((r) => alive && r.checkedAt != null && setRefs(repo.id, r)).catch(() => {});
    ipc
      .refsRefresh(repo.id)
      .then((r) => alive && setRefs(repo.id, r))
      .catch((e) => alive && setRefsError(String(e)))
      .finally(() => {
        if (!alive) return;
        setRefsDone(true);
        setRefreshing(false);
      });
    return () => {
      alive = false;
    };
  }, [repo.id]);

  const treeSha = st.ref?.treeSha ?? refs?.defaultTreeSha ?? repo.defaultTreeSha;
  const refName = st.ref?.name ?? refs?.defaultBranch ?? repo.defaultBranch;

  const [tree, setTree] = useState<TreeState | null>(null);
  useEffect(() => {
    if (!treeSha) return setTree(null);
    let alive = true;
    setTree((t) => (t?.sha === treeSha ? t : { sha: treeSha, info: null, error: null }));
    ipc
      .filesTree(repo.id, treeSha)
      .then((info) => alive && setTree({ sha: treeSha, info, error: null }))
      .catch((e) => alive && setTree({ sha: treeSha, info: null, error: String(e) }));
    return () => {
      alive = false;
    };
  }, [repo.id, treeSha]);

  const ready = tree?.sha === treeSha && tree.info != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-3">
        <BranchPicker repo={repo} refs={refs} current={st.ref} refName={refName} refreshing={refreshing} />
        <Breadcrumbs repoId={repo.id} name={repo.name} path={st.open ?? st.sel} />
        {refsError && !refs && <span className="ml-auto shrink-0 text-[11.5px] text-danger">{refsError}</span>}
      </div>

      <div className="mt-3 flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line">
        {!treeSha ? (
          <Center>
            {refsDone ? (refsError ? `Couldn't load branches: ${refsError}` : "This repository is empty.") : <Delayed>Loading branches…</Delayed>}
          </Center>
        ) : tree?.error && tree.sha === treeSha ? (
          <Center>Couldn't load the file tree: {tree.error}</Center>
        ) : !ready ? (
          <Center>
            <Delayed>Fetching file tree…</Delayed>
          </Center>
        ) : (
          <>
            <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
              {tree!.info!.truncated && (
                <div className="border-b border-line px-3 py-1.5 text-[11px] text-warn">
                  Very large repository: GitHub returned only part of the tree.
                </div>
              )}
              <FileTree repoId={repo.id} treeSha={treeSha} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {st.open ? (
                <FileViewer key={`${treeSha}:${st.open}`} repo={repo} treeSha={treeSha} path={st.open} refName={refName} />
              ) : (
                <Center>
                  <span>
                    Pick a file. In the tree: <span className="font-mono">j k</span> move,{" "}
                    <span className="font-mono">h l</span> fold, <span className="font-mono">Enter</span> open.
                  </span>
                </Center>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Breadcrumbs({ repoId, name, path }: { repoId: number; name: string; path: string | null }) {
  const parts = path ? path.split("/") : [];
  const { revealDir, closeFile } = useFiles.getState();
  return (
    <div className="selectable flex min-w-0 flex-1 items-center gap-1 overflow-hidden font-mono text-[12px]">
      <button className="shrink-0 text-muted hover:text-fg hover:underline" onClick={() => closeFile(repoId)}>
        {name}
      </button>
      {parts.map((p, i) => {
        const last = i === parts.length - 1;
        const dir = parts.slice(0, i + 1).join("/");
        return (
          <span key={dir} className={`flex min-w-0 items-center gap-1 ${last ? "" : "shrink-0"}`}>
            <span className="text-subtle">/</span>
            {last ? (
              <span className="truncate text-fg">{p}</span>
            ) : (
              <button className="text-muted hover:text-fg hover:underline" onClick={() => revealDir(repoId, dir)}>
                {p}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-subtle">{children}</div>;
}
