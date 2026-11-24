import { useEffect, useState, type ReactNode } from "react";

/** Shows its children only if still mounted after `ms`: cached data never flashes a loading note. */
export function Delayed({ children, ms = 250 }: { children: ReactNode; ms?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return show ? <>{children}</> : null;
}
