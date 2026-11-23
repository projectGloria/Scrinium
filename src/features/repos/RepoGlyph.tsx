import type { RepoSummary } from "../../ipc/types";
import { ArchiveIcon, ForkIcon, LockIcon, RepoIcon } from "../../shared/ui/Icons";

/** One icon that says the most important thing about a repo: archived > fork > private > plain. */
export function RepoGlyph({ repo, size = 13 }: { repo: RepoSummary; size?: number }) {
  const cls = "shrink-0 text-subtle";
  if (repo.isArchived) return <ArchiveIcon size={size} className={cls} />;
  if (repo.isFork) return <ForkIcon size={size} className={cls} />;
  if (repo.isPrivate) return <LockIcon size={size} className={cls} />;
  return <RepoIcon size={size} className={cls} />;
}
