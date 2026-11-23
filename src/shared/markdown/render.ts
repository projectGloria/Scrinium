// Markdown -> sanitized HTML. Loaded lazily (dynamic import) so it never weighs on cold start.
//
// Images that point into the repo (relative paths, or raw/blob URLs of the same repo) can't be
// loaded by the webview directly (private repos, no network access from the UI). They are left
// with an empty src and a `data-repo-path`; the README view resolves them to cached blobs.
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

export interface RenderContext {
  owner: string;
  name: string;
  /** Directory of the markdown file inside the repo ("" for the root), no trailing slash. */
  dir: string;
  defaultBranch: string | null;
  htmlUrl: string;
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

// GitHub-style heading anchors so in-page links (#install) work.
md.core.ruler.push("heading_ids", (state) => {
  const seen = new Map<string, number>();
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "heading_open") continue;
    const text = tokens[i + 1]?.children?.map((t) => t.content).join("") ?? "";
    let slug = text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n) slug += `-${n}`;
    tokens[i].attrSet("id", `user-content-${slug}`);
  }
});

/** Resolves `target` against `dir` inside the repo. Null when it escapes the repo root. */
export function resolveRepoPath(dir: string, target: string): string | null {
  const clean = target.split(/[?#]/)[0];
  const parts = clean.startsWith("/") ? [] : dir.split("/").filter(Boolean);
  for (const seg of clean.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(decodeURIComponent(seg));
  }
  return parts.length ? parts.join("/") : null;
}

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:|^\/\//i;

/** A raw/blob URL of this same repo on its default branch, as a repo path. */
function sameRepoPath(url: string, ctx: RenderContext): string | null {
  const branch = ctx.defaultBranch;
  if (!branch) return null;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const repo = `${esc(ctx.owner)}/${esc(ctx.name)}`;
  const b = esc(branch);
  const m =
    url.match(new RegExp(`^https://raw\\.githubusercontent\\.com/${repo}/(?:refs/heads/)?${b}/(.+)$`, "i")) ??
    url.match(new RegExp(`^https://github\\.com/${repo}/(?:blob|raw)/${b}/(.+?)(?:\\?raw=true)?$`, "i"));
  return m ? resolveRepoPath("", m[1]) : null;
}

export function renderMarkdown(src: string, ctx: RenderContext): string {
  const html = md.render(src);

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "IMG" || node.tagName === "SOURCE") {
      const attr = node.tagName === "IMG" ? "src" : "srcset";
      const value = node.getAttribute(attr) ?? "";
      const repoPath = ABSOLUTE.test(value) ? sameRepoPath(value, ctx) : resolveRepoPath(ctx.dir, value);
      if (repoPath) {
        node.setAttribute("data-repo-path", repoPath);
        node.removeAttribute(attr);
      } else if (!/^https:/i.test(value) && !/^data:image\//i.test(value)) {
        node.removeAttribute(attr);
      }
    }
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        // GitHub prefixes ids in rendered READMEs; authors link to the bare slug.
        node.setAttribute("href", `#user-content-${href.slice(1).replace(/^user-content-/, "")}`);
      } else if (href && !ABSOLUTE.test(href)) {
        // Relative link to another file: open it on GitHub.
        const p = resolveRepoPath(ctx.dir, href);
        const ref = ctx.defaultBranch ?? "HEAD";
        node.setAttribute("href", p ? `${ctx.htmlUrl}/blob/${ref}/${p}` : ctx.htmlUrl);
      }
    }
  });
  try {
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe"],
      FORBID_ATTR: ["style"],
      ADD_ATTR: ["align"],
    });
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}
