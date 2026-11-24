// File viewer: code with line numbers (virtualized, Shiki highlighting swapped in once ready),
// images, markdown preview, and a note for binary or very large files.
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as ipc from "../../ipc/commands";
import type { FileContent, FileEntry, RepoSummary } from "../../ipc/types";
import { blobUrl } from "../../shared/blobUrl";
import { highlight, HIGHLIGHT_MAX_LINES, type ThemedToken } from "../../shared/highlight/shiki";
import { loadRenderer, MarkdownBody } from "../../shared/markdown/MarkdownBody";
import { ExternalIcon } from "../../shared/ui/Icons";
import { Delayed } from "./Delayed";

/** Recently viewed files by blob SHA, so going back to a file is instant. */
const contentCache = new Map<string, FileContent>();
const CONTENT_CACHE_MAX = 16;
const tokenCache = new Map<string, ThemedToken[][]>();

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; entry: FileEntry; content: FileContent };

const LINE = 20;

export function FileViewer({ repo, treeSha, path, refName }: { repo: RepoSummary; treeSha: string; path: string; refName: string | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [mode, setMode] = useState<"preview" | "code">("preview");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const entry = await ipc.filesLookup(treeSha, path);
        if (!alive) return;
        if (!entry || entry.kind !== "blob") return setState({ kind: "missing" });
        let content = contentCache.get(entry.sha);
        if (!content) {
          content = await ipc.fileGet(repo.id, entry.sha, path, entry.size);
          contentCache.set(entry.sha, content);
          if (contentCache.size > CONTENT_CACHE_MAX) contentCache.delete(contentCache.keys().next().value!);
        }
        if (alive) setState({ kind: "ready", entry, content });
      } catch (e) {
        if (alive) setState({ kind: "error", message: String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [repo.id, treeSha, path]);

  const webUrl = `${repo.htmlUrl}/blob/${encodeURIComponent(refName ?? "HEAD")}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const lower = path.toLowerCase();
  const isMd = /\.(md|markdown|mdx)$/.test(lower);
  const isSvg = lower.endsWith(".svg");

  if (state.kind === "loading") return <Note><Delayed>Fetching file…</Delayed></Note>;
  if (state.kind === "missing") return <Note>This file doesn't exist on {refName ?? "this ref"}.</Note>;
  if (state.kind === "error") return <Note>Couldn't load the file: {state.message}</Note>;

  const { entry, content } = state;
  const text = content.text;
  const canToggle = (isMd || isSvg) && text != null;
  const lineCount = text != null ? countLines(text) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3 text-[11.5px] text-subtle">
        <span>{size(content.size || entry.size || 0)}</span>
        {lineCount != null && content.kind === "text" && <span>{lineCount.toLocaleString()} lines</span>}
        {canToggle && (
          <div className="flex overflow-hidden rounded-md border border-line">
            {(["preview", "code"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`t-fast px-2 py-0.5 ${mode === m ? "bg-active text-fg" : "text-muted hover:text-fg"}`}
              >
                {m === "preview" ? "Preview" : "Code"}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => void ipc.openExternal(webUrl)} className="ml-auto flex items-center gap-1 text-muted hover:text-fg">
          <ExternalIcon size={11} /> Open on GitHub
        </button>
      </div>

      {content.kind === "image" && !(isSvg && mode === "code") ? (
        <div className="checker flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          <img src={blobUrl(entry.sha)} alt={path} className="max-h-full max-w-full object-contain" />
        </div>
      ) : content.kind === "large" ? (
        <Note>This file is too large to show here ({size(content.size || entry.size || 0)}).</Note>
      ) : content.kind === "binary" || text == null ? (
        <Note>Binary file{content.mime ? ` (${content.mime})` : ""}.</Note>
      ) : isMd && mode === "preview" ? (
        <MarkdownPreview repo={repo} path={path} refName={refName} text={text} />
      ) : (
        <Code text={text} path={path} sha={entry.sha} />
      )}
    </div>
  );
}

function MarkdownPreview({ repo, path, refName, text }: { repo: RepoSummary; path: string; refName: string | null; text: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadRenderer().then(({ renderMarkdown }) => {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const out = renderMarkdown(text, { owner: repo.owner, name: repo.name, dir, defaultBranch: refName, htmlUrl: repo.htmlUrl });
      if (alive) setHtml(out);
    });
    return () => {
      alive = false;
    };
  }, [repo.owner, repo.name, repo.htmlUrl, path, refName, text]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">{html != null && <MarkdownBody html={html} repoId={repo.id} />}</div>
  );
}

function countLines(text: string) {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
  return text.endsWith("\n") ? n - 1 : n;
}

function Code({ text, path, sha }: { text: string; path: string; sha: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => {
    const l = text.replace(/\r\n?/g, "\n").split("\n");
    if (l.length > 1 && l[l.length - 1] === "") l.pop();
    return l;
  }, [text]);
  // Widest line in characters (tabs as 4) sizes the horizontal scroll area.
  const widest = useMemo(() => lines.reduce((m, l) => Math.max(m, l.length + 3 * (l.split("\t").length - 1)), 0), [lines]);
  const gutter = String(lines.length).length;

  const key = `${sha}:${path}`;
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(() => tokenCache.get(key) ?? null);
  useEffect(() => {
    if (tokenCache.has(key) || lines.length > HIGHLIGHT_MAX_LINES) return;
    let alive = true;
    // Plain text shows first; highlighting is swapped in when the grammar has loaded.
    void highlight(lines.join("\n"), path)
      .then((t) => {
        if (!t) return;
        tokenCache.set(key, t);
        if (tokenCache.size > CONTENT_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value!);
        if (alive) setTokens(t);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, lines, path]);

  const virt = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE,
    overscan: 30,
  });

  return (
    <div ref={scrollRef} className="selectable code-lines min-h-0 flex-1 overflow-auto bg-bg py-2 font-mono text-[12.5px]">
      <div style={{ height: virt.getTotalSize(), width: `calc(${widest + gutter + 4}ch + 2rem)`, minWidth: "100%", position: "relative" }}>
        {virt.getVirtualItems().map((v) => {
          const toks = tokens?.[v.index];
          return (
            <div key={v.index} className="absolute left-0 flex w-full" style={{ top: v.start, height: LINE, lineHeight: `${LINE}px` }}>
              <span
                className="sticky left-0 shrink-0 select-none bg-bg pr-4 text-right text-subtle"
                style={{ width: `calc(${gutter}ch + 1.75rem)` }}
              >
                {v.index + 1}
              </span>
              <span className="whitespace-pre pr-6 text-fg">
                {toks
                  ? toks.map((t, i) => (
                      <span key={i} className="code-tok" style={t.htmlStyle as React.CSSProperties}>
                        {t.content}
                      </span>
                    ))
                  : lines[v.index] || " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function size(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-subtle">{children}</div>;
}
