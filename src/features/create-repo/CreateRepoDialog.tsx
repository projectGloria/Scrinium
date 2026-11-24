// "Create repository" dialog. Submitting is one of the app's two GitHub writes
// (POST /user/repos, in Rust's write.rs). The new repo is stored and opened right away.
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as ipc from "../../ipc/commands";
import type { Templates } from "../../ipc/types";
import { useRepos } from "../../stores/repos";
import { useSession } from "../../stores/session";
import { useUi } from "../../stores/ui";
import { openRepo } from "../repos/open";
import { LockIcon, PlusIcon, RepoIcon } from "../../shared/ui/Icons";

export function CreateRepoDialog() {
  const open = useUi((s) => s.createRepoOpen);
  const setOpen = useUi((s) => s.setCreateRepoOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ background: "var(--overlay)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[80vh] w-[min(480px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-elev"
          style={{ boxShadow: "var(--shadow)" }}
        >
          {open && <CreateForm close={() => setOpen(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Templates are cached for the session after the first open (Rust caches them in SQLite too).
let templatesCache: Templates | null = null;

/** GitHub turns anything outside [A-Za-z0-9._-] into "-"; show the name it will actually get. */
function normalize(name: string) {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
}

function CreateForm({ close }: { close: () => void }) {
  const login = useSession((s) => s.account?.login ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(true);
  const [addReadme, setAddReadme] = useState(true);
  const [gitignore, setGitignore] = useState("");
  const [license, setLicense] = useState("");
  const [templates, setTemplates] = useState<Templates | null>(templatesCache);
  const [templatesError, setTemplatesError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (templatesCache) return;
    ipc
      .repoTemplates()
      .then((t) => {
        templatesCache = t;
        setTemplates(t);
      })
      .catch(() => setTemplatesError(true));
  }, []);

  useEffect(() => setError(null), [name, description, isPrivate, addReadme, gitignore, license]);

  const finalName = normalize(name);
  const taken = useRepos((s) => s.repos.some((r) => r.owner === login && r.name.toLowerCase() === finalName.toLowerCase()));
  const canSubmit = !busy && finalName !== "" && !taken;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const id = await ipc.repoCreate({
        name: finalName,
        description,
        private: isPrivate,
        addReadme,
        gitignoreTemplate: gitignore || null,
        licenseTemplate: license || null,
      });
      await useRepos.getState().load();
      close();
      openRepo(id);
      useUi.getState().notify(`Created ${login}/${finalName}`, "ok");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const field = "h-7 w-full rounded-md border border-line bg-bg px-2 text-[12.5px] outline-none focus:border-accent";
  const loadingText = templatesError ? "Couldn't load (offline?)" : "Loading…";

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <Dialog.Title className="text-[14px] font-semibold">Create repository</Dialog.Title>
        <div className="mt-0.5 text-[12px] text-muted">On your account{login ? ` (${login})` : ""}</div>
      </div>

      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-4 py-4">
        <Field label="Name" required>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} className={`${field} font-mono`} />
          {finalName && finalName !== name.trim() && !taken && (
            <span className="text-[11px] text-subtle">
              Will be created as <span className="font-mono text-muted">{finalName}</span>
            </span>
          )}
          {taken && <span className="text-[11px] text-danger">You already have a repository named {finalName}.</span>}
        </Field>

        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
        </Field>

        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-muted">Visibility</span>
          <div className="grid grid-cols-2 gap-2">
            {([false, true] as const).map((priv) => (
              <button
                key={String(priv)}
                type="button"
                onClick={() => setPrivate(priv)}
                className={`t-fast flex items-start gap-2 rounded-md border px-2.5 py-2 text-left ${
                  isPrivate === priv ? "border-accent bg-accent-soft" : "border-line hover:bg-hover"
                }`}
              >
                {priv ? <LockIcon size={13} className="mt-0.5 text-muted" /> : <RepoIcon size={13} className="mt-0.5 text-muted" />}
                <span>
                  <span className="block text-[12.5px] text-fg">{priv ? "Private" : "Public"}</span>
                  <span className="block text-[11px] text-subtle">{priv ? "Only you and people you invite" : "Anyone on the internet can see it"}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12.5px] text-fg">
          <input type="checkbox" checked={addReadme} onChange={(e) => setAddReadme(e.target.checked)} className="accent-[var(--accent)]" />
          Add a README
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Field label=".gitignore">
            <select value={gitignore} onChange={(e) => setGitignore(e.target.value)} disabled={!templates} className={field}>
              <option value="">{templates ? "None" : loadingText}</option>
              {templates?.gitignore.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="License">
            <select value={license} onChange={(e) => setLicense(e.target.value)} disabled={!templates} className={field}>
              <option value="">{templates ? "None" : loadingText}</option>
              {templates?.licenses.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {!addReadme && (gitignore || license) && (
          <span className="-mt-2 text-[11px] text-subtle">GitHub adds an initial commit to apply the template.</span>
        )}

        {error && <div className="selectable rounded-md border border-danger/40 px-2.5 py-2 text-[12px] text-danger">{error}</div>}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <span className="text-[11px] text-subtle">Creates the repository on GitHub.</span>
        <button type="button" onClick={close} className="t-fast ml-auto h-7 rounded-md px-3 text-[12px] text-muted hover:bg-hover hover:text-fg">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="t-fast flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-medium text-white disabled:opacity-40"
        >
          <PlusIcon size={11} />
          {busy ? "Creating…" : "Create repository"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1.5 text-[12px] text-muted">
        {label}
        {required && <span className="text-danger">*</span>}
      </span>
      {children}
    </label>
  );
}
