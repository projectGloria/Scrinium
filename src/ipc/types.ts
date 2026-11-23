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
