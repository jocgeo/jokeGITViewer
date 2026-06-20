import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// ---- types mirrored from the Rust backend ----
interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  summary: string;
}
interface RefInfo {
  name: string;
  full: string;
  target: string;
  kind: "local" | "remote" | "tag" | "other";
  is_head: boolean;
  time: number;
}
interface FileChange {
  status: string;
  path: string;
}
interface StashEntry {
  selector: string;
  hash: string;
  parents: string[];
  time: number;
  message: string;
}
interface WipStatus {
  parent: string;
  staged: number;
  unstaged: number;
  untracked: number;
}
interface ConflictState {
  active: boolean;
  kind: string; // merge | rebase | cherry-pick | revert | ""
  files: string[];
}
interface RepoData {
  path: string;
  head: string;
  head_branch: string;
  refs: RefInfo[];
  commits: Commit[];
  stashes: StashEntry[];
  wip: WipStatus | null;
  conflict: ConflictState;
}

// ---- unified graph node ----
type NodeKind = "commit" | "stash" | "wip";
interface GNode {
  id: string; // commit/stash hash, or "__WIP__"
  kind: NodeKind;
  parents: string[];
  time: number;
  commit?: Commit;
  stash?: StashEntry;
  wip?: WipStatus;
}

interface Placed {
  node: GNode;
  row: number;
  lane: number;
  color: string;
}

interface Tab {
  repo: RepoData;
  selected: string | null; // node id
  nodes: GNode[];
  placed: Placed[];
  fingerprint?: string; // cheap repo-state signature for auto-refresh
}

// ---- layout constants ----
const ROW_H = 30;
const LANE_W = 22;
const PAD = 16;
const NODE_R = 5;
const AVATAR = 18; // author avatar size drawn on commit nodes
const REF_W = 280; // width of the left "Branch / Tag" column
const WIP_ID = "__WIP__";
const STASH_COLOR = "#e3b341";
const WIP_COLOR = "#ff9d5c";
const COLORS = [
  "#6db3ff", "#7ee787", "#ffcf8f", "#d6a8ff",
  "#f4a3c0", "#5ed3d3", "#b8e060", "#ff9d5c",
];

// ---- app state ----
const tabs: Tab[] = [];
let active = -1;

const cur = (): Tab | null => (active >= 0 ? tabs[active] : null);

// ---- DOM helpers ----
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const svgEl = (name: string) =>
  document.createElementNS("http://www.w3.org/2000/svg", name);

// ---- build unified node list (commits + stashes + WIP) ----
function buildNodes(repo: RepoData): GNode[] {
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
  for (const c of repo.commits) {
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
function layout(nodes: GNode[]): { placed: Placed[]; maxLane: number } {
  const lanes: (string | null)[] = [];
  const placed: Placed[] = [];
  let maxLane = 0;

  const freeSlot = (): number => {
    const i = lanes.indexOf(null);
    if (i !== -1) return i;
    lanes.push(null);
    return lanes.length - 1;
  };

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
    let color = COLORS[lane % COLORS.length];
    if (n.kind === "stash") color = STASH_COLOR;
    if (n.kind === "wip") color = WIP_COLOR;
    placed.push({ node: n, row, lane, color });
  });

  return { placed, maxLane };
}

const laneX = (lane: number) => PAD + lane * LANE_W;
const rowY = (row: number) => row * ROW_H + ROW_H / 2;

// ---- tab strip ----
function renderTabs() {
  const strip = $("tabstrip");
  strip.innerHTML = "";
  if (!tabs.length) {
    strip.classList.add("hidden");
    return;
  }
  strip.classList.remove("hidden");
  tabs.forEach((t, i) => {
    const chip = document.createElement("div");
    chip.className = "tab" + (i === active ? " active" : "");
    chip.title = t.repo.path;
    const name = document.createElement("span");
    name.textContent = basename(t.repo.path);
    name.addEventListener("click", () => switchTab(i));
    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(i);
    });
    chip.appendChild(name);
    chip.appendChild(close);
    strip.appendChild(chip);
  });
}

function switchTab(i: number) {
  active = i;
  renderTabs();
  renderActive();
  saveSession();
}

function closeTab(i: number) {
  tabs.splice(i, 1);
  if (tabs.length === 0) {
    active = -1;
  } else if (active >= tabs.length) {
    active = tabs.length - 1;
  } else if (i < active) {
    active -= 1;
  }
  renderTabs();
  renderActive();
  saveSession();
}

// ---- render everything for the active tab ----
function renderActive() {
  showDiffView(false);
  const t = cur();
  if (!t) {
    $("repo-path").textContent = "No repo open";
    setStatus("");
    $("locals").innerHTML = "";
    $("remotes").innerHTML = "";
    $("tags").innerHTML = "";
    ($("graph-svg") as unknown as SVGSVGElement).innerHTML = "";
    $("rows").innerHTML = "";
    $("empty").classList.remove("hidden");
    setToolbar(null);
    clearDetail();
    return;
  }
  const repo = t.repo;
  setToolbar(repo);
  $("repo-path").textContent = repo.path;
  setStatus(
    `${repo.commits.length} commits · ${repo.refs.length} refs` +
      (repo.stashes.length ? ` · ${repo.stashes.length} stash` : "") +
      (repo.head_branch ? ` · on ${repo.head_branch}` : " · ⚠ DETACHED HEAD")
  );
  renderSidebar(t);
  renderGraph(t);

  // in a conflicted state -> show the conflict panel, not the usual detail
  if (repo.conflict.active) {
    $("detail-empty").classList.add("hidden");
    $("detail-body").classList.add("hidden");
    $("commit-panel").classList.add("hidden");
    $("conflict-panel").classList.remove("hidden");
    renderConflictPanel(t);
    setStatus(`⚠ ${repo.conflict.kind} in progress — ${repo.conflict.files.length} conflict(s)`);
    return;
  }
  $("conflict-panel").classList.add("hidden");

  if (t.selected) {
    const n = t.nodes.find((x) => x.id === t.selected);
    if (n) selectNode(n, true);
    else clearDetail();
  } else {
    clearDetail();
  }
}

