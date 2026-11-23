import { create } from "zustand";
import * as ipc from "../ipc/commands";
import type { Account } from "../ipc/types";

interface SessionState {
  status: "loading" | "signedOut" | "signedIn";
  account: Account | null;
  deviceFlowAvailable: boolean;
  init: () => Promise<void>;
  signedIn: (a: Account) => void;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: "loading",
  account: null,
  deviceFlowAvailable: false,
  init: async () => {
    try {
      const s = await ipc.authStatus();
      set({
        status: s.account ? "signedIn" : "signedOut",
        account: s.account,
        deviceFlowAvailable: s.deviceFlowAvailable,
      });
    } catch {
      set({ status: "signedOut", account: null });
    }
  },
  signedIn: (account) => set({ status: "signedIn", account }),
  signOut: async () => {
    await ipc.authSignOut();
    set({ status: "signedOut", account: null });
  },
}));
