import { Kbd } from "../../shared/ui/Kbd";

export function Home() {
  const rows: [React.ReactNode, string][] = [
    [<><Kbd>Ctrl</Kbd><Kbd>K</Kbd></>, "Switch repository"],
    [<><Kbd>g</Kbd><Kbd>r</Kbd></>, "Switch repository"],
    [<><Kbd>j</Kbd><Kbd>k</Kbd></>, "Move in the sidebar"],
    [<Kbd>Enter</Kbd>, "Open"],
    [<Kbd>/</Kbd>, "Filter the sidebar"],
    [<Kbd>Esc</Kbd>, "Back"],
  ];
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-[300px] text-[12px]">
        {rows.map(([keys, label], i) => (
          <div key={i} className="flex h-8 items-center justify-between text-muted">
            <span>{label}</span>
            <span className="flex gap-1">{keys}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