function renderSidebar(t: Tab) {
  const repo = t.repo;
  const localNames = new Set(
    repo.refs.filter((r) => r.kind === "local").map((r) => r.name)
  );

  const fill = (id: string, countId: string, kind: string) => {
    const ul = $(id);
    ul.innerHTML = "";
    const list = repo.refs
      .filter((r) => r.kind === kind)
      // most recently committed first; tie-break by name
      .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name));
    $(countId).textContent = String(list.length);
    list.forEach((r) => {
        const li = document.createElement("li");
        if (r.is_head) li.classList.add("head");

        // remote branch with no local counterpart → "remote only"
        let remoteOnly = false;
        if (kind === "remote") {
          const short = r.name.split("/").slice(1).join("/");
          remoteOnly = !localNames.has(short);
        }
        if (remoteOnly) li.classList.add("remoteonly");

        const color = COLORS[Math.abs(hashStr(r.target)) % COLORS.length];
        li.innerHTML =
          `<span class="ricon">${icon(kind)}</span>` +
          `<span class="dot" style="background:${color}"></span>` +
          `<span class="rname">${escapeHtml(r.name)}</span>` +
          (r.is_head ? `<span class="here">HEAD</span>` : "") +
          (remoteOnly ? `<span class="dl" title="not checked out locally">⬇</span>` : "");
        li.title = r.full + (remoteOnly ? "  (not checked out locally)" : "");
        li.addEventListener("click", () => {
          if (r.target) selectNode(findById(t, r.target) ?? null, true);
        });
        li.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showMenu(e.clientX, e.clientY, branchMenu(r, repo));
        });
        ul.appendChild(li);
      });
    if (!ul.children.length) {
      ul.innerHTML = `<li class="muted empty-mini">none</li>`;
    }
  };
  fill("locals", "count-local", "local");
  fill("remotes", "count-remote", "remote");
  fill("tags", "count-tag", "tag");

  // stashes list
  const sul = $("stashes");
  sul.innerHTML = "";
  $("count-stash").textContent = String(repo.stashes.length);
  repo.stashes.forEach((s) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="ricon">${icon("stash")}</span>` +
      `<span class="rname">${escapeHtml(s.message)}</span>`;
    li.title = `${s.selector} — ${s.hash.slice(0, 8)}`;
    li.addEventListener("click", () => selectNode(findById(t, s.hash) ?? null, true));
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, stashMenu(s, repo));
    });
    sul.appendChild(li);
  });
  if (!sul.children.length) {
    sul.innerHTML = `<li class="muted empty-mini">none</li>`;
  }
}

// A display unit groups refs at a commit: a local branch is merged with its
// matching remote (same name -> one badge with both icons).
interface RefUnit {
  name: string;
  local: boolean;
  remote: boolean;
  tag: boolean;
  isHead: boolean;
  ref: RefInfo; // the ref to act on (local preferred)
}
function refUnits(refsHere: RefInfo[]): RefUnit[] {
  const locals = refsHere.filter((r) => r.kind === "local");
  const remotes = refsHere.filter((r) => r.kind === "remote");
  const tags = refsHere.filter((r) => r.kind === "tag");
  const usedRemote = new Set<string>();
  const units: RefUnit[] = [];
  for (const l of locals) {
    const rem = remotes.find(
      (r) => r.name.split("/").slice(1).join("/") === l.name
    );
    if (rem) usedRemote.add(rem.full);
    units.push({ name: l.name, local: true, remote: !!rem, tag: false, isHead: l.is_head, ref: l });
  }
  for (const r of remotes) {
    if (usedRemote.has(r.full)) continue;
    units.push({ name: r.name, local: false, remote: true, tag: false, isHead: false, ref: r });
  }
  for (const tg of tags) {
    units.push({ name: tg.name, local: false, remote: false, tag: true, isHead: false, ref: tg });
  }
  return units;
}

function unitBadge(u: RefUnit): string {
  const icons =
    (u.local ? icon("local") : "") +
    (u.remote ? icon("remote") : "") +
    (u.tag ? icon("tag") : "");
  const cls = u.tag ? "tag" : u.remote && !u.local ? "remote" : "local";
  const check = u.isHead ? `<span class="bcheck">✓</span>` : "";
  return (
    `<span class="badge ${cls}${u.isHead ? " current" : ""}" ` +
    `data-refname="${escapeHtml(u.ref.name)}" data-refkind="${u.ref.kind}">` +
    `${check}${icons}${escapeHtml(u.name)}</span>`
  );
}

// primary badge (current branch if present, else first) + "+N" pill
function buildRefColumn(refsHere: RefInfo[]): string {
  const units = refUnits(refsHere);
  if (!units.length) return "";
  let pi = units.findIndex((u) => u.isHead);
  if (pi < 0) pi = 0;
  let html = unitBadge(units[pi]);
  const others = units.filter((_, i) => i !== pi);
  if (others.length) {
    const title = others.map((u) => u.name).join("\n");
    html += `<span class="refplus" title="${escapeHtml(title)}">+${others.length}</span>`;
  }
  return html;
}

function renderGraph(t: Tab) {
  const repo = t.repo;
  const built = layout(t.nodes);
  t.placed = built.placed;
  const { placed, maxLane } = built;

  const byId = new Map<string, Placed>();
  placed.forEach((p) => byId.set(p.node.id, p));

  const graphW = laneX(maxLane) + PAD;
  const totalH = placed.length * ROW_H;

  const refsByHash = new Map<string, RefInfo[]>();
  for (const r of repo.refs) {
    const arr = refsByHash.get(r.target) ?? [];
    arr.push(r);
    refsByHash.set(r.target, arr);
  }

  // size/place the graph column + headers
  const svg = $("graph-svg") as unknown as SVGSVGElement;
  svg.setAttribute("width", String(graphW));
  svg.setAttribute("height", String(totalH));
  svg.style.left = `${REF_W}px`;
  svg.innerHTML = "";
  (document.querySelector(".ch-graph") as HTMLElement).style.width = `${graphW}px`;

  // edges
  for (const p of placed) {
    const cx = laneX(p.lane);
    const cy = rowY(p.row);
    for (const ph of p.node.parents) {
      const pp = byId.get(ph);
      if (!pp) continue;
      const px = laneX(pp.lane);
      const py = rowY(pp.row);
      const path = svgEl("path");
      const midY = (cy + py) / 2;
      const d =
        px === cx
          ? `M ${cx} ${cy} L ${px} ${py}`
          : `M ${cx} ${cy} C ${cx} ${midY}, ${px} ${midY}, ${px} ${py}`;
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", pp.color);
      path.setAttribute("stroke-width", "2");
      if (p.node.kind !== "commit") path.setAttribute("stroke-dasharray", "3 3");
      svg.appendChild(path);
    }
  }

  // nodes
  for (const p of placed) {
    const x = laneX(p.lane);
    const y = rowY(p.row);

    if (p.node.kind === "stash") {
      const sz = 11;
      const rect = svgEl("rect");
      rect.setAttribute("x", String(x - sz / 2));
      rect.setAttribute("y", String(y - sz / 2));
      rect.setAttribute("width", String(sz));
      rect.setAttribute("height", String(sz));
      rect.setAttribute("rx", "2");
      rect.setAttribute("fill", "#1e1e2a"); // hollow, not solid like a commit
      rect.setAttribute("stroke", STASH_COLOR);
      rect.setAttribute("stroke-width", "1.5");
      rect.setAttribute("stroke-dasharray", "2 2");
      svg.appendChild(rect);
    } else if (p.node.kind === "wip") {
      const c = svgEl("circle");
      c.setAttribute("cx", String(x));
      c.setAttribute("cy", String(y));
      c.setAttribute("r", String(NODE_R));
      c.setAttribute("fill", "#1e1e2a");
      c.setAttribute("stroke", WIP_COLOR);
      c.setAttribute("stroke-width", "2");
      c.setAttribute("stroke-dasharray", "2 2");
      svg.appendChild(c);
    } else {
      // commit → per-author avatar; HEAD gets a highlight ring
      const c = p.node.commit!;
      const isHead = c.hash === repo.head;
      const half = AVATAR / 2;

      if (isHead) {
        const ring = svgEl("rect");
        ring.setAttribute("x", String(x - half - 2));
        ring.setAttribute("y", String(y - half - 2));
        ring.setAttribute("width", String(AVATAR + 4));
        ring.setAttribute("height", String(AVATAR + 4));
        ring.setAttribute("rx", "6");
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", repo.head_branch ? "#ffffff" : "#ff8f8f");
        ring.setAttribute("stroke-width", "2");
        svg.appendChild(ring);
      }

      const img = svgEl("image");
      const key = c.email || c.author;
      img.setAttribute("href", avatarUrl(key));
      img.setAttribute("x", String(x - half));
      img.setAttribute("y", String(y - half));
      img.setAttribute("width", String(AVATAR));
      img.setAttribute("height", String(AVATAR));
      const title = svgEl("title");
      title.textContent = `${c.author} <${c.email}>`;
      img.appendChild(title);
      svg.appendChild(img);
    }
  }

  // 3-column rows: [ Branch/Tag | Graph spacer | Commit message ]
  const rows = $("rows");
  rows.innerHTML = "";
  for (const p of placed) {
    const n = p.node;
    const row = document.createElement("div");
    row.className = "crow";
    row.dataset.id = n.id;
    if (n.id === t.selected) row.classList.add("selected");

    let refHtml = "";
    let msgHtml = "";

    if (n.kind === "wip") {
      const w = n.wip!;
      const parts: string[] = [];
      if (w.staged) parts.push(`${w.staged} staged`);
      if (w.unstaged) parts.push(`${w.unstaged} unstaged`);
      if (w.untracked) parts.push(`${w.untracked} untracked`);
      msgHtml =
        `<span class="badge wip">WIP</span>` +
        `<span class="summary">Uncommitted changes — ${parts.join(", ")}</span>`;
    } else if (n.kind === "stash") {
      const s = n.stash!;
      msgHtml =
        `<span class="badge stash">${icon("stash")}${escapeHtml(s.selector)}</span>` +
        `<span class="summary">${escapeHtml(s.message)}</span>` +
        `<span class="date">${fmtDate(s.time)}</span>` +
        `<span class="hash">${s.hash.slice(0, 8)}</span>`;
    } else {
      const c = n.commit!;
      const isHead = c.hash === repo.head;
      refHtml =
        (isHead && !repo.head_branch
          ? `<span class="badge detached">HEAD · detached</span>`
          : "") + buildRefColumn(refsByHash.get(c.hash) ?? []);
      msgHtml =
        `<span class="summary">${escapeHtml(c.summary)}</span>` +
        `<span class="author">${escapeHtml(c.author)}</span>` +
        `<span class="date">${fmtDate(c.time)}</span>` +
        `<span class="hash">${c.hash.slice(0, 8)}</span>`;
    }

    row.innerHTML =
      `<div class="col-ref">${refHtml}</div>` +
      `<div class="col-graph" style="width:${graphW}px"></div>` +
      `<div class="col-msg">${msgHtml}</div>`;

    row.addEventListener("click", () => selectNode(n));
    if (n.kind === "commit") {
      const hash = n.commit!.hash;
      const refsHere = refsByHash.get(hash) ?? [];
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        // right-click on a branch/tag badge -> that ref's menu (has Merge etc.)
        const badge = (e.target as HTMLElement).closest(
          ".badge[data-refname]"
        ) as HTMLElement | null;
        if (badge) {
          const ref = repo.refs.find(
            (x) =>
              x.name === badge.dataset.refname &&
              x.kind === badge.dataset.refkind
          );
          if (ref) {
            showMenu(e.clientX, e.clientY, branchMenu(ref, repo));
            return;
          }
        }
        selectNode(n);
        showMenu(e.clientX, e.clientY, commitMenu(hash, refsHere, repo));
      });
      // "+N" pill -> dropdown of all refs at this commit (checkout any)
      const plus = row.querySelector(".refplus");
      if (plus) {
        plus.addEventListener("click", (e) => {
          e.stopPropagation();
          const me = e as MouseEvent;
          showMenu(
            me.clientX,
            me.clientY,
            refsHere.map((r) => {
              const isRemote = r.kind === "remote";
              const target = isRemote
                ? r.name.split("/").slice(1).join("/")
                : r.name;
              return {
                label: `Checkout ${r.name}`,
                action: () => doCheckout(target, isRemote ? r.name : undefined),
              };
            })
          );
        });
      }
    } else if (n.kind === "stash") {
      const s = n.stash!;
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        selectNode(n);
        showMenu(e.clientX, e.clientY, stashMenu(s, repo));
      });
    }
    rows.appendChild(row);
  }

  $("empty").classList.add("hidden");
}

function findById(t: Tab, id: string): GNode | null {
  return t.nodes.find((n) => n.id === id) ?? null;
}

// ---- selection / detail ----
function clearDetail() {
  $("detail-empty").classList.remove("hidden");
  $("detail-body").classList.add("hidden");
  $("commit-panel").classList.add("hidden");
  $("conflict-panel").classList.add("hidden");
}

async function selectNode(n: GNode | null, scroll = false) {
  const t = cur();
  if (!t || !n) return;
  t.selected = n.id;
  showDiffView(false); // return main area to the graph

  document.querySelectorAll(".crow").forEach((el) => {
    el.classList.toggle("selected", (el as HTMLElement).dataset.id === n.id);
  });
  if (scroll) {
    const el = document.querySelector(
      `.crow[data-id="${cssEsc(n.id)}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "center" });
  }

  $("detail-empty").classList.add("hidden");
  $("commit-panel").classList.toggle("hidden", n.kind !== "wip");
  $("detail-body").classList.toggle("hidden", n.kind === "wip");

  if (n.kind === "wip") {
    await refreshCommitFiles();
    return;
  }

  if (n.kind === "stash") {
    const s = n.stash!;
    $("d-summary").textContent = s.message;
    $("d-meta").innerHTML =
      `<div>${escapeHtml(s.selector)}</div>` +
      `<div>${new Date(s.time * 1000).toLocaleString()}</div>` +
      `<div><code>${s.hash}</code></div>`;
    await loadFiles(t.repo.path, s.hash);
    return;
  }

  const c = n.commit!;
  $("d-summary").textContent = c.summary;
  $("d-meta").innerHTML =
    `<div>${escapeHtml(c.author)} &lt;${escapeHtml(c.email)}&gt;</div>` +
    `<div>${new Date(c.time * 1000).toLocaleString()}</div>` +
    `<div><code>${c.hash}</code></div>` +
    (c.parents.length
      ? `<div>parents: ${c.parents
          .map((p) => `<code>${p.slice(0, 8)}</code>`)
          .join(", ")}</div>`
      : `<div>(root commit)</div>`);
  await loadFiles(t.repo.path, c.hash);
}

