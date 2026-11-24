// Rendered markdown (README and markdown files in the Files tab): resolves repo-relative images to
// cached blobs and routes link clicks (in-page anchors scroll, web links open in the browser).
import { useLayoutEffect, useRef } from "react";
import * as ipc from "../../ipc/commands";
import { blobUrl } from "../blobUrl";

type Renderer = typeof import("./render");
let renderer: Promise<Renderer> | null = null;
export const loadRenderer = () => (renderer ??= import("./render"));

/** Resolved images: "repoId:path" -> blob sha (null = not in the repo). */
const assetCache = new Map<string, string | null>();

export function MarkdownBody({ html, repoId }: { html: string; repoId: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let alive = true;
    root.querySelectorAll<HTMLImageElement | HTMLSourceElement>("[data-repo-path]").forEach((el) => {
      const path = el.dataset.repoPath!;
      const key = `${repoId}:${path}`;
      const apply = (sha: string | null) => {
        if (!alive || !sha) return;
        if (el instanceof HTMLSourceElement) el.srcset = blobUrl(sha);
        else el.src = blobUrl(sha);
      };
      if (assetCache.has(key)) return apply(assetCache.get(key)!);
      void ipc
        .repoAsset(repoId, path)
        .then((sha) => {
          assetCache.set(key, sha);
          apply(sha);
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [html, repoId]);

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

  return <div ref={ref} className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
