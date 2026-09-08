import type { RepoData, RefInfo, GNode, Placed } from "./models";

export const WIP_ID = "__WIP__";
export const STASH_COLOR = "#e3b341";
export const WIP_COLOR = "#ff9d5c";
// per-branch-line colors. Deliberately DESATURATED: hue alone separates the
// branches, while the muted tone keeps the graph from shouting over the
// commit messages (bright saturated lanes make everything feel equally loud).
export const COLORS = [
  "#4aa3ff", "#3fd07a", "#ffc247", "#c77dff",
  "#ff7eb6", "#2fd4d4", "#a8e337", "#ff9d4d",
  "#6f8cff", "#26d9a3", "#ffd23f", "#b96bff",
  "#ff6b8a", "#38bdf8", "#84e04a", "#ffab52",
];

export const refKey = (r: { kind: string; name: string }) => `${r.kind}:${r.name}`;

export function buildNodes(repo: RepoData, hidden?: Set<string>): GNode[] {
  // when branches are hidden, keep only commits still reachable from a visible
  // ref / HEAD / stash base / WIP parent
  let commits = repo.commits;
  if (hidden && hidden.size) {
    // hiding a branch also hides its local/remote twin (same short name),
    // otherwise the twin keeps the commits visible.
    const remoteShort = (name: string) => name.split("/").slice(1).join("/");
    const hiddenLocal = new Set(
      [...hidden].filter((k) => k.startsWith("local:")).map((k) => k.slice(6))
    );
    const hiddenRemote = new Set(
      [...hidden].filter((k) => k.startsWith("remote:")).map((k) => remoteShort(k.slice(7)))
    );
    const isHidden = (r: RefInfo) => {
      if (hidden.has(refKey(r))) return true;
      if (r.kind === "local" && hiddenRemote.has(r.name)) return true;
      if (r.kind === "remote" && hiddenLocal.has(remoteShort(r.name))) return true;
      return false;
    };

    const map = new Map(repo.commits.map((c) => [c.hash, c]));
    const tips: string[] = [];
    for (const r of repo.refs) if (!isHidden(r)) tips.push(r.target);
    // keep HEAD only if its branch isn't the one being hidden
    const headHidden =
      !!repo.head_branch && hiddenLocal.has(repo.head_branch);
    if (repo.head && !headHidden) tips.push(repo.head);
    for (const s of repo.stashes) if (s.parents[0]) tips.push(s.parents[0]);
    if (repo.wip?.parent && !headHidden) tips.push(repo.wip.parent);
    const seen = new Set<string>();
    const stack = [...tips];
    while (stack.length) {
      const h = stack.pop()!;
      if (seen.has(h)) continue;
      seen.add(h);
      const c = map.get(h);
      if (c) for (const p of c.parents) stack.push(p);
    }
    commits = repo.commits.filter((c) => seen.has(c.hash));
  }

  const nodes: GNode[] = [];
  if (repo.wip) {
    nodes.push({
      id: WIP_ID,
      kind: "wip",
      parents: repo.wip.parent ? [repo.wip.parent] : [],
      time: Number.MAX_SAFE_INTEGER,
      wip: repo.wip,
    });
  }
  for (const s of repo.stashes) {
    nodes.push({
      id: s.hash,
      kind: "stash",
      parents: s.parents.slice(0, 1), // connect to base commit only
      time: s.time,
      stash: s,
    });
  }
  for (const c of commits) {
    nodes.push({
      id: c.hash,
      kind: "commit",
      parents: c.parents,
      time: c.time,
      commit: c,
    });
  }
  // newest first; WIP pinned on top via MAX time. Stable for equal times.
  nodes.sort((a, b) => b.time - a.time);
  return nodes;
}

// ---- lane assignment (generic over node id / parents) ----
export function layout(nodes: GNode[]): { placed: Placed[]; maxLane: number } {
  const lanes: (string | null)[] = [];
  const placed: Placed[] = [];
  let maxLane = 0;

  const freeSlot = (): number => {
    const i = lanes.indexOf(null);
    if (i !== -1) return i;
    lanes.push(null);
    return lanes.length - 1;
  };

  // Color per BRANCH LINE, not per lane: a chain of first-parent links keeps
  // ONE color from its tip down — so it's obvious where a branch starts, ends
  // or gets merged, even when lanes are reused or the chain shifts lanes.
  const chainOf = new Map<string, number>();
  let nextChain = 0;

  nodes.forEach((n, row) => {
    let lane = lanes.indexOf(n.id);
    if (lane === -1) lane = freeSlot();

    for (let l = 0; l < lanes.length; l++) {
      if (l !== lane && lanes[l] === n.id) lanes[l] = null;
    }

    if (n.parents.length === 0) {
      lanes[lane] = null;
    } else {
      lanes[lane] = n.parents[0];
      for (let p = 1; p < n.parents.length; p++) {
        const ph = n.parents[p];
        if (lanes.indexOf(ph) === -1) lanes[freeSlot()] = ph;
      }
    }

    maxLane = Math.max(maxLane, lane, lanes.length - 1);
    // Only COMMITS take a chain slot. Stash/WIP have their own fixed colours,
    // and letting them consume a slot shifted every branch one step along the
    // palette whenever the WIP node appeared or disappeared — so committing
    // recoloured the whole graph.
    let color: string;
    if (n.kind === "stash") {
      color = STASH_COLOR;
    } else if (n.kind === "wip") {
      color = WIP_COLOR;
    } else {
      let chain = chainOf.get(n.id);
      if (chain === undefined) chain = nextChain++; // a new branch tip starts here
      // the first (topmost) child carries the chain on through its first parent
      if (n.parents.length && !chainOf.has(n.parents[0])) {
        chainOf.set(n.parents[0], chain);
      }
      color = COLORS[chain % COLORS.length];
    }
    placed.push({ node: n, row, lane, color });
  });

  return { placed, maxLane };
}

