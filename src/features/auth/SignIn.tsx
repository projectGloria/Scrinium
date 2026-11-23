import { useRef, useState } from "react";
import * as ipc from "../../ipc/commands";
import type { Account, DeviceCode } from "../../ipc/types";
import { useSession } from "../../stores/session";
import { useRepos } from "../../stores/repos";

export function SignIn() {
  const deviceFlow = useSession((s) => s.deviceFlowAvailable);
  const signedIn = useSession((s) => s.signedIn);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  const finish = async (a: Account) => {
    signedIn(a);
    await useRepos.getState().load(); // empty at first; sync events fill it in
  };

  const startDevice = async () => {
    setError(null);
    setBusy(true);
    cancelled.current = false;
    try {
      const c = await ipc.authDeviceStart();
      setCode(c);
      await finish(await ipc.authDevicePoll(c));
    } catch (e) {
      if (!cancelled.current) setError(String(e));
      setCode(null);
    } finally {
      setBusy(false);
    }
  };

  const cancelDevice = () => {
    cancelled.current = true;
    void ipc.authDeviceCancel();
    setCode(null);
    setBusy(false);
  };

  const submitPat = async (token: string) => {
    setError(null);
    setBusy(true);
    try {
      await finish(await ipc.authWithPat(token));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-[380px]">
        <h1 className="text-[18px] font-semibold tracking-tight">Sign in to GitHub</h1>
        <p className="mt-1 text-muted">
          Scrinium only reads your repositories. Your token stays in the system credential store.
        </p>

        {deviceFlow && !code && (
          <button
            disabled={busy}
            onClick={startDevice}
            className="t-fast mt-5 h-8 w-full rounded-md bg-accent font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Sign in with GitHub
          </button>
        )}

        {code && (
          <div className="mt-5 rounded-lg border border-line bg-elev p-4">
            <div className="text-[12px] text-muted">
              Enter this code on the GitHub page that just opened:
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="selectable font-mono text-[22px] font-medium tracking-[0.15em]">
                {code.userCode}
              </span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(code.userCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
                className="t-fast ml-auto h-6 rounded-md border border-line px-2 text-[12px] text-muted hover:bg-hover hover:text-fg"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between text-[12px] text-subtle">
              <span className="selectable">{code.verificationUri}</span>
              <button onClick={cancelDevice} className="hover:text-fg">
                Cancel
              </button>
            </div>
          </div>
        )}

        {deviceFlow && (
          <div className="my-5 flex items-center gap-3 text-[11px] text-subtle">
            <div className="h-px flex-1 bg-line" /> or paste a token <div className="h-px flex-1 bg-line" />
          </div>
        )}

        <form
          className={deviceFlow ? "" : "mt-5"}
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("token") as HTMLInputElement;
            void submitPat(input.value);
          }}
        >
          <input
            name="token"
            type="password"
            autoFocus={!deviceFlow}
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_… or github_pat_…"
            className="t-fast h-8 w-full rounded-md border border-line bg-bg px-2.5 font-mono text-[12px] outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy}
            className="t-fast mt-2 h-8 w-full rounded-md border border-line-strong font-medium hover:bg-hover disabled:opacity-50"
          >
            Use token
          </button>
          <p className="mt-2 text-[11.5px] leading-relaxed text-subtle">
            Classic token: <span className="font-mono">repo</span> and{" "}
            <span className="font-mono">read:org</span> scopes. Fine-grained: read-only access to
            metadata, contents, issues and pull requests.
          </p>
        </form>

        {error && <p className="selectable mt-3 text-[12px] text-danger">{error}</p>}
      </div>
    </div>
  );
}