// hash === null means WIP (working tree)
async function loadFiles(path: string, hash: string | null) {
  const filesUl = $("d-files");
  filesUl.innerHTML = "<li class='muted'>loading…</li>";
  try {
    const files = hash
      ? await invoke<FileChange[]>("commit_files", { path, hash })
      : await invoke<FileChange[]>("wip_files", { path });
    filesUl.innerHTML = "";
    if (!files.length) {
      filesUl.innerHTML = "<li class='muted'>(no file changes)</li>";
    }
    files.forEach((f) => {
      const li = document.createElement("li");
      const s = f.status.charAt(0).toUpperCase();
      const cls = s === "?" ? "Q" : s;
      li.innerHTML = `<span class="fstatus ${cls}">${s}</span><span>${escapeHtml(
        f.path
      )}</span>`;
      li.addEventListener("click", () => {
        filesUl
          .querySelectorAll("li")
          .forEach((x) => x.classList.remove("selected"));
        li.classList.add("selected");
        openDiff(f.path, path, f.path, hash);
      });
      filesUl.appendChild(li);
    });
  } catch (e) {
    filesUl.innerHTML = `<li class='muted'>${escapeHtml(String(e))}</li>`;
  }
}

// ---- open repo (new tab) ----
async function openRepo() {
  const picked = await open({
    directory: true,
    title: "Select a Git repository",
  });
  if (!picked || Array.isArray(picked)) return;
  await loadRepo(picked);
}

async function loadRepo(path: string, silent = false) {
  // already open? just focus it.
  const existing = tabs.findIndex((t) => t.repo.path === path);
  if (existing !== -1) {
    switchTab(existing);
    return;
  }
  setStatus("loading…");
  try {
    const repo = await invoke<RepoData>("open_repo", { path });
    const nodes = buildNodes(repo);
    const tab: Tab = {
      repo,
      selected: repo.head || (repo.wip ? WIP_ID : null),
      nodes,
      placed: [],
    };
    tabs.push(tab);
    active = tabs.length - 1;
    renderTabs();
    renderActive();
    saveSession();
  } catch (e) {
    setStatus("");
    if (silent) console.warn("skip repo", path, String(e));
    else alert("Could not open repo:\n" + String(e));
  }
}

// ---- session + UI persistence (localStorage) ----
const LS_SESSION = "jkt.session";
const LS_COLLAPSED = "jkt.collapsed";

