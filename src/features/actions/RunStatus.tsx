import type { Run } from "../../ipc/types";
import { CheckIcon, XIcon } from "../../shared/ui/Icons";

/** Small status mark for a workflow run. */
export function RunStatus({ run }: { run: Run }) {
  if (run.status !== "completed") {
    return (
      <span title={run.status ?? "pending"} className="flex h-[14px] w-[14px] shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-warn" />
      </span>
    );
  }
  switch (run.conclusion) {
    case "success":
      return <CheckIcon size={14} className="shrink-0 text-success" aria-label="success" />;
    case "failure":
    case "timed_out":
    case "startup_failure":
      return <XIcon size={14} className="shrink-0 text-danger" aria-label={run.conclusion} />;
    default:
      return (
        <span title={run.conclusion ?? "completed"} className="flex h-[14px] w-[14px] shrink-0 items-center justify-center">
          <span className="h-2 w-2 rounded-full border border-subtle" />
        </span>
      );
  }
}
