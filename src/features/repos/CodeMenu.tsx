// "Code" button in the repo header: clone URLs (HTTPS/SSH) with copy, clone to a folder, VS Code.
import { useEffect, useRef, useState } from "react";
import type { RepoSummary } from "../../ipc/types";
import { CodeIcon, CopyIcon, DownloadIcon } from "../../shared/ui/Icons";
import { cloneToFolder, copyCloneUrl, openInVscode } from "./quick";

export function CodeMenu({ repo }: { repo: RepoSummary }) {
  const [open, setOpen] = useState(false);
  const [ssh, setSsh] = useState(() => localStorage.getItem("scrinium.cloneSsh") === "1");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pickSsh = (v: boolean) => {
    setSsh(v);
    localStorage.setItem("scrinium.cloneSsh", v ? "1" : "0");
  };
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const url = ssh ? repo.sshUrl : repo.cloneUrl;
  const row = "t-fast flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[12.5px] text-fg hover:bg-hover";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`t-fast flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] ${
          open ? "border-line-strong bg-active text-fg" : "border-line text-muted hover:bg-hover hover:text-fg"
        }`}
      >
        <CodeIcon size={12} />
        Code
      </button>
      {open && (
        <div
          className="absolute right-0 top-9 z-30 w-[340px] rounded-xl border border-line bg-elev p-2"
          style={{ boxShadow: "var(--shadow)" }}
        >
          <div className="mb-2 flex items-center gap-1 px-1">
            <span className="mr-auto text-[11px] font-medium uppercase tracking-wide text-subtle">Clone</span>
            {(["HTTPS", "SSH"] as const).map((p) => (
              <button
                key={p}
                onClick={() => pickSsh(p === "SSH")}
                className={`t-fast h-6 rounded px-2 text-[11.5px] ${(p === "SSH") === ssh ? "bg-active text-fg" : "text-muted hover:text-fg"}`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="mb-1.5 flex h-8 items-center gap-1 rounded-md border border-line bg-bg pl-2.5 pr-1">
            <span className="selectable min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{url}</span>
            <button
              title="Copy"
              onClick={run(() => void copyCloneUrl(repo, ssh))}
              className="t-fast flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
            >
              <CopyIcon size={12} />
            </button>
          </div>
          <button className={row} onClick={run(() => void cloneToFolder(repo, ssh))}>
            <DownloadIcon size={13} className="text-muted" />
            <span className="flex-1">Clone to folder…</span>
            <span className="text-[11px] text-subtle">git clone</span>
          </button>
          <button className={row} onClick={run(() => void openInVscode(repo))}>
            <CodeIcon size={13} className="text-muted" />
            <span className="flex-1">Open in VS Code</span>
            <span className="max-w-[150px] truncate text-[11px] text-subtle" title={repo.clonePath ?? undefined}>
              {repo.clonePath ? "local clone" : "clones via VS Code"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