function saveSession() {
  const data = { paths: tabs.map((t) => t.repo.path), active };
  try {
    localStorage.setItem(LS_SESSION, JSON.stringify(data));
  } catch {}
}

async function restoreSession() {
  let data: { paths: string[]; active: number } | null = null;
  try {
    data = JSON.parse(localStorage.getItem(LS_SESSION) ?? "null");
  } catch {}
  if (!data || !data.paths?.length) return;
  for (const p of data.paths) {
    await loadRepo(p, true); // silent: skip repos that vanished
  }
  if (tabs.length) {
    active = Math.min(Math.max(0, data.active ?? 0), tabs.length - 1);
    renderTabs();
    renderActive();
    saveSession();
  }
}

function getCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_COLLAPSED) ?? "[]"));
  } catch {
    return new Set();
  }
}
function setupCollapsible() {
  const collapsed = getCollapsed();
  document.querySelectorAll<HTMLElement>(".side-section").forEach((sec) => {
    const key = sec.dataset.sec ?? "";
    if (collapsed.has(key)) sec.classList.add("collapsed");
    const sicon = sec.querySelector(".sicon");
    if (sicon) sicon.innerHTML = icon(key);
    const head = sec.querySelector(".side-head");
    head?.addEventListener("click", () => {
      sec.classList.toggle("collapsed");
      const now = new Set<string>();
      document
        .querySelectorAll<HTMLElement>(".side-section.collapsed")
        .forEach((s) => now.add(s.dataset.sec ?? ""));
      try {
        localStorage.setItem(LS_COLLAPSED, JSON.stringify([...now]));
      } catch {}
    });
  });
}

// ---- commit panel (stage / unstage / commit) ----
let stagedCount = 0;

async function refreshCommitFiles() {
  const t = cur();
  if (!t) return;
  const path = t.repo.path;
  let res: { staged: FileChange[]; unstaged: FileChange[] };
  try {
    res = await invoke("wip_status", { path });
  } catch (e) {
    $("c-unstaged").innerHTML = `<li class='muted'>${escapeHtml(String(e))}</li>`;
    return;
  }
  stagedCount = res.staged.length;

  const buildList = (ulId: string, files: FileChange[], stage: boolean) => {
    const ul = $(ulId);
    ul.innerHTML = "";
    if (!files.length) {
      ul.innerHTML = `<li class="muted empty-mini">none</li>`;
      return;
    }
    files.forEach((f) => {
      const li = document.createElement("li");
      const s = f.status.charAt(0).toUpperCase();
      const cls = s === "?" ? "Q" : s;
      li.innerHTML =
        `<span class="fstatus ${cls}">${s}</span>` +
        `<span class="fpath">${escapeHtml(f.path)}</span>` +
        `<button class="mini stagebtn">${stage ? "Stage" : "Unstage"}</button>`;
      li.querySelector(".fpath")?.addEventListener("click", () =>
        openDiff(f.path, path, f.path, null)
      );
      li.querySelector(".stagebtn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        stage ? doStage(f.path) : doUnstage(f.path);
      });
      ul.appendChild(li);
    });
  };
  buildList("c-unstaged", res.unstaged, true);
  buildList("c-staged", res.staged, false);
  $("c-unstaged-n").textContent = String(res.unstaged.length);
  $("c-staged-n").textContent = String(res.staged.length);
  updateCommitEnabled();
}

// open a file diff in the MAIN center area (line numbers + highlighting)
function showDiffView(on: boolean) {
  $("mergeview").classList.add("hidden");
  $("diffview").classList.toggle("hidden", !on);
  $("col-headers").classList.toggle("hidden", on);
  $("scroll").classList.toggle("hidden", on);
}
function showMergeView(on: boolean) {
  $("diffview").classList.add("hidden");
  $("mergeview").classList.toggle("hidden", !on);
  $("col-headers").classList.toggle("hidden", on);
  $("scroll").classList.toggle("hidden", on);
}

// ---- merge conflict resolution ----
let mvFile = ""; // file currently open in the merge resolver
type Choice = "ours" | "theirs" | "both" | null;
interface Seg {
  kind: "normal" | "conflict";
  lines?: string[];
  ours?: string[];
  theirs?: string[];
  choice?: Choice;
}
let mvSegments: Seg[] = [];
let mvManual = false; // raw-textarea editing mode

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// render one side (ours/theirs) as a full numbered file with the conflicting
// lines highlighted. Reconstructed from the parsed segments so it lines up
// exactly with the conflicts shown in the Result pane.
function renderMergeSide(elId: string, side: "ours" | "theirs") {
  let n = 0;
  let html = "";
  for (const s of mvSegments) {
    if (s.kind === "normal") {
      for (const l of s.lines!) {
        n++;
        html += `<div class="ml"><span class="ln">${n}</span><span class="dc">${escapeHtml(l)}</span></div>`;
      }
    } else {
      for (const l of (side === "ours" ? s.ours! : s.theirs!)) {
        n++;
        html += `<div class="ml ${side} conf"><span class="ln">${n}</span><span class="dc">${escapeHtml(l)}</span></div>`;
      }
    }
  }
  $(elId).innerHTML = html;
}

// parse a file with conflict markers into normal/conflict segments
function parseConflicts(text: string): Seg[] {
  const lines = splitLines(text);
  const segs: Seg[] = [];
  let normal: string[] = [];
  const flush = () => {
    if (normal.length) {
      segs.push({ kind: "normal", lines: normal });
      normal = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("<<<<<<<")) {
      flush();
      const ours: string[] = [];
      const theirs: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("=======") && !lines[i].startsWith("|||||||")) {
        ours.push(lines[i++]);
      }
      if (i < lines.length && lines[i].startsWith("|||||||")) {
        i++;
        while (i < lines.length && !lines[i].startsWith("=======")) i++; // skip base
      }
      if (i < lines.length && lines[i].startsWith("=======")) i++;
      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        theirs.push(lines[i++]);
      }
      if (i < lines.length && lines[i].startsWith(">>>>>>>")) i++;
      segs.push({ kind: "conflict", ours, theirs, choice: null });
    } else {
      normal.push(l);
      i++;
    }
  }
  flush();
  return segs;
}

function mvAllResolved(): boolean {
  return mvSegments.every((s) => s.kind !== "conflict" || s.choice);
}

function buildMergedContent(): string {
  const out: string[] = [];
  for (const s of mvSegments) {
    if (s.kind === "normal") out.push(...s.lines!);
    else if (s.choice === "ours") out.push(...s.ours!);
    else if (s.choice === "theirs") out.push(...s.theirs!);
    else if (s.choice === "both") out.push(...s.ours!, ...s.theirs!);
  }
  return out.join("\n") + "\n";
}

function mvUpdateSave() {
  ($("mv-save") as HTMLButtonElement).disabled = !mvManual && !mvAllResolved();
}

function renderMergeResult() {
  const el = $("mv-result");
  let n = 0;
  let html = "";
  mvSegments.forEach((s, idx) => {
    if (s.kind === "normal") {
      for (const l of s.lines!) {
        n++;
        html += `<div class="ml"><span class="ln">${n}</span><span class="dc">${escapeHtml(l)}</span></div>`;
      }
      return;
    }
    const c = s.choice;
    html +=
      `<div class="confbar" data-idx="${idx}">` +
      `<span class="confbar-label">conflict</span>` +
      `<button data-act="ours" class="mini ${c === "ours" ? "sel" : ""}">ours</button>` +
      `<button data-act="theirs" class="mini ${c === "theirs" ? "sel" : ""}">theirs</button>` +
      `<button data-act="both" class="mini ${c === "both" ? "sel" : ""}">both</button>` +
      `</div>`;
    const showOurs = c === null || c === "ours" || c === "both";
    const showTheirs = c === null || c === "theirs" || c === "both";
    if (showOurs)
      for (const l of s.ours!) {
        const num = c ? String(++n) : "";
        html += `<div class="ml ours"><span class="ln">${num}</span><span class="dc">${escapeHtml(l)}</span></div>`;
      }
    if (showTheirs)
      for (const l of s.theirs!) {
        const num = c ? String(++n) : "";
        html += `<div class="ml theirs"><span class="ln">${num}</span><span class="dc">${escapeHtml(l)}</span></div>`;
      }
  });
  el.innerHTML = html;
  el.querySelectorAll<HTMLElement>(".confbar button").forEach((b) => {
    b.addEventListener("click", () => {
      const idx = +(b.closest(".confbar") as HTMLElement).dataset.idx!;
      mvSegments[idx].choice = b.dataset.act as Choice;
      renderMergeResult();
      mvUpdateSave();
    });
  });
}

