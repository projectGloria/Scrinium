// README of the default branch. Cached copy renders at once; a conditional request (ETag)
// revalidates it in the background and swaps it in only if it changed.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as ipc from "../../ipc/commands";
import type { Readme as ReadmeData, RepoSummary } from "../../ipc/types";
import { blobUrl } from "../../shared/blobUrl";

type Renderer = typeof import("../../shared/markdown/render");
let renderer: Promise<Renderer> | null = null;
const loadRenderer = () => (renderer ??= import("../../shared/markdown/render"));

/** Rendered HTML by repo + blob sha, so switching back to a repo doesn't re-render. */
const htmlCache = new Map<string, string>();
const HTML_CACHE_MAX = 24;
/** Resolved README images: "repoId:path" -> blob sha (null = not in the repo). */
const assetCache = new Map<string, string | null>();

/** Warms the README for a repo the user is likely to open next (sidebar cursor). */
export function prefetchReadme(repoId: number) {
  void loadRenderer();
  void ipc.readmeRefresh(repoId).catch(() => {});
}

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "ready"; readme: ReadmeData; html: string };

export function Readme({ repo }: { repo: RepoSummary }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const show = async (r: ReadmeData | null) => {
      if (!r) return false;
      const key = `${repo.id}:${r.sha}`;
      let html = htmlCache.get(key);
      if (html === undefined) {
        const { renderMarkdown } = await loadRenderer();
        const dir = r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/")) : "";
        html = renderMarkdown(r.text, {
          owner: repo.owner,
          name: repo.name,
          dir,
          defaultBranch: repo.defaultBranch,
          htmlUrl: repo.htmlUrl,
        });
        htmlCache.set(key, html);
        if (htmlCache.size > HTML_CACHE_MAX) htmlCache.delete(htmlCache.keys().next().value!);
      }
      if (alive) setState((s) => (s.kind === "ready" && s.readme.sha === r.sha ? s : { kind: "ready", readme: r, html: html! }));
      return true;
    };

    setState({ kind: "loading" });
    void (async () => {
      const cached = await ipc.readmeGet(repo.id).catch(() => null);
      const had = await show(cached);
      if (!alive) return;
      setRefreshing(true);
      try {
        const fresh = await ipc.readmeRefresh(repo.id);
        if (!alive) return;
        if (fresh) await show(fresh);
        else setState({ kind: "none" });
      } catch (e) {
        // Offline or rate limited: keep showing the cached copy if we have one.
        if (alive && !had) setState({ kind: "error", message: String(e) });
      } finally {
        if (alive) setRefreshing(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [repo.id, repo.owner, repo.name, repo.defaultBranch, repo.htmlUrl]);

  // Point repo-relative images at cached blobs (fetched through Rust on first view).
  const html = state.kind === "ready" ? state.html : null;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !html) return;
    let alive = true;
    root.querySelectorAll<HTMLImageElement | HTMLSourceElement>("[data-repo-path]").forEach((el) => {
      const path = el.dataset.repoPath!;
      const key = `${repo.id}:${path}`;
      const apply = (sha: string | null) => {
        if (!alive || !sha) return;
        if (el instanceof HTMLSourceElement) el.srcset = blobUrl(sha);
        else el.src = blobUrl(sha);
      };
      if (assetCache.has(key)) return apply(assetCache.get(key)!);
      void ipc
        .repoAsset(repo.id, path)
        .then((sha) => {
          assetCache.set(key, sha);
          apply(sha);
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [html, repo.id]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      ref.current?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: "start" });
    } else if (/^https?:\/\//i.test(href)) {
      void ipc.openExternal(href);
    }
  };

  if (state.kind === "loading") {
    // Only reached when nothing is cached yet.
    return <Placeholder>{refreshing ? "Fetching README…" : ""}</Placeholder>;
  }
  if (state.kind === "none") return <Placeholder>This repository has no README.</Placeholder>;
  if (state.kind === "error") return <Placeholder>Couldn't load the README: {state.message}</Placeholder>;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[11.5px] text-subtle">
        <span className="font-mono">{state.readme.path}</span>
      </div>
      <div ref={ref} className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: state.html }} />
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-[12px] text-subtle">{children}</div>;
}
