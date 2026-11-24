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

export const FileIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 1.75h5.25L12.5 5v9.25H4z" />
    <path d="M9 1.75V5.25h3.5" />
  </svg>
);
export const FolderIcon = ({ size, open, ...p }: P & { open?: boolean }) => (
  <svg {...base(size)} {...p}>
    {open ? (
      <path d="M1.75 4V3.25h4l1.5 1.5h6v2M1.75 4v8.75h10.5l2-6h-10.5l-2 6" />
    ) : (
      <path d="M1.75 3.25h4l1.5 1.5h7v8h-12.5z" />
    )}
  </svg>
);
export const ChevronIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m6 4 4 4-4 4" />
  </svg>
);
export const TagIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M2 2.5v4.25l7 7 4.5-4.5-7-7H2z" />
    <circle cx="5" cy="5.25" r="0.9" />
  </svg>
);
export const SubmoduleIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M1.75 3.25h4l1.5 1.5h7v8h-12.5z" />
    <path d="M6 9h4M8.5 7.5 10 9l-1.5 1.5" />
  </svg>
);
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
export const PlayIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 3.5v9l7-4.5z" />
  </svg>
);
export const BookIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M2 3h4a2 2 0 0 1 2 2v8.5a1.5 1.5 0 0 0-1.5-1.5H2zM14 3h-4a2 2 0 0 0-2 2v8.5a1.5 1.5 0 0 1 1.5-1.5H14z" />
  </svg>
);
export const ExternalIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
  </svg>
);
export const CheckIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);
export const XIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </svg>
);
export const CommandIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m4 5 3 3-3 3M8.5 11.5H12" />
  </svg>
);
export const WorkflowIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="2" y="2" width="4.5" height="4.5" rx="1" />
    <rect x="9.5" y="9.5" width="4.5" height="4.5" rx="1" />
    <path d="M4.25 6.5v3.25a2 2 0 0 0 2 2H9.5" />
  </svg>
);
export const CopyIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5" />
    <path d="M10.75 5.25V3.75a1.5 1.5 0 0 0-1.5-1.5h-5.5a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5h1.5" />
  </svg>
);
export const CodeIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5.5 4.25 1.75 8l3.75 3.75M10.5 4.25 14.25 8l-3.75 3.75" />
  </svg>
);
export const PlusIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M8 2.75v10.5M2.75 8h10.5" />
  </svg>
);
export const DownloadIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M8 2v8M4.75 7 8 10.25 11.25 7M2.75 13.25h10.5" />
  </svg>
);