function resolveAll(side: Choice) {
  mvSegments.forEach((s) => {
    if (s.kind === "conflict") s.choice = side;
  });
  if (mvManual) toggleManual(); // back to rendered view
  renderMergeResult();
  mvUpdateSave();
}

function toggleManual() {
  mvManual = !mvManual;
  const ta = $("mv-output") as HTMLTextAreaElement;
  if (mvManual) ta.value = buildMergedContent();
  ta.classList.toggle("hidden", !mvManual);
  $("mv-result").classList.toggle("hidden", mvManual);
  ($("mv-edit") as HTMLButtonElement).textContent = mvManual ? "Visual" : "Edit text";
  mvUpdateSave();
}

function renderConflictPanel(t: Tab) {
  const c = t.repo.conflict;
  $("cf-kind").textContent = c.kind || "merge";
  const ul = $("cf-files");
  ul.innerHTML = "";
  c.files.forEach((f) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="fstatus M">!</span><span class="fpath">${escapeHtml(f)}</span>`;
    li.addEventListener("click", () => openMergeView(f));
    ul.appendChild(li);
  });
  $("cf-n").textContent = String(c.files.length);
  $("cf-allresolved").classList.toggle("hidden", c.files.length !== 0);
  ($("cf-finish") as HTMLButtonElement).disabled = c.files.length !== 0;
}

async function openMergeView(file: string) {
  const t = cur();
  if (!t) return;
  mvFile = file;
  mvManual = false;
  $("mergeview-title").textContent = file;
  $("mv-ours-code").innerHTML = "";
  $("mv-theirs-code").innerHTML = "";
  $("mv-result").innerHTML = "loading…";
  $("mv-output").classList.add("hidden");
  $("mv-result").classList.remove("hidden");
  ($("mv-edit") as HTMLButtonElement).textContent = "Edit text";
  showMergeView(true);
  try {
    const v = await invoke<{ ours: string; theirs: string; merged: string }>(
      "conflict_versions",
      { path: t.repo.path, file }
    );
    ($("mv-output") as HTMLTextAreaElement).value = v.merged;
    mvSegments = parseConflicts(v.merged);
    renderMergeSide("mv-ours-code", "ours");
    renderMergeSide("mv-theirs-code", "theirs");
    renderMergeResult();
    mvUpdateSave();
  } catch (e) {
    $("mv-result").textContent = String(e);
  }
}

async function saveResolved() {
  const t = cur();
  if (!t || !mvFile) return;
  const content = mvManual
    ? ($("mv-output") as HTMLTextAreaElement).value
    : buildMergedContent();
  try {
    await invoke("resolve_write", { path: t.repo.path, file: mvFile, content });
    mvFile = "";
    await reloadActive("Resolved file");
  } catch (e) {
    alert("Save failed:\n" + String(e));
  }
}

async function abortMerge() {
  const t = cur();
  if (!t) return;
  if (!(await confirmModal(`Abort the ${t.repo.conflict.kind || "merge"}?`))) return;
  runAction(
    invoke("merge_abort", { path: t.repo.path, kind: t.repo.conflict.kind }),
    "Aborted"
  );
}

async function finishMerge() {
  const t = cur();
  if (!t) return;
  runAction(
    invoke("merge_continue", { path: t.repo.path, kind: t.repo.conflict.kind }),
    "Completed"
  );
}

function showDiffText(title: string, diff: string) {
  $("diffview-title").textContent = title;
  const body = $("diffview-body");
  body.innerHTML =
    renderUnifiedDiff(diff) ||
    "<div class='dl ctx'><span class='dc'>(no changes)</span></div>";
  showDiffView(true);
  buildMinimap();
}

async function openDiff(
  title: string,
  path: string,
  file: string,
  hash: string | null
) {
  $("diffview-title").textContent = title;
  const body = $("diffview-body");
  body.innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  showDiffView(true);
  try {
    const diff = hash
      ? await invoke<string>("commit_diff", { path, hash, file })
      : await invoke<string>("wip_diff", { path, file });
    showDiffText(title, diff);
  } catch (e) {
    body.innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
    $("diff-minimap").innerHTML = "";
  }
}

async function compareCommitToWorking(path: string, hash: string) {
  $("diffview-title").textContent = `${hash.slice(0, 8)} ↔ working directory`;
  $("diffview-body").innerHTML =
    "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  showDiffView(true);
  try {
    const diff = await invoke<string>("diff_commit_worktree", { path, hash });
    showDiffText(`${hash.slice(0, 8)} ↔ working directory`, diff);
  } catch (e) {
    $("diffview-body").innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
  }
}

// red/green change markers down the right edge (whole-file overview)
function buildMinimap() {
  const body = $("diffview-body");
  const map = $("diff-minimap");
  map.innerHTML = "";
  const rows = body.children;
  const total = rows.length;
  if (!total) return;
  for (let i = 0; i < total; i++) {
    const cls = rows[i].classList;
    const kind = cls.contains("add") ? "add" : cls.contains("del") ? "del" : "";
    if (!kind) continue;
    const mark = document.createElement("div");
    mark.className = `mm ${kind}`;
    mark.style.top = `${(i / total) * 100}%`;
    mark.addEventListener("click", () => {
      body.scrollTop = (i / total) * body.scrollHeight - body.clientHeight / 2;
    });
    map.appendChild(mark);
  }
}

function updateCommitEnabled() {
  const summary = ($("c-summary") as HTMLInputElement).value.trim();
  const amend = ($("c-amend") as HTMLInputElement).checked;
  ($("c-commit") as HTMLButtonElement).disabled = !(
    summary &&
    (stagedCount > 0 || amend)
  );
}

// stage/unstage: update files + graph WIP counts, keep the typed message
async function afterStageChange() {
  await refreshCommitFiles();
  await reloadGraphOnly();
}
async function doStage(file: string) {
  const t = cur();
  if (!t) return;
  try {
    await invoke("stage_file", { path: t.repo.path, file });
    await afterStageChange();
  } catch (e) {
    alert(String(e));
  }
}
async function doUnstage(file: string) {
  const t = cur();
  if (!t) return;
  try {
    await invoke("unstage_file", { path: t.repo.path, file });
    await afterStageChange();
  } catch (e) {
    alert(String(e));
  }
}
async function doStageAll() {
  const t = cur();
  if (!t) return;
  try {
    await invoke("stage_all", { path: t.repo.path });
    await afterStageChange();
  } catch (e) {
    alert(String(e));
  }
}
async function doUnstageAll() {
  const t = cur();
  if (!t) return;
  try {
    await invoke("unstage_all", { path: t.repo.path });
    await afterStageChange();
  } catch (e) {
    alert(String(e));
  }
}
async function doCommit() {
  const t = cur();
  if (!t) return;
  const summary = ($("c-summary") as HTMLInputElement).value.trim();
  if (!summary) return;
  const desc = ($("c-desc") as HTMLTextAreaElement).value.trim();
  const amend = ($("c-amend") as HTMLInputElement).checked;
  const message = desc ? `${summary}\n\n${desc}` : summary;
  try {
    await invoke("commit", { path: t.repo.path, message, amend });
    ($("c-summary") as HTMLInputElement).value = "";
    ($("c-desc") as HTMLTextAreaElement).value = "";
    ($("c-amend") as HTMLInputElement).checked = false;
    await reloadActive("Committed");
  } catch (e) {
    alert("Commit failed:\n" + String(e));
  }
}

// reload repo data + graph/sidebar, but DON'T touch the detail/commit panel
async function reloadGraphOnly() {
  const t = cur();
  if (!t) return;
  try {
    const repo = await invoke<RepoData>("open_repo", { path: t.repo.path });
    t.repo = repo;
    t.nodes = buildNodes(repo);
    renderSidebar(t);
    renderGraph(t);
    t.fingerprint = await invoke<string>("repo_fingerprint", {
      path: t.repo.path,
    }).catch(() => t.fingerprint);
  } catch (e) {
    console.warn("graph reload failed", String(e));
  }
}

// ---- auto-refresh: poll a cheap fingerprint, reload graph on any change ----
let polling = false;
async function pollActive() {
  if (polling) return;
  const t = cur();
  if (!t) return;
  polling = true;
  try {
    const fp = await invoke<string>("repo_fingerprint", { path: t.repo.path });
    if (t.fingerprint === undefined) {
      t.fingerprint = fp; // first sight: baseline, don't reload
    } else if (fp !== t.fingerprint) {
      t.fingerprint = fp;
      await reloadGraphOnly();
      if (t.selected === WIP_ID) await refreshCommitFiles();
    }
  } catch {
    /* repo gone/locked — ignore this tick */
  } finally {
    polling = false;
  }
}

// enable/disable + tooltip the top toolbar based on repo state
function setToolbar(repo: RepoData | null) {
  const set = (id: string, disabled: boolean, title?: string) => {
    const b = $(id) as HTMLButtonElement;
    b.disabled = disabled;
    if (title !== undefined) b.title = title;
  };
  if (!repo) {
    ["fetch-btn", "pull-btn", "push-btn", "branch-btn", "stash-btn", "pop-btn", "terminal-btn"].forEach(
      (id) => set(id, true)
    );
    return;
  }
  const br = repo.head_branch;
  const detached = !br;
  const conflict = repo.conflict.active;
  set("fetch-btn", conflict);
  set(
    "pull-btn",
    detached || conflict,
    conflict
      ? "Resolve the conflict first"
      : detached
      ? "Pull unavailable — detached HEAD"
      : `Pull origin/${br} into ${br} (fast-forward/merge)\ngit pull`
  );
  set(
    "push-btn",
    detached || conflict,
    conflict
      ? "Resolve the conflict first"
      : detached
      ? "Push unavailable — detached HEAD"
      : `Push the current branch to origin/${br}\ngit push -u origin ${br}`
  );
  set("branch-btn", conflict);
  set("stash-btn", conflict,
    conflict ? "Cannot stash during a conflict" : "Stash all changes including untracked\ngit stash --include-untracked");
  set("pop-btn", conflict || repo.stashes.length === 0,
    conflict
      ? "Cannot pop during a conflict"
      : repo.stashes.length === 0
      ? "No stashes to pop"
      : "Apply and remove the latest stash\ngit stash pop");
  set("terminal-btn", false);
}

// ---- reload / write operations ----
async function reloadActive(statusMsg?: string) {
  const t = cur();
  if (!t) return;
  try {
    const repo = await invoke<RepoData>("open_repo", { path: t.repo.path });
    t.repo = repo;
    t.nodes = buildNodes(repo);
    if (t.selected && !t.nodes.find((n) => n.id === t.selected)) {
      t.selected = repo.head || (repo.wip ? WIP_ID : null);
    }
    t.fingerprint = await invoke<string>("repo_fingerprint", {
      path: t.repo.path,
    }).catch(() => t.fingerprint);
    renderActive();
    if (statusMsg) setStatus(statusMsg);
  } catch (e) {
    alert("Reload failed:\n" + String(e));
  }
}

async function doCheckout(target: string, upstream?: string) {
  const t = cur();
  if (!t) return;
  setStatus(`checking out ${target}…`);
  try {
    const stashed = await invoke<boolean>("checkout", {
      path: t.repo.path,
      target,
      upstream: upstream ?? null,
    });
    await reloadActive(
      stashed
        ? `Checked out ${target} — local changes stashed`
        : `Checked out ${target}`
    );
  } catch (e) {
    setStatus("");
    alert("Checkout failed:\n" + String(e));
  }
}

async function doFetch() {
  const t = cur();
  if (!t) return;
  setStatus("fetching…");
  try {
    await invoke<string>("fetch", { path: t.repo.path });
    await reloadActive("Fetched");
  } catch (e) {
    setStatus("");
    alert("Fetch failed:\n" + String(e));
  }
}

async function doPull() {
  const t = cur();
  if (!t) return;
  setStatus("pulling…");
  runAction(invoke("pull", { path: t.repo.path }), "Pulled");
}
async function doPush() {
  const t = cur();
  if (!t) return;
  setStatus("pushing…");
  try {
    const msg = await invoke<string>("push", { path: t.repo.path });
    await reloadActive(msg);
  } catch (e) {
    setStatus("");
    alert("Push failed:\n" + String(e));
  }
}
async function doBranch() {
  const t = cur();
  if (!t) return;
  const name = await promptModal("New branch name", "feature/my-branch");
  if (name)
    runAction(
      invoke("create_branch_checkout", { path: t.repo.path, name }),
      `Created & switched to ${name}`
    );
}
async function doStashBtn() {
  const t = cur();
  if (!t) return;
  runAction(invoke("stash_push", { path: t.repo.path }), "Stashed changes");
}
async function doPop() {
  const t = cur();
  if (!t) return;
  runAction(invoke("stash_pop", { path: t.repo.path }), "Popped stash");
}
async function doTerminal() {
  const t = cur();
  if (!t) return;
  try {
    await invoke("open_terminal", { path: t.repo.path });
  } catch (e) {
    alert("Open terminal failed:\n" + String(e));
  }
}

// ---- context menu ----
interface MenuItem {
  label?: string;
  action?: () => void;
  separator?: boolean;
}
function showMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu();
  if (!items.length) return;
  const menu = document.createElement("div");
  menu.id = "ctxmenu";
  items.forEach((it) => {
    if (it.separator) {
      const sep = document.createElement("div");
      sep.className = "ctxsep";
      menu.appendChild(sep);
      return;
    }
    const row = document.createElement("div");
    row.className = "ctxitem";
    row.textContent = it.label ?? "";
    row.addEventListener("click", () => {
      closeMenu();
      it.action?.();
    });
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  // keep on-screen
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 4);
  const py = Math.min(y, window.innerHeight - rect.height - 4);
  menu.style.left = `${px}px`;
  menu.style.top = `${Math.max(4, py)}px`;
}
function closeMenu() {
  document.getElementById("ctxmenu")?.remove();
}

// ---- name prompt modal (returns entered text or null) ----
function promptModal(
  title: string,
  placeholder = "",
  initial = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      `<div class="modal">` +
      `<div class="modal-title">${escapeHtml(title)}</div>` +
      `<input class="modal-input" placeholder="${escapeHtml(placeholder)}" />` +
      `<div class="modal-btns">` +
      `<button class="modal-cancel">Cancel</button>` +
      `<button class="modal-ok">OK</button>` +
      `</div></div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".modal-input") as HTMLInputElement;
    input.value = initial;
    input.focus();
    input.select();
    const done = (val: string | null) => {
      overlay.remove();
      resolve(val);
    };
    overlay.querySelector(".modal-ok")?.addEventListener("click", () =>
      done(input.value.trim() || null)
    );
    overlay.querySelector(".modal-cancel")?.addEventListener("click", () =>
      done(null)
    );
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(input.value.trim() || null);
      if (e.key === "Escape") done(null);
    });
  });
}

