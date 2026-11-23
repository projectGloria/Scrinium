// "Run workflow" form: branch plus the workflow_dispatch inputs declared in the workflow file.
// Submitting is one of the app's two GitHub writes (POST .../dispatches, in Rust's write.rs).
import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as ipc from "../../ipc/commands";
import type { DispatchInput, Workflow } from "../../ipc/types";
import { pollAfterDispatch, useActions } from "../../stores/actions";
import { useRepos } from "../../stores/repos";
import { useUi } from "../../stores/ui";
import { PlayIcon } from "../../shared/ui/Icons";

export function RunDialog() {
  const target = useUi((s) => s.runDialog);
  const setTarget = useUi((s) => s.setRunDialog);
  const workflow = useActions((s) =>
    target ? s.byRepo[target.repoId]?.workflows.find((w) => w.id === target.workflowId) : undefined,
  );
  const repo = useRepos((s) => (target ? s.byId.get(target.repoId) : undefined));
  const open = !!(target && workflow && repo);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => o || setTarget(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ background: "var(--overlay)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[14vh] z-50 flex max-h-[76vh] w-[min(460px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-elev"
          style={{ boxShadow: "var(--shadow)" }}
        >
          {open && (
            <RunForm
              key={`${target.repoId}:${workflow.id}`}
              repoId={target.repoId}
              repoName={repo.fullName}
              defaultBranch={repo.defaultBranch ?? "main"}
              workflow={workflow}
              close={() => setTarget(null)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Values = Record<string, string | boolean>;

function initial(inputs: DispatchInput[]): Values {
  const v: Values = {};
  for (const i of inputs) {
    if (i.kind === "boolean") v[i.name] = i.default === "true";
    else v[i.name] = i.default ?? (i.kind === "choice" ? (i.options[0] ?? "") : "");
  }
  return v;
}

function RunForm({
  repoId,
  repoName,
  defaultBranch,
  workflow,
  close,
}: {
  repoId: number;
  repoName: string;
  defaultBranch: string;
  workflow: Workflow;
  close: () => void;
}) {
  const [gitRef, setGitRef] = useState(defaultBranch);
  const [values, setValues] = useState<Values>(() => initial(workflow.inputs));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A stale error goes away as soon as the form is edited.
  useEffect(() => setError(null), [gitRef, values]);

  const missing = useMemo(
    () => workflow.inputs.filter((i) => i.required && i.kind !== "boolean" && !String(values[i.name] ?? "").trim()),
    [workflow.inputs, values],
  );
  const canSubmit = !busy && gitRef.trim() !== "" && missing.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Empty optional inputs are left out so the workflow's own defaults apply.
      const inputs: Values = {};
      for (const i of workflow.inputs) {
        const v = values[i.name];
        if (typeof v === "boolean" || v.trim() !== "") inputs[i.name] = typeof v === "boolean" ? v : v.trim();
      }
      await ipc.actionsDispatch(repoId, workflow.id, gitRef.trim(), inputs);
      pollAfterDispatch(repoId);
      close();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const field = "h-7 w-full rounded-md border border-line bg-bg px-2 text-[12.5px] outline-none focus:border-accent";

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <Dialog.Title className="text-[14px] font-semibold">Run workflow</Dialog.Title>
        <div className="mt-0.5 truncate text-[12px] text-muted">
          {workflow.name} <span className="text-subtle">· {repoName}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-4 py-4">
        <Field label="Branch or tag" required>
          <input
            autoFocus
            value={gitRef}
            onChange={(e) => setGitRef(e.target.value)}
            spellCheck={false}
            className={`${field} font-mono`}
          />
        </Field>

        {workflow.inputs.map((i) => (
          <Field key={i.name} label={i.description || i.name} hint={i.description ? i.name : undefined} required={i.required}>
            <InputControl input={i} value={values[i.name]} onChange={(v) => setValues((s) => ({ ...s, [i.name]: v }))} cls={field} />
          </Field>
        ))}

        {error && <div className="rounded-md border border-danger/40 px-2.5 py-2 text-[12px] text-danger">{error}</div>}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <span className="text-[11px] text-subtle">Starts a run on GitHub.</span>
        <button
          type="button"
          onClick={close}
          className="t-fast ml-auto h-7 rounded-md px-3 text-[12px] text-muted hover:bg-hover hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="t-fast flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-medium text-white disabled:opacity-40"
        >
          <PlayIcon size={11} />
          {busy ? "Starting…" : "Run workflow"}
        </button>
      </div>
    </form>
  );
}

function InputControl({
  input,
  value,
  onChange,
  cls,
}: {
  input: DispatchInput;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
  cls: string;
}) {
  if (input.kind === "boolean") {
    return (
      <label className="flex h-7 items-center gap-2 text-[12.5px] text-muted">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />
        {value ? "true" : "false"}
      </label>
    );
  }
  if (input.kind === "choice" && input.options.length > 0) {
    return (
      <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={cls}>
        {input.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={input.kind === "number" ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className={cls}
    />
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1.5 text-[12px] text-muted">
        {label}
        {required && <span className="text-danger">*</span>}
        {hint && <span className="ml-auto font-mono text-[10.5px] text-subtle">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
