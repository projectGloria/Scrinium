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