async function copyText(s: string) {
  try {
    await navigator.clipboard.writeText(s);
    setStatus("Copied");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    setStatus("Copied");
  }
}

// run a mutating git action, then refresh the graph
async function runAction(p: Promise<unknown>, okMsg: string) {
  try {
    const stashed = await p;
    await reloadActive(stashed === true ? `${okMsg} (changes stashed)` : okMsg);
  } catch (e) {
    setStatus("");
    alert(`${okMsg} failed:\n${String(e)}`);
  }
}

function confirmModal(title: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      `<div class="modal"><div class="modal-title">${escapeHtml(title)}</div>` +
      `<div class="modal-btns"><button class="modal-cancel">Cancel</button>` +
      `<button class="modal-ok danger">Confirm</button></div></div>`;
    document.body.appendChild(overlay);
    const done = (v: boolean) => {
      overlay.remove();
      resolve(v);
    };
    overlay.querySelector(".modal-ok")?.addEventListener("click", () => done(true));
    overlay.querySelector(".modal-cancel")?.addEventListener("click", () => done(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
    });
  });
}

async function doCreateBranch(path: string, start: string) {
  const name = await promptModal("New branch name", "feature/my-branch");
  if (name) runAction(invoke("create_branch", { path, name, start }), `Created branch ${name}`);
}
async function doCreateTag(path: string, hash: string, annotated: boolean) {
  const name = await promptModal("Tag name", "v1.0.0");
  if (!name) return;
  if (annotated) {
    const message = await promptModal("Tag message", "Release notes…");
    if (message === null) return;
    runAction(
      invoke("create_tag_annotated", { path, name, message, hash }),
      `Created tag ${name}`
    );
  } else {
    runAction(invoke("create_tag", { path, name, hash }), `Created tag ${name}`);
  }
}
async function doWorktree(path: string, hash: string) {
  const dir = await open({ directory: true, title: "Pick an empty folder for the worktree" });
  if (!dir || Array.isArray(dir)) return;
  runAction(invoke("worktree_add", { path, dir, hash }), "Worktree created");
}
async function doHardReset(path: string, hash: string, branch: string, sha: string) {
  const ok = await confirmModal(
    `Hard reset ${branch} to ${sha}? Uncommitted changes will be lost.`
  );
  if (ok) runAction(invoke("reset_to", { path, hash, mode: "hard" }), `Reset (hard) to ${sha}`);
}

