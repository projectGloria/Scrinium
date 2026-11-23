// Minimal inline icons (16px grid, stroke-based) so we don't pull in an icon library.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 14): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const RepoIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3.5 2.5h8.5v9H4.75a1.25 1.25 0 0 0 0 2.5H12" />
    <path d="M3.5 2.5v10.25" />
  </svg>
);
export const LockIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);
export const ForkIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="11.5" cy="3.5" r="1.5" />
    <circle cx="8" cy="12.5" r="1.5" />
    <path d="M4.5 5v1a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V5M8 8v3" />
  </svg>
);
export const ArchiveIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="2.5" y="3" width="11" height="3" rx="0.8" />
    <path d="M3.5 6v6.5h9V6M6.5 8.5h3" />
  </svg>
);
export const PinIcon = ({ size, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(size)} {...p}>
    <path
      d="M6 2.5h4l-.5 4 2 2v1h-7v-1l2-2z"
      fill={filled ? "currentColor" : "none"}
    />
    <path d="M8 9.5v4" />
  </svg>
);
export const StarIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m8 2.2 1.75 3.6 3.95.55-2.87 2.77.7 3.93L8 11.2l-3.53 1.85.7-3.93L2.3 6.35l3.95-.55z" />
  </svg>
);
export const IssueIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="0.8" fill="currentColor" />
  </svg>
);
export const PrIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="12.5" r="1.5" />
    <path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
  </svg>
);
export const BranchIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5" r="1.5" />
    <path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5" />
  </svg>
);
export const ClockIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </svg>
);
export const SearchIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="7" cy="7" r="4" />
    <path d="m10 10 3.5 3.5" />
  </svg>
);
export const RefreshIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v2.5h-2.5" />
  </svg>
);
export const SunIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </svg>
);
export const MoonIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" />
  </svg>
);
export const MonitorIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="2" y="3" width="12" height="8" rx="1" />
    <path d="M6 13.5h4M8 11v2.5" />
  </svg>
);
export const MinimizeIcon = (p: P) => (
  <svg {...base(12)} {...p}>
    <path d="M3 8h10" />
  </svg>
);
export const MaximizeIcon = (p: P) => (
  <svg {...base(12)} {...p}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="0.5" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg {...base(12)} {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);
