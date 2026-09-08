// ---- types mirrored from the Rust backend ----
export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  summary: string;
}
export interface RefInfo {
  name: string;
  full: string;
  target: string;
  kind: "local" | "remote" | "tag" | "other";
  is_head: boolean;
  time: number;
}
export interface FileChange {
  status: string;
  path: string;
}
export interface StashEntry {
  selector: string;
  hash: string;
  parents: string[];
  time: number;
  message: string;
}
export interface WipStatus {
  parent: string;
  staged: number;
  unstaged: number;
  untracked: number;
}
export interface ConflictState {
  active: boolean;
  kind: string; // merge | rebase | cherry-pick | revert | ""
  files: string[];
}
export interface RepoData {
  path: string;
  head: string;
  head_branch: string;
  refs: RefInfo[];
  commits: Commit[];
  stashes: StashEntry[];
  wip: WipStatus | null;
  conflict: ConflictState;
  describe: string;
  submodules: { name: string; path: string; abs: string }[];
  fingerprint: string;
}

// ---- unified graph node ----
export type NodeKind = "commit" | "stash" | "wip";
export interface GNode {
  id: string; // commit/stash hash, or "__WIP__"
  kind: NodeKind;
  parents: string[];
  time: number;
  commit?: Commit;
  stash?: StashEntry;
  wip?: WipStatus;
}

export interface Placed {
  node: GNode;
  row: number;
  lane: number;
  color: string;
}

export interface Tab {
  repo: RepoData;
  selected: string | null; // node id
  nodes: GNode[];
  placed: Placed[];
  fingerprint?: string; // cheap repo-state signature for auto-refresh
  remoteTags?: Set<string>; // tag names confirmed on the configured remote
  hint?: { hash: string; branch: string }; // "which branch" ghost for selected commit
  hidden?: Set<string>; // ref keys hidden from the graph
  stale?: boolean; // loaded from cache, needs a background refresh
  parentPath?: string; // set when this tab is a submodule of another repo
  hlOff?: boolean; // lineage highlight cleared (click outside the graph)
}