function commitMenu(
  hash: string,
  refsHere: RefInfo[],
  repo: RepoData
): MenuItem[] {
  const path = repo.path;
  const curBranch = repo.head_branch;
  const sha = hash.slice(0, 8);
  const items: MenuItem[] = [];

  for (const r of refsHere.filter((r) => r.kind === "local"))
    items.push({ label: `Checkout branch ${r.name}`, action: () => doCheckout(r.name) });
  for (const r of refsHere.filter((r) => r.kind === "remote")) {
    const short = r.name.split("/").slice(1).join("/");
    items.push({
      label: `Checkout branch ${short} (track ${r.name})`,
      action: () => doCheckout(short, r.name),
    });
  }
  for (const r of refsHere.filter((r) => r.kind === "tag"))
    items.push({ label: `Checkout tag ${r.name}`, action: () => doCheckout(r.name) });
  items.push({ label: `Checkout commit ${sha} (detached)`, action: () => doCheckout(hash) });

  items.push({ separator: true });
  items.push({ label: "Create worktree from this commit…", action: () => doWorktree(path, hash) });
  items.push({ label: "Create branch here…", action: () => doCreateBranch(path, hash) });
  items.push({
    label: "Cherry-pick commit",
    action: () => runAction(invoke("cherry_pick", { path, hash }), `Cherry-picked ${sha}`),
  });
  if (curBranch) {
    items.push({
      label: `Rebase ${curBranch} onto this commit`,
      action: () => runAction(invoke("rebase_onto", { path, reference: hash }), `Rebased onto ${sha}`),
    });
    items.push({
      label: `Reset ${curBranch} to here (mixed)`,
      action: () => runAction(invoke("reset_to", { path, hash, mode: "mixed" }), `Reset (mixed) to ${sha}`),
    });
    items.push({
      label: `Reset ${curBranch} to here (soft)`,
      action: () => runAction(invoke("reset_to", { path, hash, mode: "soft" }), `Reset (soft) to ${sha}`),
    });
    items.push({
      label: `Reset ${curBranch} to here (hard)`,
      action: () => doHardReset(path, hash, curBranch, sha),
    });
  }
  items.push({
    label: "Revert commit",
    action: () => runAction(invoke("revert_commit", { path, hash }), `Reverted ${sha}`),
  });

  items.push({ separator: true });
  items.push({ label: "Copy commit SHA", action: () => copyText(hash) });
  items.push({
    label: "Compare commit against working directory",
    action: () => compareCommitToWorking(path, hash),
  });

  items.push({ separator: true });
  items.push({ label: "Create tag here…", action: () => doCreateTag(path, hash, false) });
  items.push({ label: "Create annotated tag here…", action: () => doCreateTag(path, hash, true) });
  return items;
}

function stashMenu(s: StashEntry, repo: RepoData): MenuItem[] {
  const path = repo.path;
  const sel = s.selector;
  return [
    {
      label: `Apply ${sel}`,
      action: () => runAction(invoke("stash_apply", { path, selector: sel }), `Applied ${sel}`),
    },
    {
      label: `Pop ${sel}`,
      action: () => runAction(invoke("stash_pop_at", { path, selector: sel }), `Popped ${sel}`),
    },
    { separator: true },
    {
      label: `Delete ${sel}`,
      action: async () => {
        if (await confirmModal(`Delete ${sel}? This cannot be undone.`))
          runAction(invoke("stash_drop", { path, selector: sel }), `Deleted ${sel}`);
      },
    },
  ];
}

function branchMenu(r: RefInfo, repo: RepoData): MenuItem[] {
  const path = repo.path;
  const curBranch = repo.head_branch;
  const hash = r.target;
  const isRemote = r.kind === "remote";
  const isTag = r.kind === "tag";
  const target = isRemote ? r.name.split("/").slice(1).join("/") : r.name;
  const upstream = isRemote ? r.name : undefined;
  const verb = isTag ? "tag" : isRemote ? "remote branch" : "branch";
  const items: MenuItem[] = [];

  items.push({ label: `Checkout ${verb} ${target}`, action: () => doCheckout(target, upstream) });
  if (curBranch && r.name !== curBranch && !isTag) {
    items.push({ separator: true });
    items.push({
      label: `Merge ${r.name} into ${curBranch}`,
      action: () => runAction(invoke("merge_ref", { path, reference: r.name }), `Merged ${r.name}`),
    });
    items.push({
      label: `Rebase ${curBranch} onto ${r.name}`,
      action: () => runAction(invoke("rebase_onto", { path, reference: r.name }), `Rebased onto ${r.name}`),
    });
    if (isRemote) {
      items.push({
        label: `Reset ${curBranch} to ${r.name} (soft)`,
        action: () =>
          runAction(
            invoke("reset_to", { path, hash: r.target, mode: "soft" }),
            `Reset (soft) ${curBranch} to ${r.name}`
          ),
      });
      items.push({
        label: `Reset ${curBranch} to ${r.name} (hard)`,
        action: () => doHardReset(path, r.target, curBranch, r.name),
      });
    }
  }
  items.push({ separator: true });
  items.push({ label: "Create branch here…", action: () => doCreateBranch(path, hash) });
  items.push({
    label: "Cherry-pick commit",
    action: () => runAction(invoke("cherry_pick", { path, hash }), `Cherry-picked ${hash.slice(0, 8)}`),
  });
  items.push({ separator: true });
  items.push({ label: "Create tag here…", action: () => doCreateTag(path, hash, false) });
  items.push({ label: "Create annotated tag here…", action: () => doCreateTag(path, hash, true) });
  items.push({ separator: true });
  items.push({ label: "Copy branch name", action: () => copyText(r.name) });
  items.push({ label: "Copy commit SHA", action: () => copyText(hash) });
  items.push({
    label: "Compare commit against working directory",
    action: () => compareCommitToWorking(path, hash),
  });
  return items;
}

