// DTOs mirroring the Rust structs (serde camelCase).

export interface Account {
  login: string;
  userId: number;
  avatarUrl: string | null;
  authKind: "device" | "pat";
  scopes: string | null;
}

export interface AuthStatus {
  account: Account | null;
  deviceFlowAvailable: boolean;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface RepoSummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  ownerIsOrg: boolean;
  description: string | null;
  homepage: string | null;
  topics: string[];
  primaryLanguage: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  defaultBranch: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  openPrs: number;
  /** Unix seconds */
  pushedAt: number | null;
  htmlUrl: string;
  pinned: boolean;
  /** Unix seconds */
  lastOpenedAt: number | null;
  /** SHA of the cached repo icon, served via the scrblob protocol. */
  iconSha: string | null;
  /** Root tree of the default branch (from the repo sync). */
  defaultTreeSha: string | null;
}

export interface Language {
  name: string;
  bytes: number;
  color: string | null;
}

export interface SyncStatus {
  running: boolean;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export interface Readme {
  path: string;
  sha: string;
  text: string;
  /** Unix seconds */
  checkedAt: number;
}

export interface DispatchInput {
  name: string;
  description: string | null;
  required: boolean;
  default: string | null;
  /** string / choice / boolean / number / environment */
  kind: string;
  options: string[];
}

export interface Workflow {
  id: number;
  name: string;
  path: string;
  state: string;
  dispatchable: boolean;
  inputs: DispatchInput[];
  htmlUrl: string;
}

export interface Run {
  id: number;
  workflowId: number;
  name: string | null;
  title: string | null;
  runNumber: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  headBranch: string | null;
  actor: string | null;
  htmlUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface Actions {
  workflows: Workflow[];
  runs: Run[];
  /** Null: never fetched for this repo. */
  checkedAt: number | null;
}

export interface GitRef {
  name: string;
  commitSha: string | null;
  treeSha: string | null;
  /** Unix seconds */
  committedAt: number | null;
}

export interface RefList {
  branches: GitRef[];
  tags: GitRef[];
  branchesTotal: number;
  tagsTotal: number;
  /** Null: never fetched for this repo. */
  checkedAt: number | null;
  defaultBranch: string | null;
  defaultTreeSha: string | null;
}

export interface TreeInfo {
  truncated: boolean;
  entries: number;
}

export interface FileEntry {
  name: string;
  path: string;
  /** blob / tree / commit (submodule) */
  kind: string;
  sha: string;
  size: number | null;
}

export interface FileContent {
  kind: "text" | "image" | "binary" | "large";
  text: string | null;
  mime: string;
  size: number;
}

export interface FileHit {
  repoId: number;
  path: string;
}

export interface IssueHit {
  repoId: number;
  number: number;
  isPr: boolean;
  title: string;
  state: IssueState;
}

export interface PaletteResults {
  repos: number[];
  files: FileHit[];
  issues: IssueHit[];
}

export type IssueState = "OPEN" | "CLOSED" | "MERGED";
/** For PRs, "closed" includes merged. */
export type StateFilter = "open" | "closed" | "all";

export interface Label {
  name: string;
  color: string | null;
}

/** An issue or a pull request (one list row). */
export interface IssueSummary {
  number: number;
  isPr: boolean;
  title: string;
  state: IssueState;
  /** Issues: COMPLETED / NOT_PLANNED / REOPENED. */
  stateReason: string | null;
  isDraft: boolean;
  author: string | null;
  commentsCount: number;
  labels: Label[];
  /** PRs: rollup of the head commit's checks (SUCCESS / FAILURE / ERROR / PENDING / EXPECTED). */
  checksState: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  mergedAt: number | null;
}

export interface IssueList {
  items: IssueSummary[];
  open: number;
  closed: number;
  syncedAt: number | null;
}

export interface Check {
  name: string;
  state: string;
  url: string | null;
}

export interface IssueComment {
  id: string;
  author: string | null;
  authorAvatar: string | null;
  body: string;
  createdAt: number;
}

export interface IssueDetail extends IssueSummary {
  body: string | null;
  authorAvatar: string | null;
  headRef: string | null;
  baseRef: string | null;
  htmlUrl: string;
  /** Null until comments/checks were fetched once. */
  detailAt: number | null;
  comments: IssueComment[];
  checks: Check[];
}
