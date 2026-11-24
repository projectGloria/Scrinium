// Small pieces shared by the issue/PR list and detail views.
import type { IssueSummary, Label } from "../../ipc/types";
import { CheckIcon, IssueIcon, PrIcon, XIcon } from "../../shared/ui/Icons";

/** Text color class and label for an item's state. */
export function stateInfo(it: Pick<IssueSummary, "isPr" | "state" | "stateReason" | "isDraft">): [string, string] {
  if (it.state === "OPEN") return it.isPr && it.isDraft ? ["text-subtle", "Draft"] : ["text-success", "Open"];
  if (it.state === "MERGED") return ["text-accent", "Merged"];
  if (it.isPr) return ["text-danger", "Closed"];
  return it.stateReason === "NOT_PLANNED" ? ["text-subtle", "Closed as not planned"] : ["text-accent", "Closed"];
}

export function StateIcon({ item, size = 14 }: { item: IssueSummary; size?: number }) {
  const [cls, label] = stateInfo(item);
  const Icon = item.isPr ? PrIcon : IssueIcon;
  return <Icon size={size} className={`shrink-0 ${cls}`} aria-label={label} />;
}

export function StateBadge({ item }: { item: IssueSummary }) {
  const [cls, label] = stateInfo(item);
  const Icon = item.isPr ? PrIcon : IssueIcon;
  return (
    <span className={`flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-current/40 px-2.5 text-[11.5px] ${cls}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

/** Check (run or status) state -> a small mark. */
export function CheckMark({ state, size = 13 }: { state: string; size?: number }) {
  switch (state) {
    case "SUCCESS":
      return <CheckIcon size={size} className="shrink-0 text-success" aria-label="passing" />;
    case "FAILURE":
    case "ERROR":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
    case "ACTION_REQUIRED":
      return <XIcon size={size} className="shrink-0 text-danger" aria-label="failing" />;
    case "PENDING":
    case "EXPECTED":
    case "IN_PROGRESS":
    case "QUEUED":
      return (
        <span title="pending" className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
          <span className="h-2 w-2 rounded-full bg-warn" />
        </span>
      );
    default:
      return (
        <span title={state.toLowerCase()} className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
          <span className="h-2 w-2 rounded-full border border-subtle" />
        </span>
      );
  }
}

export function LabelChip({ label }: { label: Label }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full border border-line px-1.5 text-[10.5px] text-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: label.color ? `#${label.color}` : "var(--fg-subtle)" }} />
      {label.name}
    </span>
  );
}
