import { useNav } from "../../stores/nav";
import { useRepos } from "../../stores/repos";

/** Opens a repo in the main pane and records the visit for "recent" ordering. */
export function openRepo(id: number) {
  useNav.getState().openRepo(id);
  useRepos.getState().touch(id);
}
