import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "./index.css";

import { createRoot } from "react-dom/client";
import { App } from "./App";
import { appReady } from "./ipc/commands";
import { initTheme } from "./shared/theme";
import { useSession } from "./stores/session";
import { useRepos } from "./stores/repos";

// The window stays hidden until the first frame is painted with cached data,
// so the user never sees an empty shell or a spinner.
initTheme();
await useSession.getState().init();
if (useSession.getState().status === "signedIn") await useRepos.getState().load();

createRoot(document.getElementById("root")!).render(<App />);

requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    void appReady().then((ms) => console.info(`[startup] first paint ${ms} ms after process start`));
  }),
);