// ---- utils ----
function setStatus(s: string) {
  $("status").textContent = s;
}
function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function cssEsc(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
function fmtDate(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Simple gray line icons (no emoji).
const ICONS: Record<string, string> = {
  local: `<rect x="2" y="3.5" width="12" height="8" rx="1"/><path d="M6.5 14h3"/>`,
  remote: `<path d="M4.7 12a2.3 2.3 0 0 1-.2-4.6 3.2 3.2 0 0 1 6.2-.7A2.4 2.4 0 0 1 11.3 12z"/>`,
  tag: `<path d="M2.6 7.6V3.1a.5.5 0 0 1 .5-.5h4.5l5.3 5.3a1 1 0 0 1 0 1.4l-3.1 3.1a1 1 0 0 1-1.4 0z"/><circle cx="5" cy="5" r=".7"/>`,
  stash: `<rect x="2.5" y="4" width="11" height="8" rx="1"/><path d="M2.5 8h3l1 1.4h3L13.5 8"/>`,
};
function icon(kind: string): string {
  return (
    `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">` +
    `${ICONS[kind] ?? ""}</svg>`
  );
}

// Deterministic GitHub-style identicon for an author key (email/name).
// Same key -> same icon, always. Cached as a data URL.
const avatarCache = new Map<string, string>();
function avatarUrl(key: string): string {
  const cached = avatarCache.get(key);
  if (cached) return cached;

  const h = Math.abs(hashStr(key || "?"));
  const hue = h % 360;
  const bg = `hsl(${hue}, 50%, 22%)`;
  const fg = `hsl(${hue}, 70%, 62%)`;
  const grid = 5;
  const cell = 10;
  const size = grid * cell; // internal resolution

  let cells = "";
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < grid; row++) {
      // use a bit of the hash per (col,row); mix in a second factor so
      // patterns differ more between similar keys
      const on = ((h >> (col * grid + row)) ^ (h >> (row + 7))) & 1;
      if (!on) continue;
      for (const cx of [col, grid - 1 - col]) {
        cells += `<rect x="${cx * cell}" y="${row * cell}" width="${cell}" height="${cell}" fill="${fg}"/>`;
      }
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="8" fill="${bg}"/>${cells}</svg>`;
  const url = "data:image/svg+xml;base64," + btoa(svg);
  avatarCache.set(key, url);
  return url;
}
// char-level diff of two strings: highlight the differing middle (common
// prefix/suffix stripped). Returns already-escaped HTML for old and new.
function intraline(oldS: string, newS: string): { o: string; n: string } {
  const min = Math.min(oldS.length, newS.length);
  let p = 0;
  while (p < min && oldS[p] === newS[p]) p++;
  let s = 0;
  while (
    s < min - p &&
    oldS[oldS.length - 1 - s] === newS[newS.length - 1 - s]
  )
    s++;
  const pre = oldS.slice(0, p);
  const oMid = oldS.slice(p, oldS.length - s);
  const nMid = newS.slice(p, newS.length - s);
  const oSuf = oldS.slice(oldS.length - s);
  const nSuf = newS.slice(newS.length - s);
  const wrap = (m: string) => (m ? `<span class="chg">${escapeHtml(m)}</span>` : "");
  return {
    o: escapeHtml(pre) + wrap(oMid) + escapeHtml(oSuf),
    n: escapeHtml(pre) + wrap(nMid) + escapeHtml(nSuf),
  };
}

// Parse a unified diff into rows with line numbers, per-line coloring, and
// char-level highlighting on paired changed lines.
function renderUnifiedDiff(diff: string): string {
  const lines = diff.split("\n");
  let oldN = 0;
  let newN = 0;
  const rows: string[] = [];
  const row = (cls: string, ln1: string, ln2: string, codeHtml: string) =>
    `<div class="dl ${cls}"><span class="ln">${ln1}</span>` +
    `<span class="ln">${ln2}</span><span class="dc">${codeHtml}</span></div>`;

  // buffered consecutive removals/additions, flushed as a paired block
  let dels: { text: string; ln: number }[] = [];
  let adds: { text: string; ln: number }[] = [];
  const flush = () => {
    const pair = Math.min(dels.length, adds.length);
    dels.forEach((d, i) =>
      rows.push(
        row(
          "del",
          String(d.ln),
          "",
          i < pair ? intraline(d.text, adds[i].text).o : escapeHtml(d.text)
        )
      )
    );
    adds.forEach((a, i) =>
      rows.push(
        row(
          "add",
          "",
          String(a.ln),
          i < pair ? intraline(dels[i].text, a.text).n : escapeHtml(a.text)
        )
      )
    );
    dels = [];
    adds = [];
  };

  for (const line of lines) {
    if (line === "") continue;
    if (line.startsWith("@@")) {
      flush();
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldN = +m[1];
        newN = +m[2];
      }
      rows.push(row("hunk", "", "", escapeHtml(line)));
    } else if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("similarity") ||
      line.startsWith("rename ") ||
      line.startsWith("\\")
    ) {
      flush();
      rows.push(row("meta", "", "", escapeHtml(line)));
    } else if (line.startsWith("+")) {
      adds.push({ text: line.slice(1), ln: newN++ });
    } else if (line.startsWith("-")) {
      dels.push({ text: line.slice(1), ln: oldN++ });
    } else {
      flush();
      rows.push(row("ctx", String(oldN++), String(newN++), escapeHtml(line.slice(1))));
    }
  }
  flush();
  return rows.join("");
}

window.addEventListener("DOMContentLoaded", () => {
  $("open-btn").addEventListener("click", openRepo);
  $("fetch-btn").addEventListener("click", doFetch);
  $("pull-btn").addEventListener("click", doPull);
  $("push-btn").addEventListener("click", doPush);
  $("branch-btn").addEventListener("click", doBranch);
  $("stash-btn").addEventListener("click", doStashBtn);
  $("pop-btn").addEventListener("click", doPop);
  $("terminal-btn").addEventListener("click", doTerminal);
  $("stage-all").addEventListener("click", doStageAll);
  $("unstage-all").addEventListener("click", doUnstageAll);
  $("c-commit").addEventListener("click", doCommit);
  $("c-amend").addEventListener("change", updateCommitEnabled);
  $("c-summary").addEventListener("input", updateCommitEnabled);
  $("diffview-close").addEventListener("click", () => showDiffView(false));
  // merge resolver
  $("mv-ours").addEventListener("click", () => resolveAll("ours"));
  $("mv-theirs").addEventListener("click", () => resolveAll("theirs"));
  $("mv-edit").addEventListener("click", toggleManual);
  $("mv-save").addEventListener("click", saveResolved);
  $("mv-close").addEventListener("click", () => showDiffView(false));
  $("cf-abort").addEventListener("click", abortMerge);
  $("cf-finish").addEventListener("click", finishMerge);
  setupCollapsible();
  renderTabs();
  restoreSession();
  setInterval(pollActive, 1500); // auto-refresh on file/repo changes
});
// close context menu on any outside click / escape / scroll
window.addEventListener("click", closeMenu);
window.addEventListener("scroll", closeMenu, true);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});
