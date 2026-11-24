// Syntax highlighting with Shiki, loaded lazily: the core, the regex engine, both themes and each
// grammar are separate chunks fetched on first use, so none of it touches cold start.
import type { HighlighterCore, ThemedToken } from "shiki/core";

export type { ThemedToken };

/** Files bigger than this are shown as plain text (tokenizing runs on the UI thread). */
export const HIGHLIGHT_MAX_BYTES = 200_000;
export const HIGHLIGHT_MAX_LINES = 8_000;

const THEMES = { light: "github-light-default", dark: "github-dark-default" } as const;

let core: Promise<{ hl: HighlighterCore; langs: typeof import("shiki/langs") }> | null = null;
const loading = new Map<string, Promise<void>>();

function load() {
  return (core ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, themes, langs] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("shiki/themes"),
      import("shiki/langs"),
    ]);
    const hl = await createHighlighterCore({
      themes: [themes.bundledThemes[THEMES.light](), themes.bundledThemes[THEMES.dark]()],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
    return { hl, langs };
  })());
}

const BY_NAME: Record<string, string> = {
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  "cmakelists.txt": "cmake",
  "cargo.lock": "toml",
  "go.mod": "go",
  ".env": "dotenv",
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
  ".profile": "shellscript",
  ".editorconfig": "ini",
  ".gitconfig": "ini",
  ".gitmodules": "ini",
  ".npmrc": "ini",
  "package-lock.json": "json",
};

const BY_EXT: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  py: "python", pyi: "python", pyw: "python", rs: "rust", rb: "ruby", go: "go",
  md: "markdown", markdown: "markdown", mdx: "mdx", yml: "yaml", yaml: "yaml",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", fish: "fish",
  ps1: "powershell", psm1: "powershell", psd1: "powershell", bat: "bat", cmd: "bat",
  cs: "csharp", csx: "csharp", fs: "fsharp", fsx: "fsharp", vb: "vb",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", ino: "cpp",
  m: "objective-c", mm: "objective-cpp", swift: "swift", kt: "kotlin", kts: "kotlin", java: "java",
  scala: "scala", groovy: "groovy", gradle: "groovy", dart: "dart", php: "php", lua: "lua",
  ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", ml: "ocaml", clj: "clojure",
  r: "r", jl: "julia", pl: "perl", zig: "zig", nim: "nim", v: "v", sol: "solidity",
  json: "json", jsonc: "jsonc", json5: "json5", toml: "toml", ini: "ini", cfg: "ini", conf: "ini",
  xml: "xml", svg: "xml", csproj: "xml", vbproj: "xml", fsproj: "xml", props: "xml", targets: "xml",
  xaml: "xml", plist: "xml", resx: "xml", html: "html", htm: "html", xhtml: "html",
  css: "css", scss: "scss", sass: "sass", less: "less", vue: "vue", svelte: "svelte", astro: "astro",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "proto", tf: "terraform", hcl: "hcl",
  nix: "nix", cmake: "cmake", mk: "make", dockerfile: "docker", diff: "diff", patch: "diff",
  tex: "latex", bib: "bibtex", glsl: "glsl", vert: "glsl", frag: "glsl", wgsl: "wgsl", hlsl: "hlsl",
  gd: "gdscript", gdshader: "gdshader", prisma: "prisma", razor: "razor", cshtml: "razor",
  asm: "asm", s: "asm", csv: "csv", tsv: "tsv", log: "log", env: "dotenv", vim: "viml",
};

/** Shiki language id for a path, or null for plain text. */
export function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) return "docker";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 && !name.startsWith(".")) return null;
  const ext = name.slice(dot + 1);
  return BY_EXT[ext] ?? ext;
}

/**
 * Tokens per line, each carrying `--shiki-light` / `--shiki-dark` colors (see `.code-tok` in
 * index.css). Null when the language isn't known or the file is too big.
 */
export async function highlight(text: string, path: string): Promise<ThemedToken[][] | null> {
  const lang = languageFor(path);
  if (!lang || text.length > HIGHLIGHT_MAX_BYTES) return null;
  const { hl, langs } = await load();
  const loader = (langs.bundledLanguages as Record<string, (() => Promise<unknown>) | undefined>)[lang];
  if (!loader) return null;
  let p = loading.get(lang);
  if (!p) {
    p = loader().then((m) => hl.loadLanguage((m as { default: Parameters<HighlighterCore["loadLanguage"]>[0] }).default));
    loading.set(lang, p);
  }
  await p;
  const resolved = hl.getLoadedLanguages().includes(lang) ? lang : null;
  if (!resolved) return null;
  return hl.codeToTokens(text, { lang: resolved, themes: THEMES, defaultColor: false }).tokens;
}
