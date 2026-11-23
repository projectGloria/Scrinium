import { useEffect } from "react";
import { onReposChanged, onSyncStatus } from "./ipc/events";
import { syncStatus } from "./ipc/commands";
import { useSession } from "./stores/session";
import { useRepos } from "./stores/repos";
import { useUi } from "./stores/ui";
import { useNav } from "./stores/nav";
import { useGlobalKeys } from "./shared/keys/useGlobalKeys";
import { Titlebar } from "./shared/ui/Titlebar";
import { SignIn } from "./features/auth/SignIn";
import { Sidebar } from "./features/repos/Sidebar";
import { RepoSwitcher } from "./features/repos/RepoSwitcher";
import { RepoView } from "./features/repos/RepoView";
import { Home } from "./features/repos/Home";
import { Palette } from "./features/palette/Palette";
import { RunDialog } from "./features/actions/RunDialog";

export function App() {
  const status = useSession((s) => s.status);
  useGlobalKeys();
  useBackendEvents();

  return (
    <div className="flex h-full flex-col">
      <Titlebar />
      {status === "signedIn" && <Workspace />}
      {status === "signedOut" && <SignIn />}
    </div>
  );
}

function Workspace() {
  const route = useNav((s) => s.stack[s.stack.length - 1]);
  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {route.kind === "repo" ? <RepoView repoId={route.repoId} /> : <Home />}
      </main>
      <RepoSwitcher />
      <Palette />
      <RunDialog />
    </div>
  );
}

/** Sync runs in Rust; we only listen. Bursts of change events are coalesced into one reload. */
function useBackendEvents() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (useSession.getState().status === "signedIn") void useRepos.getState().load();
      }, 120);
    };
    const subs = [
      onReposChanged(reload),
      onSyncStatus((s) => {
        useUi.getState().setSync(s);
        // A rejected token means the session is over; show the sign-in screen.
        if (s.lastError?.includes("rejected the token")) void useSession.getState().init();
      }),
    ];
    void syncStatus().then(useUi.getState().setSync);
    return () => {
      clearTimeout(timer);
      subs.forEach((p) => void p.then((un) => un()));
    };
  }, []);
}
