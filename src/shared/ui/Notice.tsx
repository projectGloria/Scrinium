// The single bottom-of-window notice (copied, cloning…, errors). Click to dismiss.
import { useUi } from "../../stores/ui";

export function Notice() {
  const notice = useUi((s) => s.notice);
  if (!notice) return null;
  const tone = notice.tone === "error" ? "border-danger/40 text-danger" : notice.tone === "ok" ? "text-fg" : "text-muted";
  return (
    <div
      role="status"
      onClick={() => useUi.getState().dismissNotice(notice.id)}
      className={`fixed bottom-4 left-1/2 z-[60] max-w-[min(560px,90vw)] -translate-x-1/2 cursor-default select-text rounded-lg border border-line bg-elev px-3.5 py-2 text-[12.5px] ${tone}`}
      style={{ boxShadow: "var(--shadow)" }}
    >
      {notice.text}
    </div>
  );
}
