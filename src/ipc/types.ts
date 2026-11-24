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

export interface PaletteResults {
  repos: number[];
  files: FileHit[];
}
