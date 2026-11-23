import { useState } from "react";
import type { RepoSummary } from "../../ipc/types";
import { blobUrl } from "../../shared/blobUrl";
import { ArchiveIcon, ForkIcon, LockIcon, RepoIcon } from "../../shared/ui/Icons";

/**
 * The repo's own icon when it has one (found by the background icon scan); otherwise one glyph
 * that says the most important thing about it: archived > fork > private > plain.
 */
export function RepoGlyph({ repo, size = 13 }: { repo: RepoSummary; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (repo.iconSha && broken !== repo.iconSha) {
    const px = size + 3;
    return (
      <img
        src={blobUrl(repo.iconSha)}
        alt=""
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setBroken(repo.iconSha)}
        className="shrink-0 rounded-[3px] object-contain"
        style={{ width: px, height: px }}
      />
    );
  }
  const cls = "shrink-0 text-subtle";
  if (repo.isArchived) return <ArchiveIcon size={size} className={cls} />;
  if (repo.isFork) return <ForkIcon size={size} className={cls} />;
  if (repo.isPrivate) return <LockIcon size={size} className={cls} />;
  return <RepoIcon size={size} className={cls} />;
}
