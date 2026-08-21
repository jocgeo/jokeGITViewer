import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import hljs from "highlight.js/lib/core";
import hlC from "highlight.js/lib/languages/c";
import hlCpp from "highlight.js/lib/languages/cpp";
import hlCsharp from "highlight.js/lib/languages/csharp";
import hlCss from "highlight.js/lib/languages/css";
import hlBash from "highlight.js/lib/languages/bash";
import hlDockerfile from "highlight.js/lib/languages/dockerfile";
import hlGo from "highlight.js/lib/languages/go";
import hlIni from "highlight.js/lib/languages/ini";
import hlJava from "highlight.js/lib/languages/java";
import hlJavascript from "highlight.js/lib/languages/javascript";
import hlJson from "highlight.js/lib/languages/json";
import hlKotlin from "highlight.js/lib/languages/kotlin";
import hlLua from "highlight.js/lib/languages/lua";
import hlMakefile from "highlight.js/lib/languages/makefile";
import hlMarkdown from "highlight.js/lib/languages/markdown";
import hlPerl from "highlight.js/lib/languages/perl";
import hlPhp from "highlight.js/lib/languages/php";
import hlPowershell from "highlight.js/lib/languages/powershell";
import hlPython from "highlight.js/lib/languages/python";
import hlRuby from "highlight.js/lib/languages/ruby";
import hlRust from "highlight.js/lib/languages/rust";
import hlScss from "highlight.js/lib/languages/scss";
import hlSql from "highlight.js/lib/languages/sql";
import hlSwift from "highlight.js/lib/languages/swift";
import hlTypescript from "highlight.js/lib/languages/typescript";
import hlXml from "highlight.js/lib/languages/xml";
import hlYaml from "highlight.js/lib/languages/yaml";
import "highlight.js/styles/github-dark-dimmed.css";

hljs.registerLanguage("c", hlC);
hljs.registerLanguage("cpp", hlCpp);
hljs.registerLanguage("csharp", hlCsharp);
hljs.registerLanguage("css", hlCss);
hljs.registerLanguage("bash", hlBash);
hljs.registerLanguage("dockerfile", hlDockerfile);
hljs.registerLanguage("go", hlGo);
hljs.registerLanguage("ini", hlIni);
hljs.registerLanguage("java", hlJava);
hljs.registerLanguage("javascript", hlJavascript);
hljs.registerLanguage("json", hlJson);
hljs.registerLanguage("kotlin", hlKotlin);
hljs.registerLanguage("lua", hlLua);
hljs.registerLanguage("makefile", hlMakefile);
hljs.registerLanguage("markdown", hlMarkdown);
hljs.registerLanguage("perl", hlPerl);
hljs.registerLanguage("php", hlPhp);
hljs.registerLanguage("powershell", hlPowershell);
hljs.registerLanguage("python", hlPython);
hljs.registerLanguage("ruby", hlRuby);
hljs.registerLanguage("rust", hlRust);
hljs.registerLanguage("scss", hlScss);
hljs.registerLanguage("sql", hlSql);
hljs.registerLanguage("swift", hlSwift);
hljs.registerLanguage("typescript", hlTypescript);
hljs.registerLanguage("xml", hlXml);
hljs.registerLanguage("yaml", hlYaml);

// file extension -> highlight.js language id
const HL_EXT: Record<string, string> = {
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", ino: "cpp",
  cs: "csharp",
  css: "css",
  sh: "bash", bash: "bash", zsh: "bash",
  dockerfile: "dockerfile",
  go: "go",
  ini: "ini", toml: "ini", cfg: "ini", conf: "ini", properties: "ini",
  java: "java",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json",
  kt: "kotlin", kts: "kotlin",
  lua: "lua",
  mk: "makefile", makefile: "makefile",
  md: "markdown", markdown: "markdown",
  pl: "perl", pm: "perl",
  php: "php",
  ps1: "powershell", psm1: "powershell", psd1: "powershell",
  py: "python", pyw: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss", sass: "scss", less: "scss",
  sql: "sql",
  swift: "swift",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", xaml: "xml", vue: "xml", svelte: "xml",
  yml: "yaml", yaml: "yaml",
};

function langForFile(file: string): string | null {
  const base = file.split("/").pop()?.toLowerCase() ?? "";
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  if (base === "cmakelists.txt") return "makefile";
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return HL_EXT[ext] ?? null;
}

// highlight ONE line of code (stateless per line — good enough for diffs);
// falls back to plain escaping for unknown languages or hljs errors
function hlLine(text: string, lang: string | null): string {
  if (!lang || !text) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

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
  describe: string;
  submodules: { name: string; path: string; abs: string }[];
  fingerprint: string;
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
  remoteTags?: Set<string>; // tag names known to exist on origin
  hint?: { hash: string; branch: string }; // "which branch" ghost for selected commit
  hidden?: Set<string>; // ref keys hidden from the graph
  stale?: boolean; // loaded from cache, needs a background refresh
  parentPath?: string; // set when this tab is a submodule of another repo
  hlOff?: boolean; // lineage highlight cleared (click outside the graph)
}

// ---- layout constants ----
const ROW_H = 30;
const PAD = 14;
// Comfortable fixed lane geometry — nodes fill ~50% of their lane so the
// connecting lines stay traceable. Lanes are NEVER compressed: when a repo has
// more branches than fit, the graph column scrolls sideways on its own instead
// (see graphPanX), leaving the commit messages exactly where they are.
const LANE_W = 20;
const NODE_R = 5;
const GRAPH_VIEW_MAX = 340; // widest the graph column gets before it scrolls

let graphPanX = 0; // horizontal scroll offset inside the graph column
const WIP_ID = "__WIP__";
const STASH_COLOR = "#e3b341";
const WIP_COLOR = "#ff9d5c";
// per-branch-line colors. Deliberately DESATURATED: hue alone separates the
// branches, while the muted tone keeps the graph from shouting over the
// commit messages (bright saturated lanes make everything feel equally loud).
const COLORS = [
  "#4aa3ff", "#3fd07a", "#ffc247", "#c77dff",
  "#ff7eb6", "#2fd4d4", "#a8e337", "#ff9d4d",
  "#6f8cff", "#26d9a3", "#ffd23f", "#b96bff",
  "#ff6b8a", "#38bdf8", "#84e04a", "#ffab52",
];

// ---- app state ----
const tabs: Tab[] = [];
let active = -1;

const cur = (): Tab | null => (active >= 0 ? tabs[active] : null);

// ---- DOM helpers ----
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

// ---- build unified node list (commits + stashes + WIP) ----
// ---- search (branches, tags, commit hashes, messages, authors) ----
interface SearchHit {
  label: string;
  sub: string;
  iconKind: string;
  hash: string; // node id to select
}
function runSearch(q: string) {
  const box = $("search-results");
  const t = cur();
  const query = q.trim().toLowerCase();
  if (!t || !query) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const repo = t.repo;
  const hits: SearchHit[] = [];

  for (const r of repo.refs) {
    if (r.name.toLowerCase().includes(query)) {
      hits.push({ label: r.name, sub: r.kind, iconKind: r.kind, hash: r.target });
    }
  }
  for (const c of repo.commits) {
    if (hits.length > 60) break;
    if (
      c.hash.toLowerCase().startsWith(query) ||
      c.summary.toLowerCase().includes(query) ||
      c.author.toLowerCase().includes(query)
    ) {
      hits.push({ label: c.summary, sub: `${c.hash.slice(0, 8)} · ${c.author}`, iconKind: "", hash: c.hash });
    }
  }

  if (!hits.length) {
    box.innerHTML = `<div class="sr-empty muted">No matches</div>`;
    box.classList.remove("hidden");
    return;
  }
  box.innerHTML = hits
    .slice(0, 50)
    .map(
      (h, i) =>
        `<div class="sr-item" data-hash="${cssEsc(h.hash)}" data-i="${i}">` +
        `<span class="sr-icon">${h.iconKind ? icon(h.iconKind) : ""}</span>` +
        `<span class="sr-label">${escapeHtml(h.label)}</span>` +
        `<span class="sr-sub">${escapeHtml(h.sub)}</span></div>`
    )
    .join("");
  box.classList.remove("hidden");
  box.querySelectorAll<HTMLElement>(".sr-item").forEach((el) => {
    el.addEventListener("click", () => {
      const node = findById(t, el.dataset.hash!);
      if (node) selectNode(node, true);
      closeSearch();
    });
  });
}
function searchBoxEl() {
  return document.querySelector(".search-box") as HTMLElement | null;
}
function openSearch() {
  searchBoxEl()?.classList.remove("hidden");
  const i = $("search") as HTMLInputElement;
  i.focus();
  i.select();
}
function toggleSearch() {
  const box = searchBoxEl();
  if (box?.classList.contains("hidden")) openSearch();
  else closeSearch();
}
function closeSearch() {
  searchBoxEl()?.classList.add("hidden");
  const i = $("search") as HTMLInputElement | null;
  if (i) i.value = "";
  const box = $("search-results");
  box.classList.add("hidden");
  box.innerHTML = "";
}

const refKey = (r: { kind: string; name: string }) => `${r.kind}:${r.name}`;

// drag-drop: menu shown when a branch is dropped onto another
// drag a splitter to resize the sidebar / detail panel
function setupSplitter(id: string, panelId: string, side: "left" | "right") {
  const sp = document.getElementById(id);
  const panel = document.getElementById(panelId);
  if (!sp || !panel) return;
  sp.addEventListener("mousedown", (e) => {
    e.preventDefault();
    sp.classList.add("dragging");
    document.body.style.userSelect = "none";
    const move = (ev: MouseEvent) => {
      const r = panel.getBoundingClientRect();
      let w = side === "left" ? ev.clientX - r.left : r.right - ev.clientX;
      w = Math.max(140, Math.min(700, w));
      panel.style.flex = `0 0 ${w}px`;
      schedulePaint();
    };
    const up = () => {
      sp.classList.remove("dragging");
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

// keep several scroll containers in lockstep (vertical + horizontal)
function linkScroll(ids: string[]) {
  const els = ids
    .map((id) => document.getElementById(id))
    .filter((e): e is HTMLElement => !!e);
  let lock = false;
  for (const src of els) {
    src.addEventListener("scroll", () => {
      if (lock) return;
      lock = true;
      for (const o of els)
        if (o !== src) {
          o.scrollTop = src.scrollTop;
          o.scrollLeft = src.scrollLeft;
        }
      requestAnimationFrame(() => (lock = false));
    });
  }
}

function showBranchDropMenu(
  x: number,
  y: number,
  source: string,
  target: string,
  path: string
) {
  const items: MenuItem[] = [
    {
      label: dragSourceRemote
        ? `Merge ${source} into ${target} (fetches first)`
        : `Merge ${source} into ${target}`,
      action: () =>
        runAction(invoke("merge_into", { path, source, target }), `Merged ${source} into ${target}`),
    },
  ];
  // rebasing needs the SOURCE checked out — impossible for a remote ref
  if (!dragSourceRemote) {
    items.push({
      label: `Rebase ${source} onto ${target}`,
      action: () =>
        runAction(invoke("rebase_branch_onto", { path, source, target }), `Rebased ${source} onto ${target}`),
    });
  }
  showMenu(x, y, items);
}

// clicking outside the graph rows (sidebar, empty graph space) resets the
// lineage highlight so every branch is shown at full strength again
function clearGraphHighlight() {
  const t = cur();
  if (!t || t.hlOff || !t.selected) return;
  t.hlOff = true;
  t.hint = undefined;
  paintViewport();
}

function toggleBranchHidden(t: Tab, key: string) {
  if (!t.hidden) t.hidden = new Set();
  if (t.hidden.has(key)) t.hidden.delete(key);
  else t.hidden.add(key);
  t.nodes = buildNodes(t.repo, t.hidden);
  renderGraph(t);
  renderSidebar(t);
}

function buildNodes(repo: RepoData, hidden?: Set<string>): GNode[] {
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

    let chain = chainOf.get(n.id);
    if (chain === undefined) chain = nextChain++; // a new branch tip starts here
    // the FIRST child (topmost in the graph) continues the chain through its
    // first parent; stash/WIP nodes never claim — they'd recolor the branch
    if (n.kind === "commit" && n.parents.length && !chainOf.has(n.parents[0])) {
      chainOf.set(n.parents[0], chain);
    }

    maxLane = Math.max(maxLane, lane, lanes.length - 1);
    let color = COLORS[chain % COLORS.length];
    if (n.kind === "stash") color = STASH_COLOR;
    if (n.kind === "wip") color = WIP_COLOR;
    placed.push({ node: n, row, lane, color });
  });

  return { placed, maxLane };
}

const TIP_SZ = 15; // badge drawn on a branch/tag tip

// which glyph marks this commit as a tip: a local branch wins over a
// remote-only one, tags only when no branch points here. null = plain dot.
function tipGlyph(refs: RefInfo[]): string | null {
  if (!refs.length) return null;
  if (refs.some((r) => r.kind === "local")) return "local";
  if (refs.some((r) => r.kind === "remote")) return "remote";
  if (refs.some((r) => r.kind === "tag")) return "tag";
  return null;
}

// branch colour as a translucent row tint (see .crow --lane-bg)
function laneTint(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
    chip.className = "tab" + (i === active ? " active" : "") + (t.parentPath ? " tab-sub" : "");
    chip.title = t.parentPath ? `${t.parentPath}\n  └ submodule: ${t.repo.path}` : t.repo.path;
    const name = document.createElement("span");
    if (t.parentPath) {
      name.className = "tab-name-sub";
      name.innerHTML =
        `<span class="tab-ic">${icon("submodule")}</span>` +
        `<span class="tab-parent">${escapeHtml(basename(t.parentPath))} ▸</span>` +
        `<span class="tab-self">${escapeHtml(basename(t.repo.path))}</span>`;
    } else {
      name.textContent = basename(t.repo.path);
    }
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
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, repoMenu(t.repo.path));
    });
    // drag to reorder
    chip.draggable = true;
    chip.addEventListener("dragstart", (e) => {
      tabDragFrom = i;
      chip.classList.add("tab-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      }
    });
    chip.addEventListener("dragover", (e) => {
      if (tabDragFrom === null || tabDragFrom === i) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      chip.classList.add("tab-drop");
    });
    chip.addEventListener("dragleave", () => chip.classList.remove("tab-drop"));
    chip.addEventListener("drop", (e) => {
      e.preventDefault();
      chip.classList.remove("tab-drop");
      if (tabDragFrom !== null && tabDragFrom !== i) moveTab(tabDragFrom, i);
      tabDragFrom = null;
    });
    chip.addEventListener("dragend", () => {
      tabDragFrom = null;
      strip
        .querySelectorAll(".tab-dragging, .tab-drop")
        .forEach((x) => x.classList.remove("tab-dragging", "tab-drop"));
    });
    strip.appendChild(chip);
  });
}

let tabDragFrom: number | null = null;

function moveTab(from: number, to: number) {
  if (from === to) return;
  const activeTab = tabs[active];
  const [moved] = tabs.splice(from, 1);
  const dest = from < to ? to - 1 : to;
  tabs.splice(dest, 0, moved);
  active = tabs.indexOf(activeTab);
  renderTabs();
  saveSession();
}

function switchTab(i: number) {
  active = i;
  renderTabs();
  renderActive();
  syncChatToTab();
  void syncRepoHost(); // avatars are looked up against this repo's origin
  saveSession();
  // fetch remote-tag status the first time this tab is viewed
  const t = cur();
  if (t && !t.remoteTags) refreshRemoteTags(t);
  if (t && t.stale) reloadActive(); // refresh cached tab on first view
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
  syncChatToTab();
  void syncRepoHost(); // avatars are looked up against this repo's origin
  saveSession();
}

// ---- render everything for the active tab ----
const ABOUT_ICON =
  `<svg width="56" height="56" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">` +
  `<circle cx="470" cy="440" r="250" fill="none" stroke="#6db3ff" stroke-width="58"/>` +
  `<path d="M648 618 L 820 790" stroke="#6db3ff" stroke-width="76" stroke-linecap="round"/>` +
  `<path d="M388 330 V550" stroke="#7ee787" stroke-width="30" stroke-linecap="round"/>` +
  `<path d="M388 440 C 388 365, 560 388, 560 330" stroke="#7ee787" stroke-width="30" fill="none" stroke-linecap="round"/>` +
  `<circle cx="388" cy="330" r="44" fill="#7ee787"/><circle cx="388" cy="550" r="44" fill="#7ee787"/>` +
  `<circle cx="560" cy="330" r="44" fill="#ffcf8f"/></svg>`;

function showAbout() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    `<div class="modal about">` +
    `<div class="about-head">${ABOUT_ICON}<div><div class="about-title">jokeGITViewer</div>` +
    `<div class="muted">v${appVersion || "?"}</div></div></div>` +
    `<p class="about-desc">A fast, lightweight Git GUI for Windows, Linux &amp; macOS — visual commit graph, branches, stashes, staging &amp; commits, all in one window.</p>` +
    `<div class="about-meta">` +
    `<div>Built with Tauri 2 · Rust · TypeScript</div>` +
    `<div>Uses the local <code>git</code> CLI</div>` +
    `<div>License: MIT © jocgeo</div>` +
    `</div>` +
    `<div class="about-links">` +
    `<button data-url="https://github.com/jocgeo/jokeGITViewer">GitHub</button>` +
    `<button data-url="https://github.com/jocgeo/jokeGITViewer/releases">Releases</button>` +
    `</div>` +
    `<div class="modal-btns"><button class="modal-ok">Close</button></div>` +
    `</div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll<HTMLElement>(".about-links button").forEach((b) =>
    b.addEventListener("click", () => openUrl(b.dataset.url!).catch(() => {}))
  );
  const close = () => overlay.remove();
  overlay.querySelector(".modal-ok")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}

// a.b.c version compare — is `a` newer than `b`?
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = (b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

// release notes (markdown-ish) -> compact "what's new" block for the banner
function releaseNotesHtml(raw: string | null | undefined): string {
  const text = (raw ?? "").split(/\n-{3,}\s*\n/)[0].trim(); // drop the "---" footer
  if (!text) return "";
  const items = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (/^#{1,6}\s/.test(l))
        return `<div class="ubn-h">${escapeHtml(l.replace(/^#{1,6}\s*/, ""))}</div>`;
      if (/^[-*]\s/.test(l))
        return `<div class="ubn-li">• ${escapeHtml(l.replace(/^[-*]\s*/, ""))}</div>`;
      return `<div class="ubn-p">${escapeHtml(l)}</div>`;
    })
    .join("");
  return `<div id="ub-notes">${items}</div>`;
}

// check GitHub for a newer release; show a banner with a download link
// Try the Tauri auto-updater (in-app download + install). If it's not set up
// yet (no signing key / no latest.json), fall back to the manual banner.
async function checkForUpdate() {
  try {
    const update = await check();
    if (!update) return; // up to date
    const b = $("update-banner");
    b.innerHTML =
      `<div class="ub-row">` +
      `<span>🔔 jokeGITViewer <b>v${escapeHtml(update.version)}</b> is available — you have v${escapeHtml(appVersion)}</span>` +
      `<span class="ub-btns"><button id="ub-install">Update &amp; restart</button><button id="ub-dismiss" title="Dismiss">✕</button></span>` +
      `</div>` +
      releaseNotesHtml(update.body);
    b.classList.remove("hidden");
    $("ub-dismiss").addEventListener("click", () => b.classList.add("hidden"));
    $("ub-install").addEventListener("click", async () => {
      const btn = $("ub-install") as HTMLButtonElement;
      btn.disabled = true;
      try {
        let total = 0;
        let got = 0;
        await update.downloadAndInstall((ev) => {
          if (ev.event === "Started") total = ev.data.contentLength ?? 0;
          else if (ev.event === "Progress") {
            got += ev.data.chunkLength;
            btn.textContent = total
              ? `Downloading ${Math.round((got / total) * 100)}%`
              : "Downloading…";
          } else if (ev.event === "Finished") btn.textContent = "Restarting…";
        });
        await relaunch();
      } catch (e) {
        errorModal("Update failed:\n" + String(e));
        btn.disabled = false;
        btn.textContent = "Update & restart";
      }
    });
  } catch {
    // updater not configured / no manifest — fall back to a download link
    checkUpdateManual();
  }
}

async function checkUpdateManual() {
  try {
    const res = await fetch(
      "https://api.github.com/repos/jocgeo/jokeGITViewer/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const tag = String(data.tag_name ?? "").replace(/^v/, "");
    const url = String(data.html_url ?? "https://github.com/jocgeo/jokeGITViewer/releases");
    if (!tag || !appVersion || !isNewerVersion(tag, appVersion)) return;
    const b = $("update-banner");
    b.innerHTML =
      `<div class="ub-row">` +
      `<span>🔔 jokeGITViewer <b>v${escapeHtml(tag)}</b> is available — you have v${escapeHtml(appVersion)}</span>` +
      `<span class="ub-btns"><button id="ub-download">Download</button><button id="ub-dismiss" title="Dismiss">✕</button></span>` +
      `</div>` +
      releaseNotesHtml(String(data.body ?? ""));
    b.classList.remove("hidden");
    $("ub-download").addEventListener("click", () => openUrl(url).catch(() => {}));
    $("ub-dismiss").addEventListener("click", () => b.classList.add("hidden"));
  } catch {
    /* offline / rate-limited — ignore */
  }
}

let appVersion = "";
function updateStatusBar(t: Tab | null) {
  const right = appVersion ? `jokeGITViewer v${appVersion}` : "jokeGITViewer";
  if (!t) {
    $("sb-left").textContent = "";
    $("sb-right").textContent = right;
    return;
  }
  const r = t.repo;
  const branch = r.head_branch || "detached";
  $("sb-left").textContent =
    `${basename(r.path)} · ${branch} · ${r.head.slice(0, 8)} · ${r.commits.length} commits`;
  $("sb-right").textContent = (r.describe ? `${r.describe} · ` : "") + right;
  $("sb-right").title = "About jokeGITViewer";
}

function renderActive() {
  showDiffView(false);
  const t = cur();
  updateStatusBar(t);
  if (!t) {
    $("repo-path").textContent = "No repo open";
    setStatus("");
    $("locals").innerHTML = "";
    $("remotes").innerHTML = "";
    $("tags").innerHTML = "";
    ($("graph-svg") as unknown as SVGSVGElement).innerHTML = "";
    $("rows").innerHTML = "";
    gctx = null;
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
    $("detail").classList.remove("collapsed");
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

  // Branch lists are grouped on "/" into collapsible folders (kathi/…,
  // origin/feature/…) so long lists stay scannable, and each list is height
  // capped + scrollable instead of pushing the other sections off screen.
  const fill = (id: string, countId: string, kind: string) => {
    const ul = $(id);
    ul.innerHTML = "";
    const list = repo.refs
      .filter((r) => r.kind === kind)
      // most recently committed first; tie-break by name
      .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name));
    $(countId).textContent = String(list.length);

    const makeRefLi = (r: RefInfo, depth: number): HTMLLIElement => {
      const leaf = r.name.split("/").pop() ?? r.name;
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
      const canHide = kind === "local" || kind === "remote";
      const isHidden = canHide && (t.hidden?.has(refKey(r)) ?? false);
      if (isHidden) li.classList.add("branch-hidden");
      li.innerHTML =
        `<span class="gchev spacer"></span>` +
        `<span class="ricon">${icon(kind)}</span>` +
        `<span class="dot" style="background:${color}"></span>` +
        `<span class="rname">${escapeHtml(r.name)}</span>` +
        (r.is_head ? `<span class="here">HEAD</span>` : "") +
        (remoteOnly ? `<span class="dl" title="not checked out locally">⬇</span>` : "") +
        (canHide
          ? `<span class="eye" title="${isHidden ? "Show in graph" : "Hide from graph"}">${icon(isHidden ? "eyeoff" : "eye")}</span>`
          : "");
      li.title = r.full + (remoteOnly ? "  (not checked out locally)" : "");
      li.addEventListener("click", () => {
        if (r.target) selectNode(findById(t, r.target) ?? null, true);
      });
      li.addEventListener("dblclick", () => {
        const isRemote = r.kind === "remote";
        const target = isRemote ? r.name.split("/").slice(1).join("/") : r.name;
        doCheckoutConfirm(t, target, isRemote ? r.name : undefined);
      });
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, branchMenu(r, repo));
      });
      li.querySelector(".eye")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleBranchHidden(t, refKey(r));
      });

      // drag & drop: local AND remote branches can be dragged as the merge
      // source; only local branches accept drops (you can't commit a merge
      // into a remote-tracking ref)
      if (kind === "local" || kind === "remote") {
        li.draggable = true;
        li.addEventListener("dragstart", (e) => {
          dragSource = r.name;
          dragSourceRemote = kind === "remote";
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", r.name);
          }
          li.classList.add("dragging");
        });
      }
      if (kind === "local") {
        const over = (e: DragEvent) => {
          if (dragSource && dragSource !== r.name) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
            li.classList.add("drop-target");
          }
        };
        li.addEventListener("dragenter", over);
        li.addEventListener("dragover", over);
        li.addEventListener("dragleave", () => li.classList.remove("drop-target"));
        li.addEventListener("drop", (e) => {
          e.preventDefault();
          li.classList.remove("drop-target");
          const source = dragSource;
          const target = r.name;
          if (!source || source === target) return;
          showBranchDropMenu(e.clientX, e.clientY, source, target, repo.path);
        });
      }
      li.style.paddingLeft = `${6 + depth * 14}px`;
      // the folder already shows the prefix — only the last segment here
      const nameEl = li.querySelector(".rname");
      if (nameEl) nameEl.textContent = leaf;
      return li;
    };

    // group refs into a folder tree by "/" (leaf = the final segment)
    interface RefGroup {
      name: string;
      path: string;
      refs: RefInfo[];
      subs: Map<string, RefGroup>;
    }
    const root: RefGroup = { name: "", path: "", refs: [], subs: new Map() };
    for (const r of list) {
      const parts = r.name.split("/");
      let node = root;
      for (const seg of parts.slice(0, -1)) {
        const path = node.path ? `${node.path}/${seg}` : seg;
        let next = node.subs.get(seg);
        if (!next) {
          next = { name: seg, path, refs: [], subs: new Map() };
          node.subs.set(seg, next);
        }
        node = next;
      }
      node.refs.push(r);
    }

    // total refs under a folder, including nested ones
    const countRefs = (g: { refs: RefInfo[]; subs: Map<string, unknown> }): number => {
      let n = g.refs.length;
      for (const sub of g.subs.values())
        n += countRefs(sub as { refs: RefInfo[]; subs: Map<string, unknown> });
      return n;
    };

    const collapsed = getCollapsedGroups();
    const walk = (node: RefGroup, depth: number) => {
      for (const g of node.subs.values()) {
        const key = `${kind}:${g.path}`;
        const isShut = collapsed.has(key);
        const gli = document.createElement("li");
        gli.className = "rgroup" + (isShut ? " shut" : "");
        gli.style.paddingLeft = `${6 + depth * 14}px`;
        gli.innerHTML =
          `<span class="gchev">${isShut ? "▸" : "▾"}</span>` +
          `<span class="ricon">${icon("folder")}</span>` +
          `<span class="rname">${escapeHtml(g.name)}</span>` +
          `<span class="gcount">${countRefs(g)}</span>`;
        gli.title = g.path;
        gli.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleCollapsedGroup(key);
          renderSidebar(t);
        });
        ul.appendChild(gli);
        if (!isShut) walk(g, depth + 1);
      }
      for (const r of node.refs) ul.appendChild(makeRefLi(r, depth));
    };
    walk(root, 0);

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

  // submodules — click to open as their own repo tab
  const subUl = $("submodules-list");
  subUl.innerHTML = "";
  $("count-submodule").textContent = String(repo.submodules.length);
  repo.submodules.forEach((sm) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="ricon">${icon("submodule")}</span>` +
      `<span class="rname">${escapeHtml(sm.name)}</span>`;
    li.title = `${sm.path}\nOpen as repository`;
    li.addEventListener("click", () => loadRepo(sm.abs, false, repo.path));
    subUl.appendChild(li);
  });
  if (!subUl.children.length) {
    subUl.innerHTML = `<li class="muted empty-mini">none</li>`;
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

let gRemoteTags = new Set<string>(); // tags on origin, for the active render
let dragSource: string | null = null; // branch being dragged (drag & drop)
let dragSourceRemote = false; // dragged branch is a remote-tracking ref

function unitBadge(u: RefUnit): string {
  let icons =
    (u.local ? icon("local") : "") +
    (u.remote ? icon("remote") : "") +
    (u.tag ? icon("tag") : "");
  let extra = "";
  if (u.tag) {
    if (gRemoteTags.has(u.name)) {
      icons += icon("remote"); // also on remote
    } else {
      extra = `<span class="tagpush" title="local only — not pushed to origin">↑</span>`;
    }
  }
  const cls = u.tag ? "tag" : u.remote && !u.local ? "remote" : "local";
  const check = u.isHead ? `<span class="bcheck">✓</span>` : "";
  return (
    `<span class="badge ${cls}${u.isHead ? " current" : ""}" ` +
    `data-refname="${escapeHtml(u.ref.name)}" data-refkind="${u.ref.kind}">` +
    `${check}${icons}${escapeHtml(u.name)}${extra}</span>`
  );
}

// fetch the set of tags on origin (network), then re-render to mark badges
async function refreshRemoteTags(t: Tab) {
  try {
    const tags = await invoke<string[]>("remote_tags", { path: t.repo.path });
    t.remoteTags = new Set(tags);
    if (cur() === t) {
      gRemoteTags = t.remoteTags;
      renderGraph(t);
    }
  } catch {
    /* offline / no origin — leave tags as local-only */
  }
}

// branches: primary (current if present, else first) + "+N" pill.
// tags: always shown as their own badges so they're easy to spot.
function buildRefColumn(refsHere: RefInfo[]): string {
  const units = refUnits(refsHere);
  if (!units.length) return "";
  const branches = units.filter((u) => !u.tag);
  const tags = units.filter((u) => u.tag);

  let html = "";
  if (branches.length) {
    let pi = branches.findIndex((u) => u.isHead);
    if (pi < 0) pi = 0;
    html += unitBadge(branches[pi]);
    const others = branches.filter((_, i) => i !== pi);
    if (others.length) {
      const title = others.map((u) => u.name).join("\n");
      html += `<span class="refplus" title="${escapeHtml(title)}">+${others.length}</span>`;
    }
  }
  // all tags, always visible (rendered last = nearest the graph)
  html += tags.map(unitBadge).join("");
  return html;
}

// ---- column visibility (gear in the graph header) ----
// Toggling only flips classes on #graphpane; CSS hides the pieces, so nothing
// needs re-rendering and the change is instant even on huge repos.
const COLUMNS: { key: string; label: string }[] = [
  { key: "refs", label: "Branch / Tag" },
  { key: "graph", label: "Graph" },
  { key: "message", label: "Commit message" },
  { key: "author", label: "Author" },
  { key: "date", label: "Date / Time" },
  { key: "sha", label: "Sha" },
];
const LS_COLUMNS = "jkt.columns";
const DEFAULT_COLUMNS = COLUMNS.map((c) => c.key); // everything on by default

function getColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_COLUMNS);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set(DEFAULT_COLUMNS);
}
function setColumns(cols: Set<string>) {
  try {
    localStorage.setItem(LS_COLUMNS, JSON.stringify([...cols]));
  } catch {}
  applyColumns();
}
function applyColumns() {
  const on = getColumns();
  const pane = $("graphpane");
  for (const c of COLUMNS) pane.classList.toggle(`hide-${c.key}`, !on.has(c.key));
  // the graph is a sized column, so its width has to be recomputed
  const t = cur();
  if (t) renderGraph(t);
}

function showColumnMenu(x: number, y: number) {
  const on = getColumns();
  const items: MenuItem[] = COLUMNS.map((c) => ({
    label: c.label,
    checked: on.has(c.key),
    keepOpen: true, // flip several without the menu closing
    action: () => {
      const cur = getColumns();
      if (cur.has(c.key)) cur.delete(c.key);
      else cur.add(c.key);
      setColumns(cur);
      showColumnMenu(x, y); // redraw so the ticks update in place
    },
  }));
  items.push({ separator: true });
  items.push({
    label: "Compact graph column",
    checked: compactGraph,
    keepOpen: true,
    action: () => {
      setCompactGraph(!compactGraph);
      showColumnMenu(x, y);
    },
  });
  items.push({ separator: true });
  items.push({
    label: "Reset columns to default",
    action: () => {
      setColumns(new Set(DEFAULT_COLUMNS));
      setCompactGraph(false);
    },
  });
  showMenu(x, y, items);
}

// narrower graph column for people who want the messages to dominate
const LS_COMPACT = "jkt.compactgraph";
let compactGraph = localStorage.getItem(LS_COMPACT) === "1";
function setCompactGraph(on: boolean) {
  compactGraph = on;
  try {
    localStorage.setItem(LS_COMPACT, on ? "1" : "0");
  } catch {}
  const t = cur();
  if (t) renderGraph(t);
}

// ---- virtualized graph rendering ----
interface GCtx {
  tab: Tab;
  placed: Placed[];
  byId: Map<string, Placed>;
  refsByHash: Map<string, RefInfo[]>;
  graphViewW: number; // visible width of the graph column
  graphFullW: number; // width all lanes would need
  headChain: Set<string>;   // the checked-out branch (first-parent from HEAD)
  forks: Set<string>;       // commits a branch diverges FROM (>=2 children)
  localReach: Set<string>;  // reachable from some LOCAL branch or HEAD
}
let gctx: GCtx | null = null;
let paintQueued = false;

// ---- graph column: its own horizontal scroll ----
// Only the lanes move; the commit messages stay put. Driven by the SVG viewBox
// (see renderGraph) plus a slim scrollbar in the "Graph" column header.
function graphPanMax(): number {
  return gctx ? Math.max(0, gctx.graphFullW - gctx.graphViewW) : 0;
}

function setGraphPan(x: number) {
  const max = graphPanMax();
  const next = Math.max(0, Math.min(x, max));
  if (next === graphPanX) return;
  graphPanX = next;
  if (gctx) {
    const svg = $("graph-svg") as unknown as SVGSVGElement;
    svg.setAttribute(
      "viewBox",
      `${graphPanX} 0 ${gctx.graphViewW} ${gctx.placed.length * ROW_H}`
    );
  }
  updateGraphHBar();
}

// slim scrollbar under the "Graph" header — hidden when everything fits
function updateGraphHBar() {
  const bar = document.getElementById("graph-hbar");
  const thumb = document.getElementById("graph-hthumb");
  if (!bar || !thumb || !gctx) return;
  const max = graphPanMax();
  bar.classList.toggle("hidden", max <= 0);
  if (max <= 0) return;
  const ratio = gctx.graphViewW / gctx.graphFullW;
  thumb.style.width = `${Math.max(12, ratio * 100)}%`;
  thumb.style.left = `${(graphPanX / gctx.graphFullW) * 100}%`;
}

function setupGraphPan() {
  // horizontal wheel (or shift+wheel) while over the graph column
  $("scroll").addEventListener(
    "wheel",
    (e) => {
      if (!gctx || graphPanMax() <= 0) return;
      const rect = $("scroll").getBoundingClientRect();
      const overGraph = e.clientX - rect.left + $("scroll").scrollLeft < gctx.graphViewW;
      if (!overGraph) return;
      const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (dx === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setGraphPan(graphPanX + dx);
    },
    { passive: false }
  );

  // drag the scrollbar thumb
  const bar = document.getElementById("graph-hbar");
  bar?.addEventListener("mousedown", (e) => {
    if (!gctx) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = bar.getBoundingClientRect();
    const jump = (clientX: number) => {
      const frac = (clientX - rect.left) / Math.max(1, rect.width);
      // centre the thumb on the cursor
      setGraphPan(frac * gctx!.graphFullW - gctx!.graphViewW / 2);
    };
    jump(e.clientX);
    const move = (ev: MouseEvent) => jump(ev.clientX);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

function schedulePaint() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    paintViewport();
  });
}

function renderGraph(t: Tab) {
  const repo = t.repo;
  gRemoteTags = t.remoteTags ?? new Set();
  const built = layout(t.nodes);
  t.placed = built.placed;
  const { placed, maxLane } = built;

  const byId = new Map<string, Placed>();
  placed.forEach((p) => byId.set(p.node.id, p));

  const refsByHash = new Map<string, RefInfo[]>();
  for (const r of repo.refs) {
    const arr = refsByHash.get(r.target) ?? [];
    arr.push(r);
    refsByHash.set(r.target, arr);
  }

  // ---- scannability sets (independent of what is selected) ----
  // the checked-out branch: first-parent chain down from HEAD
  const headChain = new Set<string>();
  {
    let h: string | undefined = repo.head;
    while (h && byId.has(h) && !headChain.has(h)) {
      headChain.add(h);
      h = byId.get(h)!.node.parents[0];
    }
  }
  // fork points: a commit several branches grow out of (>= 2 children here)
  const childCount = new Map<string, number>();
  for (const p of placed)
    for (const par of p.node.parents)
      if (byId.has(par)) childCount.set(par, (childCount.get(par) ?? 0) + 1);
  const forks = new Set<string>();
  for (const [h, n] of childCount) if (n > 1) forks.add(h);
  // everything reachable from a LOCAL branch (or HEAD). Commits outside this
  // exist only on remote branches — work that is in no local branch of yours.
  const localReach = new Set<string>();
  {
    const stack = [
      ...repo.refs.filter((r) => r.kind === "local").map((r) => r.target),
      repo.head,
    ].filter((h) => h && byId.has(h));
    while (stack.length) {
      const h = stack.pop()!;
      if (localReach.has(h)) continue;
      localReach.add(h);
      for (const par of byId.get(h)!.node.parents) if (byId.has(par)) stack.push(par);
    }
  }

  // Width: sizing to the deepest lane in the WHOLE repo leaves a big empty gap
  // between the dots and the messages. Size to the 97th percentile instead —
  // the rare deep lanes are still reachable via the sideways scroll.
  const laneSorted = placed.map((p) => p.lane).sort((a, b) => a - b);
  const pct = laneSorted.length
    ? laneSorted[Math.min(laneSorted.length - 1, Math.floor(laneSorted.length * 0.97))]
    : 0;
  const shownLane = Math.max(2, Math.min(maxLane, pct + 1));
  const graphFullW = laneX(maxLane) + PAD;
  const graphViewW = Math.min(
    laneX(shownLane) + PAD,
    compactGraph ? 140 : GRAPH_VIEW_MAX
  );
  const totalH = placed.length * ROW_H;
  graphPanX = Math.max(0, Math.min(graphPanX, graphFullW - graphViewW));

  const svg = $("graph-svg") as unknown as SVGSVGElement;
  svg.setAttribute("width", String(graphViewW));
  svg.setAttribute("height", String(totalH));
  // viewBox pans the lanes horizontally and clips them to the column — no
  // extra scroll container, so nothing can drift out of sync with the rows
  svg.setAttribute("viewBox", `${graphPanX} 0 ${graphViewW} ${totalH}`);
  svg.style.left = "0px"; // graph is the leftmost column
  (document.querySelector(".ch-graph") as HTMLElement).style.width = `${graphViewW}px`;
  $("rows").style.height = `${totalH}px`;

  // min content width so the message column isn't cut off on narrow windows
  // (horizontal scroll kicks in instead of truncating)
  const MSG_MIN = 420;
  const contentW = graphViewW + MSG_MIN;
  $("graph-content").style.minWidth = `${contentW}px`;
  $("col-headers").style.minWidth = `${contentW}px`;

  gctx = { tab: t, placed, byId, refsByHash, graphViewW, graphFullW, headChain, forks, localReach };
  updateGraphHBar();
  $("empty").classList.add("hidden");
  paintViewport();
}

// render only the rows/nodes/edges visible in the scroll viewport
function paintViewport() {
  if (!gctx) return;
  const { tab: t, placed, byId, refsByHash, graphViewW, headChain, forks, localReach } = gctx;
  const repo = t.repo;

  // lineage: highlight the whole branch line — ancestors AND descendants
  // (so you can see where this commit's branch head is), dim the rest.
  // TWO highlight levels only, so "is this commit part of the selected
  // history or not" is unambiguous:
  //   in  = the selected commit's full history — every ancestor that led to it
  //         plus every descendant it contributes to (through merges included)
  //   out = nothing to do with it -> clearly dimmed
  let inHistory: Set<string> | null = null;
  if (t.selected && !t.hlOff && byId.has(t.selected)) {
    inHistory = new Set<string>();
    // children by ANY parent, so merged-in work counts as contributing
    const childAll = new Map<string, string[]>();
    for (const p of placed) {
      for (const par of p.node.parents) {
        if (!byId.has(par)) continue;
        (childAll.get(par) ?? childAll.set(par, []).get(par)!).push(p.node.id);
      }
    }
    const up = [t.selected]; // everything this commit is built on
    while (up.length) {
      const id = up.pop()!;
      if (inHistory.has(id)) continue;
      inHistory.add(id);
      for (const par of byId.get(id)?.node.parents ?? [])
        if (byId.has(par)) up.push(par);
    }
    const down = [t.selected]; // everywhere it ended up
    const seen = new Set<string>();
    while (down.length) {
      const id = down.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      inHistory.add(id);
      for (const ch of childAll.get(id) ?? []) down.push(ch);
    }
  }
  const levelOf = (id: string): number => {
    // file-history highlight overrides: only file-changing commits are bright
    if (fileHistoryHL) return fileHistoryHL.has(id) ? 2 : 0;
    return inHistory === null || inHistory.has(id) ? 2 : 0;
  };
  // In-history edges are strong; unrelated ones nearly disappear.
  const edgeOp = (a: string, b: string) => {
    const l = Math.min(levelOf(a), levelOf(b));
    return l === 2 ? ` opacity="0.75"` : ` opacity="0.08"`;
  };
  const nodeOp = (id: string) => {
    return levelOf(id) === 2 ? "" : ` opacity="0.14"`;
  };

  const scroll = $("scroll");
  const top = scroll.scrollTop;
  const vh = scroll.clientHeight || 600;
  const BUF = 12;
  const start = Math.max(0, Math.floor(top / ROW_H) - BUF);
  const end = Math.min(placed.length, Math.ceil((top + vh) / ROW_H) + BUF);

  // --- SVG: edges (only those intersecting the viewport) + visible nodes ---
  // occupancy grid: a cross-lane edge must not run vertically through rows
  // where OTHER commits sit on that lane — pick the clear corridor instead
  const occ = new Set<number>();
  const OCC_W = 4096; // lanes per row slot (way above any real lane count)
  let occMaxLane = 0;
  for (const q of placed) {
    occ.add(q.row * OCC_W + q.lane);
    if (q.lane > occMaxLane) occMaxLane = q.lane;
  }
  const corridorClear = (lane: number, r1: number, r2: number): boolean => {
    for (let r = r1 + 1; r < r2; r++) if (occ.has(r * OCC_W + lane)) return false;
    return true;
  };
  // nearest lane whose rows r1..r2 are COMPLETELY free (for edge detours);
  // one lane right of the graph is always free, so this always succeeds
  const findFreeLane = (r1: number, r2: number, prefer: number): number => {
    let best = occMaxLane + 1;
    let bestDist = Math.abs(best - prefer);
    for (let l = 0; l <= occMaxLane; l++) {
      if (!corridorClear(l, r1 - 1, r2 + 1)) continue;
      const dist = Math.abs(l - prefer);
      if (dist < bestDist) {
        best = l;
        bestDist = dist;
      }
    }
    return best;
  };

  const parts: string[] = [];
  for (const p of placed) {
    for (const ph of p.node.parents) {
      const pp = byId.get(ph);
      if (!pp) continue;
      const a = Math.min(p.row, pp.row);
      const b = Math.max(p.row, pp.row);
      if (b < start || a > end) continue; // segment off-screen
      const cx = laneX(p.lane), cy = rowY(p.row);
      const px = laneX(pp.lane), py = rowY(pp.row);
      // straight in-lane; orthogonal (90° rounded corner) across lanes so
      // branches/merges read clearly. Parent is below (py > cy).
      let d: string;
      if (px === cx) {
        d = `M ${cx} ${cy} L ${px} ${py}`;
      } else {
        const r = Math.min(8, Math.abs(px - cx) / 2, Math.abs(py - cy) / 2);
        const dir = px > cx ? 1 : -1;
        const isMergeEdge = p.node.parents.length > 1 && ph !== p.node.parents[0];
        // vertical corridor options: the parent's lane (corner at the child
        // row), the child's lane (corner at the parent row), or — when both
        // run through foreign commits — a detour via a completely free lane.
        const parentClear = corridorClear(pp.lane, p.row, pp.row);
        const childClear = corridorClear(p.lane, p.row, pp.row);
        if (!parentClear && !childClear) {
          // Z-shape: across at the child row, down the free lane, across
          // into the parent — guaranteed not to cross any commit vertically
          const fl = findFreeLane(p.row, pp.row, pp.lane);
          const fx = laneX(fl);
          const r2 = Math.min(8, Math.abs(fx - cx) / 2, Math.abs(px - fx) / 2, Math.abs(py - cy) / 2);
          const d1 = fx > cx ? 1 : -1;
          const d2 = px > fx ? 1 : -1;
          d =
            `M ${cx} ${cy} L ${fx - d1 * r2} ${cy} Q ${fx} ${cy} ${fx} ${cy + r2} ` +
            `L ${fx} ${py - r2} Q ${fx} ${py} ${fx + d2 * r2} ${py} L ${px} ${py}`;
        } else {
          const useParentLane = isMergeEdge
            ? parentClear // merges prefer the parent's lane
            : parentClear && !childClear; // forks prefer the child's lane
          if (useParentLane) {
            // corner at the child's row, straight down the parent's lane
            d = `M ${cx} ${cy} L ${px - dir * r} ${cy} Q ${px} ${cy} ${px} ${cy + r} L ${px} ${py}`;
          } else {
            // down the child's lane, corner at the parent's row
            d = `M ${cx} ${cy} L ${cx} ${py - r} Q ${cx} ${py} ${cx + dir * r} ${py} L ${px} ${py}`;
          }
        }
      }
      const dash = p.node.kind !== "commit" ? ` stroke-dasharray="3 3"` : "";
      // the current branch is the spine of the graph: thicker and unfaded
      // the current branch stays thicker, but dimming still wins so the
      // selected history is the only thing that reads as "on"
      const onHead = headChain.has(p.node.id) && headChain.has(ph);
      const op = edgeOp(p.node.id, ph);
      const w = onHead ? 3 : 2;
      parts.push(`<path d="${d}" fill="none" stroke="${pp.color}" stroke-width="${w}"${dash}${op}/>`);
    }
  }
  for (let i = start; i < end; i++) {
    const p = placed[i];
    const x = laneX(p.lane), y = rowY(p.row);
    const op = nodeOp(p.node.id);
    if (p.node.kind === "stash") {
      const sz = NODE_R * 2.2;
      parts.push(`<rect x="${x - sz / 2}" y="${y - sz / 2}" width="${sz}" height="${sz}" rx="2" fill="#1e1e2a" stroke="${STASH_COLOR}" stroke-width="1.5" stroke-dasharray="2 2"${op}/>`);
    } else if (p.node.kind === "wip") {
      parts.push(`<circle cx="${x}" cy="${y}" r="${NODE_R}" fill="#1e1e2a" stroke="${WIP_COLOR}" stroke-width="2" stroke-dasharray="2 2"${op}/>`);
    } else {
      const c = p.node.commit!;
      // A branch/tag TIP gets a labelled badge instead of a plain dot — a
      // monitor for a local branch, a cloud for a remote-only one, a tag
      // glyph for tags. Ordinary commits stay small dots so the tips pop.
      const refsHere = refsByHash.get(c.hash) ?? [];
      const tip = tipGlyph(refsHere);
      const isMerge = c.parents.length > 1;
      const isHead = c.hash === repo.head;
      if (isHead) {
        const stroke = repo.head_branch ? "#ffffff" : "#ff8f8f";
        const r = tip ? TIP_SZ / 2 + 3 : NODE_R + Math.max(2, NODE_R * 0.6);
        parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1.5"${op}/>`);
      }
      const isFork = forks.has(c.hash); // a branch diverges here
      const remoteOnly = !localReach.has(c.hash); // in no local branch
      const who = `${c.author} <${c.email}>`;
      const title = `<title>${escapeHtml(
        (tip ? `${refsHere.map((r) => r.name).join(", ")} — ` : "") +
          who +
          (isFork ? "  ·  branch point" : "") +
          (remoteOnly ? "  ·  not in any local branch" : "")
      )}</title>`;
      // fork point: outer ring showing this is where branches split off
      if (isFork) {
        parts.push(
          `<circle cx="${x}" cy="${y}" r="${NODE_R + 3.5}" fill="none" ` +
            `stroke="${p.color}" stroke-width="1.2" opacity="0.65"${op}/>`
        );
      }
      if (tip) {
        const half = TIP_SZ / 2;
        const gs = (TIP_SZ / 16) * 0.72; // glyph scale inside the badge
        const gp = (TIP_SZ - 16 * gs) / 2; // centre it
        parts.push(
          `<g${op}>` +
            `<rect x="${x - half}" y="${y - half}" width="${TIP_SZ}" height="${TIP_SZ}" rx="4" ` +
            `fill="${p.color}" stroke="#141420" stroke-width="1.5"/>` +
            `<g transform="translate(${x - half + gp} ${y - half + gp}) scale(${gs})" ` +
            `fill="none" stroke="#141420" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
            `${ICONS[tip] ?? ""}</g>${title}</g>`
        );
      } else {
        const fill = isMerge || remoteOnly ? "#1e1e2a" : p.color;
        const dashed = remoteOnly ? ` stroke-dasharray="2.2 2"` : "";
        parts.push(
          `<circle cx="${x}" cy="${y}" r="${NODE_R}" fill="${fill}" stroke="${p.color}" stroke-width="2"${dashed}${op}>` +
            title +
            `</circle>`
        );
      }
    }
  }
  ($("graph-svg") as unknown as SVGSVGElement).innerHTML = parts.join("");

  // --- rows (only visible, absolutely positioned) ---
  const rows = $("rows");
  rows.innerHTML = "";
  for (let i = start; i < end; i++) {
    const p = placed[i];
    const n = p.node;
    const row = document.createElement("div");
    row.className = "crow";
    row.dataset.id = n.id;
    row.style.top = `${p.row * ROW_H}px`;
    // faint wash of the branch's colour so each lane is readable across the
    // whole row, not just at the dot — stronger on the checked-out branch
    const onHeadRow = headChain.has(n.id);
    row.style.setProperty("--lane-bg", laneTint(p.color, onHeadRow ? 0.2 : 0.08));
    if (onHeadRow) row.classList.add("on-head");
    if (n.kind === "commit" && !localReach.has(n.id)) row.classList.add("remote-only");
    if (n.id === t.selected) row.classList.add("selected");
    if (levelOf(n.id) === 0) row.classList.add("dim");

    let refHtml = "";
    let msgHtml = "";
    if (n.kind === "wip") {
      const w = n.wip!;
      const ps: string[] = [];
      if (w.staged) ps.push(`${w.staged} staged`);
      if (w.unstaged) ps.push(`${w.unstaged} unstaged`);
      if (w.untracked) ps.push(`${w.untracked} untracked`);
      msgHtml =
        `<span class="badge wip">WIP</span>` +
        `<span class="summary">Uncommitted changes — ${ps.join(", ")}</span>`;
    } else if (n.kind === "stash") {
      const s = n.stash!;
      msgHtml =
        `<span class="badge stash">${icon("stash")}${escapeHtml(s.selector)}</span>` +
        `<span class="summary">${escapeHtml(s.message)}</span>` +
        `<span class="date">${fmtDate(s.time)}</span>` +
        `<span class="hash">${s.hash.slice(0, 8)}</span>`;
    } else {
      const c = n.commit!;
      const here = refsByHash.get(c.hash) ?? [];
      refHtml =
        (c.hash === repo.head && !repo.head_branch
          ? `<span class="badge detached">HEAD · detached</span>`
          : "") + buildRefColumn(here);
      if (
        t.hint &&
        t.hint.hash === c.hash &&
        !here.some((r) => r.name === t.hint!.branch)
      ) {
        refHtml += `<span class="badge local ghost">${icon("local")}${escapeHtml(t.hint.branch)}</span>`;
      }
      msgHtml =
        `<span class="summary">${escapeHtml(c.summary)}</span>` +
        fileHistNumBadge(c.hash) +
        // avatar sits with the author name (not on the graph node) so the
        // lanes stay clean and the identicon is where it's actually read
        `<span class="author" title="${escapeHtml(`${c.author} <${c.email}>`)}">` +
        `<img class="av" src="${avatarFor(c.email, c.author)}" alt="" onerror="this.onerror=null;this.src='${avatarUrl(c.email || c.author)}'"/>` +
        `${escapeHtml(c.author)}</span>` +
        `<span class="date">${fmtDate(c.time)}</span>` +
        `<span class="hash">${c.hash.slice(0, 8)}</span>`;
    }
    // graph first (the eye lands on the structure), then the message with its
    // ref pills inline — label sits directly against what it labels
    row.innerHTML =
      `<div class="col-graph" style="width:${graphViewW}px"></div>` +
      `<div class="col-msg">` +
      (refHtml ? `<span class="refs">${refHtml}</span>` : "") +
      msgHtml +
      `</div>`;
    attachRowEvents(row, n, repo, refsByHash);
    rows.appendChild(row);
  }
}

function attachRowEvents(
  row: HTMLElement,
  n: GNode,
  repo: RepoData,
  refsByHash: Map<string, RefInfo[]>
) {
  row.addEventListener("click", () => {
    // file-history split: clicking a graph commit keeps the file view open
    // and syncs to the commit list instead of collapsing to the detail panel
    if (histSplit && n.kind === "commit") {
      const idx = histEntries.findIndex((h) => h.hash === n.id);
      if (idx >= 0) {
        openHistEntry(idx); // in the file's history -> full sync (list + diff)
      } else {
        // not a file-touching commit: still show it, keep the split
        const t = cur();
        if (!t) return;
        t.selected = n.id;
        $("hist-list").querySelectorAll("li.selected").forEach((x) => x.classList.remove("selected"));
        histIdx = -1;
        openDiff(
          `${basename(histFile)} @ ${n.id.slice(0, 8)} — (file unchanged here)`,
          t.repo.path,
          histFile,
          n.id,
          true
        );
        paintViewport();
      }
      return;
    }
    selectNode(n);
  });

  // drag & drop on the graph's branch badges -> merge / rebase
  row.querySelectorAll<HTMLElement>(".col-msg .badge[data-refname]").forEach((b) => {
    const name = b.dataset.refname!;
    const isLocal = b.dataset.refkind === "local";
    // double-click a branch/tag badge -> checkout
    b.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const t = cur();
      if (!t) return;
      const isRemote = b.dataset.refkind === "remote";
      const target = isRemote ? name.split("/").slice(1).join("/") : name;
      doCheckoutConfirm(t, target, isRemote ? name : undefined);
    });
    if (isLocal || b.dataset.refkind === "remote") {
      b.draggable = true;
      b.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        dragSource = name;
        dragSourceRemote = b.dataset.refkind === "remote";
        const dt = (e as DragEvent).dataTransfer;
        if (dt) {
          dt.effectAllowed = "move";
          dt.setData("text/plain", name);
        }
      });
    }
    const over = (e: Event) => {
      if (isLocal && dragSource && dragSource !== name) {
        e.preventDefault();
        const dt = (e as DragEvent).dataTransfer;
        if (dt) dt.dropEffect = "move";
        b.classList.add("drop-target");
      }
    };
    b.addEventListener("dragenter", over);
    b.addEventListener("dragover", over);
    b.addEventListener("dragleave", () => b.classList.remove("drop-target"));
    b.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.remove("drop-target");
      if (isLocal && dragSource && dragSource !== name) {
        const me = e as DragEvent;
        showBranchDropMenu(me.clientX, me.clientY, dragSource, name, repo.path);
      }
    });
  });
  if (n.kind === "commit") {
    const hash = n.commit!.hash;
    const refsHere = refsByHash.get(hash) ?? [];
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const badge = (e.target as HTMLElement).closest(
        ".badge[data-refname]"
      ) as HTMLElement | null;
      if (badge) {
        const ref = repo.refs.find(
          (x) => x.name === badge.dataset.refname && x.kind === badge.dataset.refkind
        );
        if (ref) {
          showMenu(e.clientX, e.clientY, branchMenu(ref, repo));
          return;
        }
      }
      selectNode(n);
      showMenu(e.clientX, e.clientY, commitMenu(hash, refsHere, repo));
    });
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
            const target = isRemote ? r.name.split("/").slice(1).join("/") : r.name;
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

// which local branch contains `hash`, computed from loaded commits (prefer current)
function branchForCommit(t: Tab, hash: string): string | null {
  const repo = t.repo;
  const byHash = new Map(repo.commits.map((c) => [c.hash, c]));
  const reaches = (tip: string): boolean => {
    const seen = new Set<string>();
    const stack = [tip];
    while (stack.length) {
      const h = stack.pop()!;
      if (h === hash) return true;
      if (seen.has(h)) continue;
      seen.add(h);
      const c = byHash.get(h);
      if (c) for (const p of c.parents) stack.push(p);
    }
    return false;
  };
  const locals = repo.refs.filter((r) => r.kind === "local");
  const ordered = [
    ...locals.filter((r) => r.name === repo.head_branch),
    ...locals.filter((r) => r.name !== repo.head_branch),
  ];
  for (const r of ordered) if (reaches(r.target)) return r.name;
  return null;
}

// faintly show which branch the selected commit belongs to, on its ref row
function showBranchHint(t: Tab, hash: string) {
  const branch = branchForCommit(t, hash);
  if (!branch || t.selected !== hash) return;
  t.hint = { hash, branch };
  if (cur() === t) paintViewport(); // persists across auto-refresh re-renders
}

async function selectNode(n: GNode | null, scroll = false) {
  const t = cur();
  if (!t || !n) return;
  t.selected = n.id;
  t.hlOff = false; // clicking a commit re-enables the lineage highlight
  showDiffView(false); // return main area to the graph

  // scroll the selected row into view (virtualized -> set scrollTop directly)
  if (scroll && gctx && gctx.tab === t) {
    const p = gctx.byId.get(n.id);
    const scrollEl = $("scroll");
    if (p) {
      const target = p.row * ROW_H - scrollEl.clientHeight / 2;
      scrollEl.scrollTop = Math.max(0, target);
    }
  }
  // clear previous "which branch" hint, then compute a fresh one
  t.hint = undefined;
  paintViewport();
  if (n.kind === "commit") showBranchHint(t, n.commit!.hash);

  $("detail").classList.remove("collapsed"); // reopen panel on selection
  $("detail-empty").classList.add("hidden");
  $("commit-panel").classList.toggle("hidden", n.kind !== "wip");
  $("detail-body").classList.toggle("hidden", n.kind === "wip");
  bodyReqHash = ""; // drop any in-flight body fetch from the previous selection
  $("d-body").classList.add("hidden");

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
  showCommitBody(t.repo.path, c.hash);
  // author gets a proper row with their avatar (GitLab where available,
  // identicon otherwise) instead of being one more line of grey text
  const avaFallback = avatarUrl(c.email || c.author);
  $("d-meta").innerHTML =
    `<div class="d-author">` +
    `<img class="d-av" src="${avatarFor(c.email, c.author)}" alt="" ` +
    `onerror="this.onerror=null;this.src='${avaFallback}'"/>` +
    `<span class="d-au-txt"><span class="d-au-name">${escapeHtml(c.author)}</span>` +
    `<span class="d-au-mail">${escapeHtml(c.email)}</span></span></div>` +
    `<div>${new Date(c.time * 1000).toLocaleString()}</div>` +
    `<div><code>${c.hash}</code></div>` +
    (c.parents.length
      ? `<div>parents: ${c.parents
          .map((p) => `<code>${p.slice(0, 8)}</code>`)
          .join(", ")}</div>`
      : `<div>(root commit)</div>`);
  await loadFiles(t.repo.path, c.hash);
}

// full commit message body under the subject line (empty for most commits).
// Loaded on demand; the hash guard drops results for a commit you already
// clicked away from.
let bodyReqHash = "";
async function showCommitBody(path: string, hash: string) {
  const el = $("d-body");
  bodyReqHash = hash;
  el.classList.add("hidden");
  el.textContent = "";
  try {
    const body = await invoke<string>("commit_body", { path, hash });
    if (bodyReqHash !== hash) return; // a newer selection won
    if (!body.trim()) return;
    el.textContent = body;
    el.classList.remove("hidden");
  } catch {
    /* no body / unreadable — just leave it hidden */
  }
}

// hash === null means WIP (working tree)
let filesTreeMode = false;
let filesAllMode = false; // show whole project tree
let lastFiles: { files: FileChange[]; path: string; hash: string | null } | null = null;
interface TNode { name: string; path: string; dir: boolean; children: TNode[]; }
let projectCache: {
  hash: string | null;
  root: TNode;
  num: Map<string, { a: number; d: number }>;
  expanded: Set<string>;
} | null = null;

function buildTree(paths: string[]): TNode {
  const root: TNode = { name: "", path: "", dir: true, children: [] };
  for (const fp of paths) {
    const parts = fp.split("/");
    let node = root;
    let acc = "";
    parts.forEach((part, i) => {
      acc = acc ? acc + "/" + part : part;
      const isFile = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part && c.dir === !isFile);
      if (!child) {
        child = { name: part, path: acc, dir: !isFile, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sortRec = (n: TNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

let lastNum: Map<string, { a: number; d: number }> = new Map();

async function loadFiles(path: string, hash: string | null) {
  const filesUl = $("d-files");
  filesUl.innerHTML = "<li class='muted'>loading…</li>";
  try {
    const [files, num] = await Promise.all([
      hash
        ? invoke<FileChange[]>("commit_files", { path, hash })
        : invoke<FileChange[]>("wip_files", { path }),
      invoke<{ path: string; added: number; deleted: number }[]>("commit_numstat", {
        path,
        hash: hash ?? "",
      }).catch(() => []),
    ]);
    lastNum = new Map(num.map((n) => [n.path, { a: n.added, d: n.deleted }]));
    lastFiles = { files, path, hash };
    renderFileList();
  } catch (e) {
    filesUl.innerHTML = `<li class='muted'>${escapeHtml(String(e))}</li>`;
  }
}

function numBadge(file: string): string {
  const ns = lastNum.get(file);
  if (!ns) return "";
  const add = ns.a < 0 ? "" : `<span class="ns-add">+${ns.a}</span>`;
  const del = ns.d < 0 ? "" : `<span class="ns-del">−${ns.d}</span>`;
  const bin = ns.a < 0 || ns.d < 0 ? `<span class="ns-bin">bin</span>` : "";
  return `<span class="numstat">${add}${del}${bin}</span>`;
}

function fileRow(f: FileChange, depth: number, label: string, path: string, hash: string | null): HTMLLIElement {
  const li = document.createElement("li");
  const s = f.status.charAt(0).toUpperCase();
  const cls = s === "?" ? "Q" : s;
  li.style.paddingLeft = `${6 + depth * 14}px`;
  li.innerHTML =
    `<span class="fstatus ${cls}">${s}</span>` +
    `<span class="fpath">${escapeHtml(label)}</span>` +
    numBadge(f.path);
  li.addEventListener("click", () => {
    $("d-files").querySelectorAll("li").forEach((x) => x.classList.remove("selected"));
    li.classList.add("selected");
    openDiff(f.path, path, f.path, hash);
  });
  if (hash) {
    // file-level cherry-pick: apply just this file's changes from the commit
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        {
          label: "Cherry-pick file into working tree",
          action: async () => {
            try {
              const conflict = await invoke<boolean>("cherry_pick_file", {
                path,
                hash,
                file: f.path,
              });
              if (conflict) {
                await reloadActive(`Cherry-pick of ${f.path} has conflicts — resolve them`);
              } else {
                await afterStageChange();
                setStatus(`Applied ${f.path} from ${hash.slice(0, 8)}`);
              }
            } catch (err) {
              errorModal("Cherry-pick file failed:\n" + String(err));
            }
          },
        },
      ]);
    });
  }
  return li;
}

async function loadProject() {
  if (!lastFiles) return;
  const { path, hash } = lastFiles;
  const ul = $("d-files");
  if (!projectCache || projectCache.hash !== hash) {
    ul.innerHTML = "<li class='muted'>loading project…</li>";
    try {
      const [tree, num] = await Promise.all([
        invoke<string[]>("commit_tree", { path, hash: hash ?? "" }),
        invoke<{ path: string; added: number; deleted: number }[]>("commit_numstat", { path, hash: hash ?? "" }),
      ]);
      const m = new Map<string, { a: number; d: number }>();
      for (const n of num) m.set(n.path, { a: n.added, d: n.deleted });
      // collapse everything except the folders leading to a changed file
      const expanded = new Set<string>();
      for (const fp of m.keys()) {
        const parts = fp.split("/");
        let acc = "";
        for (let i = 0; i < parts.length - 1; i++) {
          acc = acc ? acc + "/" + parts[i] : parts[i];
          expanded.add(acc);
        }
      }
      projectCache = { hash, root: buildTree(tree), num: m, expanded };
    } catch (e) {
      ul.innerHTML = `<li class='muted'>${escapeHtml(String(e))}</li>`;
      return;
    }
  }
  if (filesAllMode) renderProjectTree();
}

// file history highlight: keep the full graph, brighten only commits that
// changed this file (dim the rest) and show +/- counts on those rows.
let fileHistoryHL: Set<string> | null = null;
let fileHistoryNum: Map<string, { a: number; d: number }> = new Map();

interface HistEntry {
  hash: string;
  author: string;
  time: number;
  summary: string;
  added: number;
  deleted: number;
}

async function showFileHistory() {
  if (!diffCtx) return;
  const { path, file } = diffCtx;
  let hist: HistEntry[];
  try {
    hist = await invoke("file_history", { path, file });
  } catch (e) {
    errorModal(String(e));
    return;
  }
  fileHistoryHL = new Set(hist.map((h) => h.hash));
  fileHistoryNum = new Map(hist.map((h) => [h.hash, { a: h.added, d: h.deleted }]));
  histLineRange = null; // whole-file history, not a line range
  // back to the full graph; highlight applies there
  showDiffView(false);
  const t = cur();
  if (t) renderGraph(t);
  renderHistPanel(file, hist);
}

// state for the file-history panel — used to click/arrow through commits and
// show the file's diff at each one in the center view
let histEntries: HistEntry[] = [];
let histFile = "";
let histIdx = -1;
let histLineRange: { start: number; end: number } | null = null; // line-history label

// line range covered by the current text selection inside the file view,
// read from the data-ln attributes on the rows (diff / plain / blame)
function selectedLineRange(): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const rowOf = (node: Node): HTMLElement | null => {
    const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
    return el?.closest<HTMLElement>("[data-ln]") ?? null;
  };
  const a = rowOf(r.startContainer);
  const b = rowOf(r.endContainer);
  if (!a || !b) return null;
  const la = +(a.dataset.ln ?? 0);
  let lb = +(b.dataset.ln ?? 0);
  // a selection ending exactly at the start of a row shouldn't include it
  if (b !== a && r.endOffset === 0 && lb > la) lb -= 1;
  if (!la || !lb) return null;
  return { start: Math.min(la, lb), end: Math.max(la, lb) };
}

// history of just the selected lines (git log -L)
async function showLineHistory(start: number, end: number) {
  if (!diffCtx) return;
  const { path, file, hash } = diffCtx;
  setStatus(`loading history of lines ${start}–${end}…`);
  let hist: HistEntry[];
  try {
    hist = await invoke("file_line_history", {
      path,
      file,
      start,
      end,
      rev: hash ?? "",
    });
  } catch (e) {
    errorModal("Line history failed:\n" + String(e));
    return;
  }
  fileHistoryHL = new Set(hist.map((h) => h.hash));
  fileHistoryNum = new Map(); // no per-commit line counts for a range
  histLineRange = { start, end };
  showDiffView(false);
  const t = cur();
  if (t) renderGraph(t);
  renderHistPanel(file, hist);
  setStatus(
    hist.length
      ? `${hist.length} commit(s) changed lines ${start}–${end}`
      : `no commits changed lines ${start}–${end}`
  );
}

// left-of-graph column listing every commit that touched the file; clicking
// one shows that commit's diff of the file in the center (fast click-through)
function renderHistPanel(file: string, hist: HistEntry[]) {
  histEntries = hist;
  histFile = file;
  histIdx = -1;
  const lr = histLineRange;
  $("hist-title").innerHTML = lr
    ? `📏 <b>${escapeHtml(basename(file))}</b> · L${lr.start}–${lr.end} · ${hist.length}`
    : `📄 <b>${escapeHtml(basename(file))}</b> · ${hist.length}`;
  ($("hist-title") as HTMLElement).title = lr
    ? `${file} — history of lines ${lr.start}–${lr.end}`
    : file;
  const ul = $("hist-list");
  ul.innerHTML = "";
  if (!hist.length) ul.innerHTML = "<li class='muted'>(no commits)</li>";
  hist.forEach((h, i) => {
    const li = document.createElement("li");
    li.className = "hist-item";
    li.dataset.idx = String(i);
    // line-range history has no meaningful per-commit +/- counts
    const ns = lr
      ? ""
      : h.added < 0 || h.deleted < 0
        ? `<span class="ns-bin">bin</span>`
        : `<span class="ns-add">+${h.added}</span><span class="ns-del">−${h.deleted}</span>`;
    li.innerHTML =
      `<div class="hi-top"><span class="hi-msg">${escapeHtml(h.summary)}</span>` +
      `<span class="numstat">${ns}</span></div>` +
      `<div class="hi-meta"><span class="hi-hash">${h.hash.slice(0, 8)}</span>` +
      `<span class="hi-author">${escapeHtml(h.author)}</span>` +
      `<span class="hi-date">${fmtDate(h.time)}</span></div>`;
    li.title = `${h.hash}\n${h.author} — ${fmtDate(h.time)}\n${h.summary}`;
    li.addEventListener("click", () => openHistEntry(i));
    ul.appendChild(li);
  });
  $("hist-panel").classList.remove("hidden");
  // open the newest commit's diff right away so there's something to read
  if (hist.length) openHistEntry(0);
}

// show the file's diff at history entry `i`; keeps the hist panel + graph
// highlight, so you can keep clicking (or arrow) through commits fast
function openHistEntry(i: number) {
  const t = cur();
  if (!t || i < 0 || i >= histEntries.length) return;
  histIdx = i;
  const h = histEntries[i];
  const ul = $("hist-list");
  ul.querySelectorAll("li.selected").forEach((x) => x.classList.remove("selected"));
  const li = ul.querySelector<HTMLElement>(`li[data-idx="${i}"]`);
  li?.classList.add("selected");
  // I position both views myself below — stop the proportional link fighting
  histScrollLock = true;
  li?.scrollIntoView({ block: "nearest" });
  t.selected = h.hash;
  // diff of the file at this commit, shown BESIDE the graph (split=true)
  openDiff(
    `${basename(histFile)} @ ${h.hash.slice(0, 8)} — ${h.summary}`,
    t.repo.path,
    histFile,
    h.hash,
    true
  );
  // highlight + scroll the graph to the commit so both views stay in sync
  paintViewport();
  if (gctx && gctx.tab === t) {
    const p = gctx.byId.get(h.hash);
    const scrollEl = $("scroll");
    if (p) scrollEl.scrollTop = Math.max(0, p.row * ROW_H - scrollEl.clientHeight / 2);
  }
  requestAnimationFrame(() => (histScrollLock = false)); // re-enable the link
}

// arrow through the file-history list (newer = up, older = down)
function stepHistEntry(dir: 1 | -1) {
  if (!histEntries.length) return;
  const next = histIdx < 0 ? 0 : histIdx + dir;
  if (next < 0 || next >= histEntries.length) return;
  openHistEntry(next);
}

// proportional scroll link between the commit list and the graph (split mode)
// so dragging one scrolls the other at the same relative rate
let histScrollLock = false;
function linkHistScroll() {
  const list = $("hist-list");
  const graph = $("scroll");
  const sync = (from: HTMLElement, to: HTMLElement) => {
    if (!histSplit || histScrollLock) return;
    histScrollLock = true;
    const fd = from.scrollHeight - from.clientHeight;
    const td = to.scrollHeight - to.clientHeight;
    if (fd > 0 && td > 0) to.scrollTop = (from.scrollTop / fd) * td;
    requestAnimationFrame(() => (histScrollLock = false));
  };
  list.addEventListener("scroll", () => sync(list, graph));
  graph.addEventListener("scroll", () => sync(graph, list));
}

function fileHistNumBadge(hash: string): string {
  const ns = fileHistoryNum.get(hash);
  if (!ns) return "";
  const add = ns.a < 0 ? "" : `<span class="ns-add">+${ns.a}</span>`;
  const del = ns.d < 0 ? "" : `<span class="ns-del">−${ns.d}</span>`;
  const bin = ns.a < 0 || ns.d < 0 ? `<span class="ns-bin">bin</span>` : "";
  return `<span class="numstat">${add}${del}${bin}</span>`;
}

function clearFileHistory() {
  fileHistoryHL = null;
  fileHistoryNum = new Map();
  histEntries = [];
  histFile = "";
  histIdx = -1;
  histLineRange = null;
  histSplit = false; // leave the split so the graph goes full-width again
  $("hist-filter").classList.add("hidden");
  $("hist-panel").classList.add("hidden");
  setStatus(""); // drop any "loading history…" message
  const t = cur();
  if (t) {
    showDiffView(false); // back to the graph
    renderGraph(t);
  }
}

// blame view: each line shows who/when; click a line to jump to that commit
async function showBlame() {
  if (!diffCtx) return;
  setBlameBtn(true);
  setPlainBtn(false);
  dvfClose();
  setEditBtn(false);
  const { path, file, hash } = diffCtx;
  const title = `Blame · ${file}`;
  $("diffview-title").textContent = title;
  $("diff-minimap").innerHTML = "";
  $("diffview-body").innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  showDiffView(true);
  let lines: { hash: string; author: string; time: number; summary: string; content: string }[];
  try {
    lines = await invoke("blame", { path, hash: hash ?? "", file });
  } catch (e) {
    $("diffview-body").innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
    return;
  }
  const body = $("diffview-body");
  body.innerHTML = lines
    .map((bl, i) => {
      const newGroup = i === 0 || lines[i - 1].hash !== bl.hash;
      const meta = newGroup
        ? `${bl.hash.slice(0, 8)}  ${bl.author}  ${fmtDate(bl.time)}`
        : "";
      // lines from the viewed commit (or uncommitted lines for WIP) = changes
      const isChange = hash ? bl.hash === hash : /^0+$/.test(bl.hash);
      return (
        `<div class="bl${newGroup ? " bl-top" : ""}${isChange ? " bl-added" : ""}" data-hash="${bl.hash}" data-ln="${i + 1}" title="${escapeHtml(bl.summary)}">` +
        `<span class="bl-ind"></span>` +
        `<span class="bl-meta">${escapeHtml(meta)}</span>` +
        `<span class="ln">${i + 1}</span>` +
        `<span class="dc">${hlLine(bl.content, langForFile(file))}</span></div>`
      );
    })
    .join("");
  body.querySelectorAll<HTMLElement>(".bl").forEach((el) => {
    el.addEventListener("click", () => {
      const t = cur();
      const node = t ? findById(t, el.dataset.hash!) : null;
      if (node) selectNode(node, true);
    });
  });
}

// show the WHOLE file (content at the commit / working tree), with line numbers
async function openFileContent(path: string, hash: string | null, file: string) {
  diffCtx = { path, file, hash };
  lastView = () => openFileContent(path, hash, file);
  setBlameBtn(false);
  const rev = hash ?? "";
  const title = `${file} @ ${hash ? hash.slice(0, 8) : "working"}`;
  if (isImage(file)) {
    $("diffview-title").textContent = title;
    $("diff-minimap").innerHTML = "";
    showDiffView(true);
    const url = await invoke<string>("blob_data_url", { path, rev, file }).catch(() => "");
    $("diffview-body").innerHTML = url
      ? `<div class="imgdiff"><div class="imgpane"><div class="imglabel">${escapeHtml(file)}</div><div class="imgwrap"><img src="${url}"/></div></div></div>`
      : `<div class='dl ctx'><span class='dc'>(no image data)</span></div>`;
    return;
  }
  $("diffview-title").textContent = title;
  $("diff-minimap").innerHTML = "";
  $("diffview-body").innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  showDiffView(true);
  try {
    const txt = await invoke<string>("file_at_commit", { path, hash: rev, file });
    const lines = txt.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    $("diffview-body").innerHTML =
      lines
        .map(
          (l, i) =>
            `<div class="dl ctx"><span class="ln">${i + 1}</span><span class="ln"></span><span class="dc">${escapeHtml(l)}</span></div>`
        )
        .join("") || "<div class='dl ctx'><span class='dc'>(empty file)</span></div>";
  } catch (e) {
    $("diffview-body").innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
  }
}

function renderProjectTree() {
  if (!projectCache || !lastFiles) return;
  const { path, hash } = lastFiles;
  const { root, num, expanded } = projectCache;
  const ul = $("d-files");
  ul.innerHTML = "";

  const walk = (node: TNode, depth: number) => {
    for (const c of node.children) {
      if (c.dir) {
        const open = expanded.has(c.path);
        const li = document.createElement("li");
        li.className = "tree-dir";
        li.style.paddingLeft = `${6 + depth * 14}px`;
        li.innerHTML =
          `<span class="tchev">${open ? "▾" : "▸"}</span>` +
          `<span class="fdir">${escapeHtml(c.name)}</span>`;
        li.addEventListener("click", () => {
          if (expanded.has(c.path)) expanded.delete(c.path);
          else expanded.add(c.path);
          renderProjectTree();
        });
        ul.appendChild(li);
        if (open) walk(c, depth + 1);
      } else {
        const ns = num.get(c.path);
        const li = document.createElement("li");
        li.style.paddingLeft = `${6 + depth * 14}px`;
        if (ns) li.classList.add("changed-file");
        let badge = "";
        if (ns) {
          const add = ns.a < 0 ? "" : `<span class="ns-add">+${ns.a}</span>`;
          const del = ns.d < 0 ? "" : `<span class="ns-del">−${ns.d}</span>`;
          const bin = ns.a < 0 || ns.d < 0 ? `<span class="ns-bin">bin</span>` : "";
          badge = `<span class="numstat">${add}${del}${bin}</span>`;
        }
        li.innerHTML = `<span class="fpath">${escapeHtml(c.name)}</span>${badge}`;
        li.addEventListener("click", () => {
          ul.querySelectorAll("li").forEach((x) => x.classList.remove("selected"));
          li.classList.add("selected");
          // changed file -> show its diff; unchanged -> show whole file content
          if (num.has(c.path)) openDiff(c.path, path, c.path, hash);
          else openFileContent(path, hash, c.path);
        });
        ul.appendChild(li);
      }
    }
  };
  walk(root, 0);
}

function renderFileList() {
  if (!lastFiles) return;
  if (filesAllMode) {
    loadProject();
    return;
  }
  const { files, path, hash } = lastFiles;
  const ul = $("d-files");
  ul.innerHTML = "";
  if (!files.length) {
    ul.innerHTML = "<li class='muted'>(no file changes)</li>";
    return;
  }
  if (!filesTreeMode) {
    files.forEach((f) => ul.appendChild(fileRow(f, 0, f.path, path, hash)));
    return;
  }
  // folder tree: group by directory, show folder rows + file leaves
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const shownDirs = new Set<string>();
  for (const f of sorted) {
    const parts = f.path.split("/");
    // emit folder rows for any new ancestor directories
    for (let d = 0; d < parts.length - 1; d++) {
      const dir = parts.slice(0, d + 1).join("/");
      if (!shownDirs.has(dir)) {
        shownDirs.add(dir);
        const li = document.createElement("li");
        li.className = "tree-dir";
        li.style.paddingLeft = `${6 + d * 14}px`;
        li.innerHTML = `<span class="fdir">📁 ${escapeHtml(parts[d])}</span>`;
        ul.appendChild(li);
      }
    }
    ul.appendChild(fileRow(f, parts.length - 1, parts[parts.length - 1], path, hash));
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

async function doClone() {
  const url = await promptModal(
    "Clone repository — URL",
    "https://github.com/user/repo.git"
  );
  if (!url || !url.trim()) return;
  const dest = await open({
    directory: true,
    title: "Select the folder to clone into",
  });
  if (!dest || Array.isArray(dest)) return;
  setStatus(`cloning ${url.trim()}…`);
  pushBusy("clone-btn");
  try {
    const path = await invoke<string>("clone_repo", { url: url.trim(), dest });
    setStatus(`Cloned to ${path}`);
    await loadRepo(path);
  } catch (e) {
    setStatus("");
    errorModal("Clone failed:\n" + String(e));
  } finally {
    popBusy();
  }
}

async function loadRepo(path: string, silent = false, parentPath?: string) {
  // already open? just focus it.
  const existing = tabs.findIndex((t) => t.repo.path === path);
  if (existing !== -1) {
    if (parentPath) tabs[existing].parentPath = parentPath;
    switchTab(existing);
    return;
  }
  setStatus("loading…");
  try {
    const repo = await invoke<RepoData>("open_repo", { path });
    const tab: Tab = {
      repo,
      selected: repo.head || (repo.wip ? WIP_ID : null),
      nodes: buildNodes(repo),
      placed: [],
      hidden: new Set(),
      parentPath,
      fingerprint: repo.fingerprint,
    };
    tabs.push(tab);
    active = tabs.length - 1;
    renderTabs();
    renderActive();
    syncChatToTab();
    void syncRepoHost(); // avatars are looked up against this repo's origin
    saveSession();
    saveRepoCache(path, repo);
    refreshRemoteTags(tab);
  } catch (e) {
    setStatus("");
    if (silent) console.warn("skip repo", path, String(e));
    else errorModal("Could not open repo:\n" + String(e));
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

// ---- repo cache (fast startup) ----
const cacheKey = (path: string) => `jkt.cache:${path}`;
function saveRepoCache(path: string, repo: RepoData) {
  try {
    localStorage.setItem(cacheKey(path), JSON.stringify(repo));
  } catch {
    // quota exceeded (very large repo) — drop the stale entry, skip caching
    try {
      localStorage.removeItem(cacheKey(path));
    } catch {}
  }
}
function loadRepoCache(path: string): RepoData | null {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(path)) ?? "null");
  } catch {
    return null;
  }
}

async function restoreSession() {
  let data: { paths: string[]; active: number } | null = null;
  try {
    data = JSON.parse(localStorage.getItem(LS_SESSION) ?? "null");
  } catch {}
  if (!data || !data.paths?.length) return;

  // Build tabs instantly from cache where available; load uncached ones live.
  const uncached: { path: string; idx: number }[] = [];
  data.paths.forEach((p, idx) => {
    const cached = loadRepoCache(p);
    if (cached) {
      tabs.push({
        repo: cached,
        selected: cached.head || (cached.wip ? WIP_ID : null),
        nodes: buildNodes(cached),
        placed: [],
        hidden: new Set(),
        stale: true, // refresh in background / on enter
      });
    } else {
      tabs.push(null as unknown as Tab); // placeholder, filled below
      uncached.push({ path: p, idx });
    }
  });

  // load the repos with no cache (parallel)
  const loaded = await Promise.all(
    uncached.map((u) =>
      invoke<RepoData>("open_repo", { path: u.path })
        .then((repo) => ({ idx: u.idx, repo }))
        .catch(() => ({ idx: u.idx, repo: null }))
    )
  );
  for (const { idx, repo } of loaded) {
    tabs[idx] = repo
      ? {
          repo,
          selected: repo.head || (repo.wip ? WIP_ID : null),
          nodes: buildNodes(repo),
          placed: [],
          hidden: new Set(),
          fingerprint: repo.fingerprint,
        }
      : (null as unknown as Tab);
  }
  // drop any failed placeholders
  for (let i = tabs.length - 1; i >= 0; i--) if (!tabs[i]) tabs.splice(i, 1);

  if (!tabs.length) return;
  active = Math.min(Math.max(0, data.active ?? 0), tabs.length - 1);
  renderTabs();
  renderActive();
  syncChatToTab();
  void syncRepoHost(); // avatars are looked up against this repo's origin
  saveSession();

  const t = cur();
  if (t) {
    refreshRemoteTags(t);
    if (t.stale) reloadActive(); // refresh the visible tab in the background
  }
}

// which "/" folders in the branch lists are collapsed (own key so it doesn't
// clash with the sidebar SECTION collapse state)
const LS_GROUPS = "jkt.refgroups";
function getCollapsedGroups(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_GROUPS) ?? "[]"));
  } catch {
    return new Set();
  }
}
function toggleCollapsedGroup(key: string) {
  const set = getCollapsedGroups();
  if (set.has(key)) set.delete(key);
  else set.add(key);
  try {
    localStorage.setItem(LS_GROUPS, JSON.stringify([...set]));
  } catch {}
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
      li.querySelector(".fpath")?.addEventListener("click", () => {
        document
          .querySelectorAll("#c-unstaged li.selected, #c-staged li.selected")
          .forEach((x) => x.classList.remove("selected"));
        li.classList.add("selected");
        // one-sided diff with per-line stage/unstage buttons
        openWipDiff(path, f.path, !stage);
      });
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
// split mode: keep the graph visible NEXT to the diff (file-history browsing)
let histSplit = false;
function showDiffView(on: boolean) {
  openFileStamp = ""; // re-baseline: a different file isn't an edit
  $("mergeview").classList.add("hidden");
  $("diffview").classList.toggle("hidden", !on);
  const split = on && histSplit;
  $("graphpane").classList.toggle("hist-split", split);
  // in split mode the graph + headers stay visible beside the diff
  $("col-headers").classList.toggle("hidden", on && !split);
  $("scroll").classList.toggle("hidden", on && !split);
  dvfClose(); // view content changes — stale find results would mislead
}
function showMergeView(on: boolean) {
  $("diffview").classList.add("hidden");
  $("mergeview").classList.toggle("hidden", !on);
  $("col-headers").classList.toggle("hidden", on);
  $("scroll").classList.toggle("hidden", on);
}

// ---- merge conflict resolution ----
let mvFile = ""; // file currently open in the merge resolver
type Choice = "ours" | "theirs" | "both" | "custom" | null;
interface Seg {
  kind: "normal" | "conflict";
  lines?: string[];
  ours?: string[];
  theirs?: string[];
  choice?: Choice;
  custom?: string[]; // hand-written resolution for this conflict
}
let mvSegments: Seg[] = [];
let mvManual = false; // raw-textarea editing mode

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// ---- side-by-side alignment ----
// Every conflict block occupies the SAME number of rows in all three panes:
// 2 spacer rows (matching the confbar height in the result) + the block's
// content, padded with placeholder rows up to the longest side. With that,
// the lockstep scrolling keeps ours/theirs/result perfectly lined up.
const MV_PAD = `<div class="ml pad"><span class="ln"></span><span class="dc"></span></div>`;

function conflictResultLen(s: Seg): number {
  switch (s.choice) {
    case "ours":
      return s.ours!.length;
    case "theirs":
      return s.theirs!.length;
    case "both":
      return s.ours!.length + s.theirs!.length;
    case "custom":
      return (s.custom ?? []).length;
    default:
      return s.ours!.length + s.theirs!.length; // unresolved: stacked
  }
}
function conflictBlockLen(s: Seg): number {
  return Math.max(s.ours!.length, s.theirs!.length, conflictResultLen(s));
}

// render one side (ours/theirs) as a full numbered file with the conflicting
// lines highlighted, padded so it stays aligned with the other panes.
function renderMergeSide(elId: string, side: "ours" | "theirs") {
  const lang = langForFile(mvFile);
  let n = 0;
  let html = "";
  for (const s of mvSegments) {
    if (s.kind === "normal") {
      for (const l of s.lines!) {
        n++;
        html += `<div class="ml"><span class="ln">${n}</span><span class="dc">${hlLine(l, lang)}</span></div>`;
      }
    } else {
      html += MV_PAD + MV_PAD; // spacer matching the result's conflict bar
      const lines = side === "ours" ? s.ours! : s.theirs!;
      const other = side === "ours" ? s.theirs! : s.ours!;
      const pairs = Math.min(s.ours!.length, s.theirs!.length);
      lines.forEach((l, i) => {
        n++;
        // paired lines: highlight the exact characters that differ between
        // ours and theirs (same mechanism as the diff view)
        const code =
          i < pairs
            ? side === "ours"
              ? intraline(l, other[i], lang).o
              : intraline(other[i], l, lang).n
            : hlLine(l, lang);
        html += `<div class="ml ${side} conf"><span class="ln">${n}</span><span class="dc">${code}</span></div>`;
      });
      for (let p = lines.length; p < conflictBlockLen(s); p++) html += MV_PAD;
    }
  }
  $(elId).innerHTML = html;
}

// re-render all three panes (paddings depend on the current choices)
function renderMergePanes() {
  renderMergeSide("mv-ours-code", "ours");
  renderMergeSide("mv-theirs-code", "theirs");
  renderMergeResult();
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
    else if (s.choice === "custom") out.push(...(s.custom ?? []));
  }
  return out.join("\n") + "\n";
}

function mvUpdateSave() {
  ($("mv-save") as HTMLButtonElement).disabled = !mvManual && !mvAllResolved();
}

let mvEditingIdx: number | null = null; // conflict currently in inline edit

function renderMergeResult() {
  const el = $("mv-result");
  const lang = langForFile(mvFile);
  let n = 0;
  let html = "";
  mvSegments.forEach((s, idx) => {
    if (s.kind === "normal") {
      s.lines!.forEach((l, li) => {
        n++;
        // data-seg/-line: double-click a line to edit it in place
        html += `<div class="ml editable" data-seg="${idx}" data-line="${li}" title="Double-click to edit this line"><span class="ln">${n}</span><span class="dc">${hlLine(l, lang)}</span></div>`;
      });
      return;
    }
    const c = s.choice;
    const blockLen = conflictBlockLen(s);
    let contentRows = 0;
    html +=
      `<div class="confbar" data-idx="${idx}">` +
      `<span class="confbar-label">conflict</span>` +
      `<button data-act="ours" class="mini ${c === "ours" ? "sel" : ""}">ours</button>` +
      `<button data-act="theirs" class="mini ${c === "theirs" ? "sel" : ""}">theirs</button>` +
      `<button data-act="both" class="mini ${c === "both" ? "sel" : ""}">both</button>` +
      `<button data-act="custom" class="mini ${c === "custom" ? "sel" : ""}" title="Write the resolution yourself">✎ edit</button>` +
      `</div>`;
    if (mvEditingIdx === idx) {
      // inline editor for a hand-written resolution
      const initial =
        s.custom ??
        (c === "ours"
          ? s.ours!
          : c === "theirs"
            ? s.theirs!
            : c === "both"
              ? [...s.ours!, ...s.theirs!]
              : [...s.ours!, ...s.theirs!]);
      html +=
        `<div class="mv-inline-edit" data-idx="${idx}">` +
        `<textarea spellcheck="false" rows="${Math.min(14, Math.max(3, initial.length + 1))}">${escapeHtml(initial.join("\n"))}</textarea>` +
        `<div class="mv-inline-btns"><button class="mini" data-ie="apply">✓ Apply</button>` +
        `<button class="mini" data-ie="cancel">✕ Cancel</button></div></div>`;
      return;
    }
    if (c === "custom") {
      for (const l of s.custom ?? []) {
        contentRows++;
        html += `<div class="ml custom"><span class="ln">${String(++n)}</span><span class="dc">${hlLine(l, lang)}</span></div>`;
      }
    } else {
      const showOurs = c === null || c === "ours" || c === "both";
      const showTheirs = c === null || c === "theirs" || c === "both";
      // undecided: both versions stacked — mark the exact differing characters
      const pairs = c === null ? Math.min(s.ours!.length, s.theirs!.length) : 0;
      if (showOurs)
        s.ours!.forEach((l, i) => {
          contentRows++;
          const num = c ? String(++n) : "";
          const code = i < pairs ? intraline(l, s.theirs![i], lang).o : hlLine(l, lang);
          html += `<div class="ml ours"><span class="ln">${num}</span><span class="dc">${code}</span></div>`;
        });
      if (showTheirs)
        s.theirs!.forEach((l, i) => {
          contentRows++;
          const num = c ? String(++n) : "";
          const code = i < pairs ? intraline(s.ours![i], l, lang).n : hlLine(l, lang);
          html += `<div class="ml theirs"><span class="ln">${num}</span><span class="dc">${code}</span></div>`;
        });
    }
    // pad to the block height so all three panes stay row-aligned
    for (let p = contentRows; p < blockLen; p++) html += MV_PAD;
  });
  el.innerHTML = html;
  el.querySelectorAll<HTMLElement>(".confbar button").forEach((b) => {
    b.addEventListener("click", () => {
      const idx = +(b.closest(".confbar") as HTMLElement).dataset.idx!;
      if (b.dataset.act === "custom") {
        mvEditingIdx = idx; // open the inline editor
      } else {
        mvSegments[idx].choice = b.dataset.act as Choice;
        if (mvEditingIdx === idx) mvEditingIdx = null;
      }
      renderMergePanes();
      mvUpdateSave();
    });
  });
  // inline conflict editor: apply / cancel
  el.querySelectorAll<HTMLElement>(".mv-inline-edit").forEach((box) => {
    const idx = +box.dataset.idx!;
    const ta = box.querySelector("textarea")!;
    box.querySelector('[data-ie="apply"]')?.addEventListener("click", () => {
      const s = mvSegments[idx];
      s.custom = ta.value.replace(/\r\n/g, "\n").split("\n");
      s.choice = "custom";
      mvEditingIdx = null;
      renderMergePanes();
      mvUpdateSave();
    });
    box.querySelector('[data-ie="cancel"]')?.addEventListener("click", () => {
      mvEditingIdx = null;
      renderMergePanes();
    });
    ta.focus();
  });
  // double-click a normal line to fix it in place
  el.querySelectorAll<HTMLElement>(".ml.editable").forEach((row) => {
    row.addEventListener("dblclick", () => {
      const seg = +row.dataset.seg!;
      const li = +row.dataset.line!;
      const dc = row.querySelector(".dc") as HTMLElement;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "mv-line-edit";
      input.value = mvSegments[seg].lines![li];
      dc.replaceWith(input);
      input.focus();
      input.select();
      const commit = (save: boolean) => {
        if (save) mvSegments[seg].lines![li] = input.value;
        renderMergePanes();
        mvUpdateSave();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit(true);
        else if (e.key === "Escape") commit(false);
      });
      input.addEventListener("blur", () => commit(true));
    });
  });
  updateMvConflictUi();
}

// conflict counter, prev/next jump targets and the side minimap
let mvJumpIdx = -1;
function updateMvConflictUi() {
  const bars = Array.from($("mv-result").querySelectorAll<HTMLElement>(".confbar"));
  const total = mvSegments.filter((s) => s.kind === "conflict").length;
  const open = mvSegments.filter((s) => s.kind === "conflict" && !s.choice).length;
  $("mv-count").textContent = total
    ? open
      ? `⚠ ${open} of ${total} conflict${total > 1 ? "s" : ""} unresolved`
      : `✓ all ${total} conflict${total > 1 ? "s" : ""} resolved`
    : "";
  $("mv-count").classList.toggle("mv-count-done", total > 0 && open === 0);
  ($("mv-prev") as HTMLButtonElement).disabled = !bars.length;
  ($("mv-next") as HTMLButtonElement).disabled = !bars.length;

  // minimap: one mark per conflict at its relative position (red = open,
  // green = resolved); click jumps there
  const el = $("mv-result");
  const map = $("mv-minimap");
  map.innerHTML = "";
  const totalH = el.scrollHeight || 1;
  bars.forEach((bar, i) => {
    const idx = +bar.dataset.idx!;
    const resolved = !!mvSegments[idx]?.choice;
    const mark = document.createElement("div");
    mark.className = `mm ${resolved ? "res" : "conf"}`;
    mark.style.top = `${(bar.offsetTop / totalH) * 100}%`;
    mark.title = resolved ? "resolved conflict" : "unresolved conflict";
    mark.addEventListener("click", () => jumpToConflict(i));
    map.appendChild(mark);
  });
}

function jumpToConflict(i: number) {
  if (mvManual) return;
  const bars = Array.from($("mv-result").querySelectorAll<HTMLElement>(".confbar"));
  if (!bars.length) return;
  mvJumpIdx = ((i % bars.length) + bars.length) % bars.length;
  const bar = bars[mvJumpIdx];
  const el = $("mv-result");
  el.scrollTop = bar.offsetTop - el.clientHeight / 2; // synced panes follow
  bar.classList.add("conf-flash");
  setTimeout(() => bar.classList.remove("conf-flash"), 700);
}

function resolveAll(side: Choice) {
  mvSegments.forEach((s) => {
    if (s.kind === "conflict") s.choice = side;
  });
  if (mvManual) toggleManual(); // back to rendered view
  renderMergePanes();
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
  mvJumpIdx = -1;
  mvEditingIdx = null;
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
    renderMergePanes();
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
    errorModal("Save failed:\n" + String(e));
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

// language for syntax highlighting in the currently shown diff/blame view
let hlLang: string | null = null;

function showDiffText(title: string, diff: string) {
  hlLang = diffCtx ? langForFile(diffCtx.file) : null;
  $("diffview-title").textContent = title;
  const body = $("diffview-body");
  body.innerHTML =
    renderUnifiedDiff(diff) ||
    "<div class='dl ctx'><span class='dc'>(no changes)</span></div>";
  showDiffView(true);
  buildMinimap();
}

function isImage(file: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(file);
}

let diffCtx: { path: string; file: string; hash: string | null } | null = null;
let lastView: (() => void) | null = null; // re-render the view before blame
let blameOn = false;
function setBlameBtn(on: boolean) {
  blameOn = on;
  const b = document.getElementById("diffview-blame");
  if (b) b.textContent = on ? "✕ Blame" : "Blame";
}

// ---- plain file view (the file as it is — selectable, copyable) ----
let plainOn = false;
let plainContent = ""; // raw text for the Copy button
function setPlainBtn(on: boolean) {
  plainOn = on;
  const b = document.getElementById("diffview-plain");
  if (b) b.textContent = on ? "✕ Plain" : "Plain";
  $("diffview-copy").classList.toggle("hidden", !on);
}

async function togglePlainView() {
  if (!diffCtx) return;
  if (plainOn) {
    lastView?.(); // back to the diff
    return;
  }
  await renderPlainView();
}

async function renderPlainView() {
  if (!diffCtx) return;
  const { path, file, hash } = diffCtx;
  const body = $("diffview-body");
  body.innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  try {
    // hash = "" -> current worktree content (same command handles both)
    const content = await invoke<string>("file_at_commit", {
      path,
      hash: hash ?? "",
      file,
    });
    plainContent = content;
    setPlainBtn(true);
    setBlameBtn(false);
    dvfClose(); // body is replaced — drop stale find ranges
    $("diffview-title").textContent =
      `${file} — plain ${hash ? `@ ${hash.slice(0, 8)}` : "(working tree)"}`;
    $("diff-minimap").innerHTML = "";
    const lang = langForFile(file);
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    // line numbers via CSS counter (::before) — selecting + copying grabs
    // ONLY the code, never the numbers
    body.innerHTML =
      `<div class="plainview">` +
      lines
        .map(
          (l, i) =>
            `<div class="pl" data-ln="${i + 1}"><span class="plc">${hlLine(l, lang) || "&nbsp;"}</span></div>`
        )
        .join("") +
      `</div>`;
  } catch (e) {
    body.innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
  }
}

async function copyPlainFile() {
  try {
    await navigator.clipboard.writeText(plainContent);
    setStatus("File content copied to clipboard");
  } catch (e) {
    errorModal("Copy failed:\n" + String(e));
  }
}

// ---- edit mode: change the file and save it to the working tree ----
let editOn = false;
let editOriginal = ""; // content as loaded, to detect unsaved changes
function setEditBtn(on: boolean) {
  editOn = on;
  const b = document.getElementById("diffview-modify");
  if (b) b.textContent = on ? "✕ Cancel edit" : "Modify";
  $("diffview-save").classList.toggle("hidden", !on);
}

function editDirty(): boolean {
  const ta = document.getElementById("dv-edit") as HTMLTextAreaElement | null;
  return !!ta && ta.value !== editOriginal;
}

async function toggleEditFile() {
  if (!diffCtx) return;
  if (editOn) {
    if (editDirty() && !(await confirmModal("Discard your unsaved changes to this file?")))
      return;
    setEditBtn(false);
    lastView?.(); // back to the diff/plain view
    return;
  }
  const { path, file, hash } = diffCtx;
  // Editing a file from a commit: check that commit out FIRST, so the edit is
  // made on top of the state it belongs to (not mixed into whatever is
  // currently checked out).
  if (hash) {
    const t = cur();
    if (!t) return;
    if (t.repo.head !== hash) {
      // prefer a local branch that points here — avoids a detached HEAD
      // Land on a real BRANCH whenever one exists here — a local branch, or a
      // local tracking branch for a remote-only one. Only a commit with no
      // branch at all falls back to a detached checkout.
      const local = t.repo.refs.find((r) => r.kind === "local" && r.target === hash);
      const remote = local
        ? undefined
        : t.repo.refs.find((r) => r.kind === "remote" && r.target === hash);
      const target = local
        ? local.name
        : remote
          ? remote.name.split("/").slice(1).join("/") // strip the remote prefix
          : hash;
      const upstream = remote ? remote.name : null;
      const label = local || remote ? target : hash.slice(0, 8);

      const ok = await confirmModal(
        local
          ? `Check out branch "${target}" (at ${hash.slice(0, 8)}) before editing ${basename(file)}?\n\n` +
              `Uncommitted changes are stashed first.`
          : remote
            ? `Check out "${target}" (tracking ${remote.name}) before editing ${basename(file)}?\n\n` +
                `The local branch is created if it doesn't exist yet, so you stay on a branch ` +
                `instead of a detached HEAD.\n\nUncommitted changes are stashed first.`
            : `Check out commit ${hash.slice(0, 8)} before editing ${basename(file)}?\n\n` +
                `No branch points at this commit, so the repo goes into DETACHED HEAD state — ` +
                `commit to a new branch afterwards or the work is easy to lose.\n\n` +
                `Uncommitted changes are stashed first.`
      );
      if (!ok) return;
      setStatus(`checking out ${label}…`);
      pushBusy();
      try {
        const stashed = await invoke<boolean>("checkout", { path, target, upstream });
        await reloadActive(
          stashed ? `Checked out ${label} — local changes stashed` : `Checked out ${label}`
        );
      } catch (e) {
        setStatus("");
        errorModal("Checkout failed — not editing:\n" + String(e));
        return;
      } finally {
        popBusy();
      }
    }
    // now editing the working tree at that commit, not a historical blob
    diffCtx = { path, file, hash: null };
  }
  const body = $("diffview-body");
  body.innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  showDiffView(true); // a checkout above re-rendered the tab and hid the view
  try {
    // always the working tree now — the commit (if any) is checked out
    const content = await invoke<string>("file_at_commit", { path, hash: "", file });
    editOriginal = content;
    setEditBtn(true);
    setPlainBtn(false);
    setBlameBtn(false);
    setPickButtons(false);
    dvfClose();
    $("diff-minimap").innerHTML = "";
    $("diffview-title").textContent = `${file} — editing (working tree)`;
    // leaving the editor lands on the file's unstaged diff
    lastView = () => openWipDiff(path, file, false);
    // syntax-highlighted layer behind a transparent textarea, so editing keeps
    // the same coloring as every other file view
    body.innerHTML =
      `<div id="dv-editwrap"><pre id="dv-edithl" aria-hidden="true"></pre>` +
      `<textarea id="dv-edit" spellcheck="false"></textarea></div>`;
    const ta = $("dv-edit") as HTMLTextAreaElement;
    ta.value = content;
    setupEditHighlight(langForFile(file));
    ta.focus();
  } catch (e) {
    body.innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
  }
}

// keep the highlight layer in step with the textarea (content + scroll).
// Very large files skip highlighting — re-running hljs per keystroke on those
// would make typing lag, and a responsive editor matters more than color.
const EDIT_HL_MAX_LINES = 6000;
function setupEditHighlight(lang: string | null) {
  const ta = document.getElementById("dv-edit") as HTMLTextAreaElement | null;
  const hl = document.getElementById("dv-edithl");
  if (!ta || !hl) return;
  const tooBig = ta.value.split("\n").length > EDIT_HL_MAX_LINES;
  if (!lang || tooBig) {
    // no highlighting: show the textarea's own text instead of a clear one
    ta.classList.add("plaintext");
    return;
  }
  let queued = false;
  const paint = () => {
    // trailing newline needs a filler line or the last row can't scroll into view
    hl.innerHTML = hljs.highlight(ta.value + "\n", {
      language: lang,
      ignoreIllegals: true,
    }).value;
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  };
  const syncScroll = () => {
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  };
  ta.addEventListener("input", () => {
    schedule();
    syncScroll();
  });
  ta.addEventListener("scroll", syncScroll);
  paint();
}

async function saveEditedFile() {
  const ta = document.getElementById("dv-edit") as HTMLTextAreaElement | null;
  if (!diffCtx || !ta) return;
  const { path, file } = diffCtx;
  const btn = $("diffview-save") as HTMLButtonElement;
  btn.disabled = true;
  try {
    await invoke("write_file_worktree", { path, file, content: ta.value });
    editOriginal = ta.value;
    await afterStageChange(); // WIP counts + graph pick up the edit
    setStatus(`Saved ${file}`);
    setEditBtn(false);
    // show the result as a normal unstaged diff of the file
    await openWipDiff(path, file, false);
  } catch (e) {
    errorModal("Save failed:\n" + String(e));
  } finally {
    btn.disabled = false;
  }
}

// ---- Ctrl+F find inside the file/diff view ----
let dvfMatches: Range[] = [];
let dvfIdx = -1;

function dvfOpen() {
  $("dv-find").classList.remove("hidden");
  const input = $("dvf-input") as HTMLInputElement;
  input.focus();
  input.select();
  if (input.value) dvfRun(input.value);
}

function dvfClose() {
  $("dv-find").classList.add("hidden");
  dvfMatches = [];
  dvfIdx = -1;
  dvfPaint();
}

function dvfRun(query: string) {
  const body = $("diffview-body");
  dvfMatches = [];
  const q = query.toLowerCase();
  if (q) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    outer: while ((node = walker.nextNode())) {
      const text = (node.textContent ?? "").toLowerCase();
      let i = 0;
      while ((i = text.indexOf(q, i)) !== -1) {
        const r = new Range();
        r.setStart(node, i);
        r.setEnd(node, i + q.length);
        dvfMatches.push(r);
        i += q.length;
        if (dvfMatches.length >= 2000) break outer; // sanity cap
      }
    }
  }
  dvfIdx = dvfMatches.length ? 0 : -1;
  dvfPaint(true);
}

function dvfStep(dir: 1 | -1) {
  if (!dvfMatches.length) return;
  dvfIdx = (dvfIdx + dir + dvfMatches.length) % dvfMatches.length;
  dvfPaint(true);
}

// CSS Custom Highlight API — marks matches without touching the DOM (so
// syntax highlighting spans stay intact)
function dvfPaint(scroll = false) {
  const HL = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  $("dvf-count").textContent = dvfMatches.length ? `${dvfIdx + 1}/${dvfMatches.length}` : "0/0";
  if (HL && registry) {
    registry.set("dvf", new HL(...dvfMatches));
    registry.set("dvf-cur", dvfIdx >= 0 ? new HL(dvfMatches[dvfIdx]) : new HL());
  }
  dvfPaintMinimap();
  if (scroll && dvfIdx >= 0) {
    const el = dvfMatches[dvfIdx].startContainer.parentElement;
    el?.scrollIntoView({ block: "center" });
  }
}

// yellow marks on the side rail — one per row with a match, click to jump
function dvfPaintMinimap() {
  const map = $("diff-minimap");
  map.querySelectorAll(".mm.find").forEach((x) => x.remove());
  if (!dvfMatches.length) return;
  const body = $("diffview-body");
  const bodyRect = body.getBoundingClientRect();
  const total = body.scrollHeight || 1;
  const seen = new Set<number>();
  const cap = Math.min(dvfMatches.length, 1000);
  for (let i = 0; i < cap; i++) {
    const r = dvfMatches[i];
    const el = (r.startContainer.parentElement?.closest(
      ".dl, .bl, .cpl, .cprow, .pl"
    ) ?? r.startContainer.parentElement) as HTMLElement | null;
    if (!el) continue;
    const top = el.getBoundingClientRect().top - bodyRect.top + body.scrollTop;
    const bucket = Math.round((top / total) * 400); // one mark per rail slot
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    const idx = i;
    const mark = document.createElement("div");
    mark.className = "mm find";
    mark.style.top = `${(top / total) * 100}%`;
    mark.title = "search match — click to jump";
    mark.addEventListener("click", () => {
      dvfIdx = idx;
      dvfPaint(true);
    });
    map.appendChild(mark);
  }
}

let diffFull = false; // commit diff view: false = hunks only, true = whole file

async function openDiff(
  title: string,
  path: string,
  file: string,
  hash: string | null,
  split = false // keep the graph visible beside the diff (file-history mode)
) {
  histSplit = split;
  diffCtx = { path, file, hash };
  wipDiffCtx = null; // this is a commit/compare diff, not the WIP staging view
  lastView = () => openDiff(title, path, file, hash, split);
  setBlameBtn(false);
  setPlainBtn(false);
  setEditBtn(false);
  setPickButtons(!!hash && !isImage(file));
  if (isImage(file)) {
    await showImageDiff(title, path, file, hash);
    return;
  }
  $("diffview-title").textContent = title;
  const body = $("diffview-body");
  body.innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  showDiffView(true);
  try {
    const diff = hash
      ? await invoke<string>("commit_diff", { path, hash, file, full: diffFull })
      : await invoke<string>("wip_diff", { path, file });
    showDiffText(title, diff);
    if (hash) {
      // toggle between changed hunks and the whole file
      const wb = $("diffview-whole");
      wb.classList.remove("hidden");
      wb.textContent = diffFull ? "Hunks only" : "Whole file";
    }
  } catch (e) {
    body.innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
    $("diff-minimap").innerHTML = "";
  }
}

// ---- line-level staging ----
// The WIP file lists open this view instead of openDiff(): it shows only one
// side (unstaged: index→worktree, staged: HEAD→index) and puts a clickable
// +/− button on every changed line to stage/unstage just that line.
let wipDiffCtx: { path: string; file: string; staged: boolean; diff: string } | null = null;
let wipFull = false; // false = hunks only (default), true = whole file

async function openWipDiff(path: string, file: string, staged: boolean) {
  diffCtx = { path, file, hash: null };
  lastView = () => openWipDiff(path, file, staged);
  setBlameBtn(false);
  setPlainBtn(false);
  setEditBtn(false);
  setPickButtons(false);
  wipDiffCtx = null;
  if (isImage(file)) {
    await showImageDiff(file, path, file, null);
    return;
  }
  const title = `${file} — ${staged ? "staged" : "unstaged"} changes`;
  $("diffview-title").textContent = title;
  const body = $("diffview-body");
  body.innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  showDiffView(true);
  try {
    const diff = await invoke<string>("wip_diff_split", { path, file, staged, full: wipFull });
    wipDiffCtx = { path, file, staged, diff };
    showDiffText(title, diff);
    decorateStageableRows(staged);
    if (!wipFull) decorateHunkRows(staged);
    const wb = $("diffview-whole");
    wb.classList.remove("hidden");
    wb.textContent = wipFull ? "Hunks only" : "Whole file";
  } catch (e) {
    body.innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
    $("diff-minimap").innerHTML = "";
  }
}

// split a unified diff into per-hunk mini-patches (header + one hunk each)
function splitHunkPatches(diff: string): { patch: string; newFile: boolean }[] {
  const lines = diff.split("\n");
  let minus = "";
  let plus = "";
  const hunks: string[][] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith("--- ")) {
      minus = line;
      continue;
    }
    if (line.startsWith("+++ ")) {
      plus = line;
      continue;
    }
    if (line.startsWith("@@")) {
      if (cur) hunks.push(cur);
      cur = [line];
      continue;
    }
    if (
      cur &&
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line.startsWith("\\"))
    ) {
      cur.push(line);
    }
  }
  if (cur) hunks.push(cur);
  if (!minus || !plus) return [];
  const newFile = minus.includes("/dev/null");
  return hunks.map((h) => ({ patch: `${minus}\n${plus}\n${h.join("\n")}\n`, newFile }));
}

// GitKraken-style hunk bars: Stage/Unstage + Discard buttons on every @@ row
function decorateHunkRows(staged: boolean) {
  const c = wipDiffCtx;
  if (!c) return;
  const hunks = splitHunkPatches(c.diff);
  const rows = $("diffview-body").querySelectorAll<HTMLElement>(".dl.hunk");
  rows.forEach((row, i) => {
    const h = hunks[i];
    if (!h) return;
    const btns = document.createElement("span");
    btns.className = "hunk-btns";
    if (!staged) {
      const discard = document.createElement("button");
      discard.className = "mini hunk-discard";
      discard.textContent = "Discard hunk";
      discard.title = "Throw these changes away (working tree) — cannot be undone";
      discard.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!(await confirmModal("Discard this hunk from the working tree?\nThis cannot be undone.")))
          return;
        try {
          await invoke("apply_patch_worktree", { path: c.path, patch: h.patch, reverse: true });
          const scroll = $("diffview-body").scrollTop;
          await afterStageChange();
          setStatus("Hunk discarded");
          await openWipDiff(c.path, c.file, c.staged);
          $("diffview-body").scrollTop = scroll;
        } catch (err) {
          errorModal("Discard failed:\n" + String(err));
        }
      });
      btns.appendChild(discard);
    }
    const stage = document.createElement("button");
    stage.className = "mini hunk-stage";
    stage.textContent = staged ? "Unstage hunk" : "Stage hunk";
    stage.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await invoke("stage_lines_patch", {
          path: c.path,
          patch: h.patch,
          reverse: staged,
          intentFile: h.newFile && !staged ? c.file : null,
        });
        const scroll = $("diffview-body").scrollTop;
        await afterStageChange();
        setStatus(staged ? "Hunk unstaged" : "Hunk staged");
        await openWipDiff(c.path, c.file, c.staged);
        $("diffview-body").scrollTop = scroll;
      } catch (err) {
        errorModal((staged ? "Unstage" : "Stage") + " hunk failed:\n" + String(err));
      }
    });
    btns.appendChild(stage);
    row.appendChild(btns);
  });
}

// add a stage/unstage button to every changed row of the rendered diff
function decorateStageableRows(staged: boolean) {
  const body = $("diffview-body");
  body.querySelectorAll<HTMLElement>(".dl.add, .dl.del").forEach((row) => {
    const kind = row.classList.contains("add") ? "add" : "del";
    // add rows carry their new-side line number, del rows their old-side one
    const lns = row.querySelectorAll(".ln");
    const ln = parseInt((kind === "add" ? lns[1] : lns[0])?.textContent ?? "", 10);
    if (!Number.isFinite(ln)) return;
    row.classList.add("stg");
    const btn = document.createElement("span");
    btn.className = "stg-btn";
    btn.textContent = staged ? "−" : "+";
    btn.title = staged ? "Unstage this line" : "Stage this line";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      stageSingleLine(kind as "add" | "del", ln);
    });
    row.insertBefore(btn, row.firstChild);
  });
}

// Build a minimal patch that stages/unstages ONLY the selected changed line.
// Stage    (index→worktree diff): other + lines dropped, other − lines → context.
// Unstage  (HEAD→index diff, applied in reverse): other + lines → context,
//          other − lines dropped — so the patch's "new" side matches the index.
function buildLinePatch(
  diff: string,
  sel: { kind: "add" | "del"; ln: number },
  forUnstage: boolean
): { patch: string; newFile: boolean } | null {
  const lines = diff.split("\n");
  let minus = "";
  let plus = "";
  let newFile = false;
  let oldN = 0;
  let newN = 0;
  let hunkOldStart = 0;
  let hunkNewStart = 0;
  let cur: string[] = [];
  let oldCnt = 0;
  let newCnt = 0;
  let hasSel = false;
  let done: string | null = null;

  const finishHunk = (): string | null => {
    if (!hasSel || !cur.length) return null;
    const ns = forUnstage ? hunkNewStart : Math.max(hunkOldStart, 1);
    return (
      `@@ -${hunkOldStart},${oldCnt} +${ns},${newCnt} @@\n` + cur.join("\n") + "\n"
    );
  };

  for (const line of lines) {
    if (line === "") continue;
    if (line.startsWith("--- ")) {
      minus = line;
      if (line.includes("/dev/null")) newFile = true;
      continue;
    }
    if (line.startsWith("+++ ")) {
      plus = line;
      continue;
    }
    if (line.startsWith("@@")) {
      done = done ?? finishHunk();
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!m) continue;
      oldN = +m[1];
      newN = +m[2];
      hunkOldStart = oldN;
      hunkNewStart = newN;
      cur = [];
      oldCnt = 0;
      newCnt = 0;
      hasSel = false;
      continue;
    }
    if (!minus || done) continue; // header noise / already built
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("+")) {
      const isSel = sel.kind === "add" && newN === sel.ln;
      newN++;
      if (isSel) {
        cur.push(line);
        newCnt++;
        hasSel = true;
      } else if (forUnstage) {
        cur.push(" " + line.slice(1)); // stays in the index → context
        oldCnt++;
        newCnt++;
      } // else: dropped — not being staged
      continue;
    }
    if (line.startsWith("-")) {
      const isSel = sel.kind === "del" && oldN === sel.ln;
      oldN++;
      if (isSel) {
        cur.push(line);
        oldCnt++;
        hasSel = true;
      } else if (!forUnstage) {
        cur.push(" " + line.slice(1)); // deletion not staged → line stays
        oldCnt++;
        newCnt++;
      } // else: dropped — never made it into the index
      continue;
    }
    cur.push(line); // plain context
    oldCnt++;
    newCnt++;
    oldN++;
    newN++;
  }
  done = done ?? finishHunk();
  if (!done || !minus || !plus) return null;
  return { patch: `${minus}\n${plus}\n${done}`, newFile };
}

async function stageSingleLine(kind: "add" | "del", ln: number) {
  const c = wipDiffCtx;
  if (!c) return;
  const built = buildLinePatch(c.diff, { kind, ln }, c.staged);
  if (!built) return;
  try {
    await invoke("stage_lines_patch", {
      path: c.path,
      patch: built.patch,
      reverse: c.staged,
      intentFile: built.newFile && !c.staged ? c.file : null,
    });
    const scroll = $("diffview-body").scrollTop; // keep the reading position
    await refreshCommitFiles();
    await reloadGraphOnly();
    await openWipDiff(c.path, c.file, c.staged); // re-render with fresh numbers
    $("diffview-body").scrollTop = scroll;
  } catch (e) {
    errorModal((c.staged ? "Unstage" : "Stage") + " line failed:\n" + String(e));
  }
}

// ---- cherry-pick patch builder (single line OR whole hunk) ----
// Works EXACTLY like the staging patch builder: the diff's old side is the
// working tree itself (diff_worktree_to_commit uses -R), so the patch base
// always matches the apply target — no guessing, no drifting line numbers.
// addLns: new-side line numbers to insert; delLns: old-side line numbers to
// remove. A changed line = its del + its add together (replacement).
function buildCpPatch(
  diff: string,
  addLns: number[],
  delLns: number[],
  ctx = 3
): string | null {
  const adds = new Set(addLns);
  const dels = new Set(delLns);
  const lines = diff.split("\n");
  let file = "";
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  let hunkStart = 0;
  let entries: { t: " " | "-" | "+"; text: string }[] = [];
  let selIdxs: number[] = [];

  for (const line of lines) {
    if (line === "") continue;
    if (line.startsWith("+++ ")) {
      // -R diffs swap the prefixes too ("+++ a/…"), so strip either one
      file = line.slice(4).replace(/^[ab]\//, "").trim();
      continue;
    }
    if (line.startsWith("@@")) {
      if (selIdxs.length) break; // hunk with the selections already collected
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!m) continue;
      oldN = +m[1];
      newN = +m[2];
      hunkStart = oldN;
      entries = [];
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      if (adds.has(newN)) {
        selIdxs.push(entries.length);
        entries.push({ t: "+", text: line.slice(1) });
      } // otherwise: not picked, and not in the target file — drop
      newN++;
      continue;
    }
    if (line.startsWith("-")) {
      if (dels.has(oldN)) {
        selIdxs.push(entries.length);
        entries.push({ t: "-", text: line.slice(1) });
      } else {
        entries.push({ t: " ", text: line.slice(1) }); // deletion not picked
      }
      oldN++;
      continue;
    }
    if (line.startsWith(" ")) {
      entries.push({ t: " ", text: line.slice(1) });
      oldN++;
      newN++;
      continue;
    }
    // meta line (diff/index/mode/…): before a hunk only — ignore
  }
  if (!selIdxs.length || !file) return null;

  // trim to ±ctx entries around the whole selection span
  const a = Math.max(0, Math.min(...selIdxs) - ctx);
  const b = Math.min(entries.length, Math.max(...selIdxs) + ctx + 1);
  const win = entries.slice(a, b);
  // old-side offset of the window inside the hunk
  const skippedOld = entries.slice(0, a).filter((e) => e.t !== "+").length;
  const oldCnt = win.filter((e) => e.t !== "+").length;
  const newCnt = win.filter((e) => e.t !== "-").length;
  // "-0,0" means file creation to git — only valid with no context at all
  let oldStart = hunkStart + skippedOld;
  if (oldCnt > 0) oldStart = Math.max(1, oldStart);
  const body = win.map((e) => e.t + e.text).join("\n");
  return (
    `--- a/${file}\n+++ b/${file}\n` +
    `@@ -${oldStart},${oldCnt} +${oldStart},${newCnt} @@\n${body}\n`
  );
}

// ---- interactive cherry-pick view (worktree ⟷ commit, side-by-side) ----
// Built on ONE diff: working tree (left/old) -> commit's file (right/new).
// Every row of both panes comes from the same entry list, so the panes are
// always line-aligned and the numbers shown are the REAL current file lines.
interface DiffEntry {
  t: " " | "+" | "-";
  text: string;
  oldLn: number; // old-side line number (0 for pure adds)
  newLn: number; // new-side line number (0 for pure dels)
}

function parseDiffEntries(diff: string): DiffEntry[] {
  const out: DiffEntry[] = [];
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line === "") continue;
    if (line.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldN = +m[1];
        newN = +m[2];
        inHunk = true;
      }
      continue;
    }
    if (!inHunk || line.startsWith("\\") || line.startsWith("+++") || line.startsWith("---"))
      continue;
    if (line.startsWith("+")) {
      out.push({ t: "+", text: line.slice(1), oldLn: 0, newLn: newN++ });
    } else if (line.startsWith("-")) {
      out.push({ t: "-", text: line.slice(1), oldLn: oldN++, newLn: 0 });
    } else if (line.startsWith(" ")) {
      out.push({ t: " ", text: line.slice(1), oldLn: oldN++, newLn: newN++ });
    }
  }
  return out;
}

let cpOn = false;
function setCpBtn(on: boolean) {
  cpOn = on;
  const b = document.getElementById("diffview-picklines");
  if (b) b.textContent = on ? "✕ Cherry-pick lines" : "Cherry-pick lines";
}
function setPickButtons(visible: boolean) {
  $("diffview-pickfile").classList.toggle("hidden", !visible);
  $("diffview-picklines").classList.toggle("hidden", !visible);
  // text-editing only makes sense for text files
  $("diffview-modify").classList.toggle(
    "hidden",
    !!(diffCtx && isImage(diffCtx.file))
  );
  $("diffview-whole").classList.add("hidden"); // only the WIP views re-show it
  setCpBtn(false);
}

async function doCherryPickFile() {
  if (!diffCtx || !diffCtx.hash) return;
  const { path, file, hash } = diffCtx;
  try {
    const conflict = await invoke<boolean>("cherry_pick_file", { path, hash, file });
    if (conflict) {
      // conflict markers written — bring up the resolver panel
      await reloadActive(`Cherry-pick of ${file} has conflicts — resolve them`);
    } else {
      await afterStageChange();
      setStatus(`Applied ${file} from ${hash.slice(0, 8)} to the working tree`);
    }
  } catch (e) {
    errorModal("Cherry-pick file failed:\n" + String(e));
  }
}

// picks applied in this view; patch is reverse-applied to undo
interface CpApplied {
  patch: string;
  texts: string[]; // resulting line texts (empty for pure deletions)
  ln: number; // approx worktree line after apply (for re-finding the rows)
  kind: "add" | "del" | "hunk";
}

let cpCtx: {
  path: string;
  file: string;
  hash: string;
  diff: string; // worktree -> commit, full context (-R)
  cAdd: Map<string, number>; // lines the commit itself ADDED (multiset)
  cDel: Map<string, number>; // lines the commit itself DELETED (multiset)
  applied: CpApplied[];
} | null = null;

async function toggleCherryPickLines() {
  if (!diffCtx || !diffCtx.hash) return;
  if (cpOn) {
    cpCtx = null;
    lastView?.(); // back to the normal diff
    return;
  }
  const { path, file, hash } = diffCtx;
  const body = $("diffview-body");
  body.innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  try {
    const [wtDiff, commitDiff] = await Promise.all([
      invoke<string>("diff_worktree_to_commit", { path, hash, file }),
      invoke<string>("commit_diff", { path, hash, file }),
    ]);
    // what the commit actually changed — used to tell its changes apart from
    // unrelated local edits (those show purple and are not pickable)
    const cAdd = new Map<string, number>();
    const cDel = new Map<string, number>();
    for (const e of parseDiffEntries(commitDiff)) {
      if (e.t === "+") cAdd.set(e.text, (cAdd.get(e.text) ?? 0) + 1);
      else if (e.t === "-") cDel.set(e.text, (cDel.get(e.text) ?? 0) + 1);
    }
    cpCtx = { path, file, hash, diff: wtDiff, cAdd, cDel, applied: [] };
    setCpBtn(true);
    setBlameBtn(false);
    $("diffview-title").textContent =
      `Cherry-pick lines · ${file} — ${hash.slice(0, 8)} → working tree`;
    body.innerHTML =
      `<div id="cp-cols">` +
      `<span class="cp-gut"></span>` +
      `<span class="cp-col-ln"></span><span class="cp-col">Working tree — current file</span>` +
      `<span class="cp-col-ln"></span><span class="cp-col">Commit ${hash.slice(0, 8)} — click a line, or ⇣ for the whole block</span>` +
      `</div>` +
      `<div id="cp-scroll"></div>`;
    renderCpRows();
  } catch (e) {
    body.innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
    $("diff-minimap").innerHTML = "";
  }
}

// re-fetch the worktree diff (after any apply/revert/move) and re-render —
// numbers always reflect the CURRENT file, so picks can never go stale
async function refreshCpDiff() {
  if (!cpCtx) return;
  const scrollEl = document.getElementById("cp-scroll");
  const scroll = scrollEl ? scrollEl.scrollTop : 0;
  try {
    cpCtx.diff = await invoke<string>("diff_worktree_to_commit", {
      path: cpCtx.path,
      hash: cpCtx.hash,
      file: cpCtx.file,
    });
  } catch {
    /* keep the old diff; next action re-tries */
  }
  renderCpRows();
  const el = document.getElementById("cp-scroll");
  if (el) el.scrollTop = scroll;
}

async function cpApplyPatch(patch: string): Promise<boolean> {
  if (!cpCtx) return false;
  try {
    await invoke("apply_patch_worktree", { path: cpCtx.path, patch });
    await afterStageChange();
    return true;
  } catch (e) {
    errorModal("Could not apply this change:\n" + String(e));
    return false;
  }
}

async function cpRevert(a: CpApplied): Promise<void> {
  if (!cpCtx) return;
  try {
    await invoke("apply_patch_worktree", { path: cpCtx.path, patch: a.patch, reverse: true });
    cpCtx.applied = cpCtx.applied.filter((x) => x !== a);
    await afterStageChange();
    setStatus("Line pick reverted");
    await refreshCpDiff();
  } catch (e) {
    errorModal("Could not revert — the file changed here since:\n" + String(e));
  }
}

function renderCpRows() {
  const c = cpCtx;
  const scrollEl = document.getElementById("cp-scroll");
  if (!c || !scrollEl) return;
  const cpLang = langForFile(c.file);
  const entries = parseDiffEntries(c.diff);

  // classify each change: part of the commit (pickable) or a local-only edit
  // (purple). Multisets are consumed so duplicated lines count correctly.
  const availAdd = new Map(c.cAdd);
  const availDel = new Map(c.cDel);
  const take = (m: Map<string, number>, t: string): boolean => {
    const n = m.get(t) ?? 0;
    if (n <= 0) return false;
    m.set(t, n - 1);
    return true;
  };

  interface Cell {
    ln: number;
    text: string;
    pick: boolean;
  }
  interface Row {
    kind: "ctx" | "change";
    l?: Cell; // worktree side
    r?: Cell; // commit side
  }
  const rows: Row[] = [];
  let delBuf: Cell[] = [];
  let addBuf: Cell[] = [];
  const flush = () => {
    const n = Math.max(delBuf.length, addBuf.length);
    for (let i = 0; i < n; i++) rows.push({ kind: "change", l: delBuf[i], r: addBuf[i] });
    delBuf = [];
    addBuf = [];
  };
  let lastOldLn = 0;
  for (const e of entries) {
    if (e.t === " ") {
      flush();
      rows.push({
        kind: "ctx",
        l: { ln: e.oldLn, text: e.text, pick: false },
        r: { ln: e.newLn, text: e.text, pick: false },
      });
      lastOldLn = e.oldLn;
    } else if (e.t === "-") {
      if (addBuf.length) flush();
      delBuf.push({ ln: e.oldLn, text: e.text, pick: take(availDel, e.text) });
      lastOldLn = e.oldLn;
    } else {
      addBuf.push({ ln: e.newLn, text: e.text, pick: take(availAdd, e.text) });
    }
  }
  flush();
  const fileLines = lastOldLn; // current worktree length (old side)

  // marks for picks already applied: they became context rows — re-find them
  // by text near the recorded line so they stay green + revertable
  const markOf = new Map<number, CpApplied>(); // row index -> applied pick
  for (const a of c.applied) {
    a.texts.forEach((t, ti) => {
      let best = -1;
      let bestDist = 30;
      rows.forEach((row, i) => {
        if (row.kind !== "ctx" || !row.l || row.l.text !== t || markOf.has(i)) return;
        const dist = Math.abs(row.l.ln - a.ln);
        if (dist < bestDist) {
          best = i;
          bestDist = dist;
        }
      });
      if (best >= 0) {
        markOf.set(best, a);
        if (ti === 0) a.ln = rows[best].l!.ln; // self-heal recorded position
      }
    });
  }

  // group consecutive unapplied change rows into blocks ("hunks") — a gutter
  // button on the first row picks the whole block at once
  interface Grp {
    adds: number[];
    dels: number[];
    texts: string[];
    rowIdxs: number[];
  }
  const grpFirst = new Map<number, Grp>();
  {
    let cur: Grp | null = null;
    rows.forEach((row, i) => {
      if (row.kind === "change" && !markOf.has(i)) {
        if (!cur) {
          cur = { adds: [], dels: [], texts: [], rowIdxs: [] };
        }
        cur.rowIdxs.push(i);
        if (row.r?.pick) {
          cur.adds.push(row.r.ln);
          cur.texts.push(row.r.text);
          if (row.l) cur.dels.push(row.l.ln); // replacement includes the old line
        } else if (!row.r && row.l?.pick) {
          cur.dels.push(row.l.ln);
        }
      } else {
        if (cur && cur.adds.length + cur.dels.length >= 2)
          grpFirst.set(cur.rowIdxs[0], cur);
        cur = null;
      }
    });
    if (cur !== null) {
      const g: Grp = cur;
      if (g.adds.length + g.dels.length >= 2) grpFirst.set(g.rowIdxs[0], g);
    }
  }

  scrollEl.innerHTML = "";
  let dragging: CpApplied | null = null;

  rows.forEach((row, i) => {
    const el = document.createElement("div");
    const mark = markOf.get(i);
    const pickable = (row.r?.pick || (!row.r && row.l?.pick)) ?? false;
    const localOnly = row.kind === "change" && !pickable;
    el.className =
      "cprow " +
      (row.kind === "change" ? "change" : "ctx") +
      (mark ? " cp-done" : "") +
      (localOnly ? " cp-local" : "");
    const cell = (c2: Cell | undefined, side: "l" | "r"): string => {
      if (!c2)
        return `<span class="ln"></span><span class="cpc ${side} empty"></span>`;
      const cls =
        row.kind === "ctx"
          ? "ctx"
          : side === "l"
            ? c2.pick
              ? "del"
              : "loc"
            : c2.pick
              ? "add"
              : "loc";
      return (
        `<span class="ln">${c2.ln || ""}</span>` +
        `<span class="cpc ${side} ${cls}">${hlLine(c2.text, cpLang)}</span>`
      );
    };
    el.innerHTML = cell(row.l, "l") + cell(row.r, "r");

    // gutter: hunk button on the first row of a multi-change block
    const gut = document.createElement("span");
    gut.className = "cp-gut";
    const g = grpFirst.get(i);
    if (g) {
      const btn = document.createElement("button");
      btn.className = "cp-hunk-btn";
      btn.textContent = "⇣";
      btn.title = `Cherry-pick this whole block — ${g.adds.length + g.dels.length} change(s)`;
      btn.addEventListener("mouseenter", () =>
        g.rowIdxs.forEach((ri) => scrollEl.children[ri]?.classList.add("cp-grp"))
      );
      btn.addEventListener("mouseleave", () =>
        g.rowIdxs.forEach((ri) => scrollEl.children[ri]?.classList.remove("cp-grp"))
      );
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const patch = buildCpPatch(c.diff, g.adds, g.dels);
        if (!patch) return;
        if (!(await cpApplyPatch(patch))) return;
        c.applied.push({
          patch,
          texts: g.texts,
          ln: rows[g.rowIdxs[0]].l?.ln ?? lastOldLnBefore(rows, g.rowIdxs[0]) + 1,
          kind: "hunk",
        });
        setStatus(`Block applied — ${g.adds.length + g.dels.length} change(s)`);
        await refreshCpDiff();
      });
      gut.appendChild(btn);
    }
    el.prepend(gut);

    if (mark) {
      el.title =
        mark.kind === "hunk"
          ? "Picked ✓ (block) — click to revert the whole block"
          : "Picked ✓ — click to revert, drag to move";
      el.addEventListener("click", () => void cpRevert(mark));
      // drag a picked line somewhere else if the position is wrong (single
      // lines only — a block has no single position)
      if (mark.kind !== "hunk") {
        el.draggable = true;
        el.addEventListener("dragstart", (ev) => {
          dragging = mark;
          el.classList.add("cp-dragging");
          if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = "move";
            ev.dataTransfer.setData("text/plain", mark.texts[0] ?? "");
          }
        });
        el.addEventListener("dragend", () => {
          dragging = null;
          el.classList.remove("cp-dragging");
          scrollEl.querySelectorAll(".cp-ins").forEach((x) => x.classList.remove("cp-ins"));
        });
      }
    } else if (row.kind === "change") {
      if (pickable) {
        const isReplace = !!(row.l && row.r);
        el.title = isReplace
          ? `Click to replace line ${row.l!.ln} with the commit's version (click again to revert)`
          : row.r
            ? "Click to insert this line from the commit (click again to revert)"
            : `Click to remove line ${row.l!.ln} (commit deleted it)`;
        el.addEventListener("click", async () => {
          const addLns = row.r ? [row.r.ln] : [];
          const delLns = row.l && (row.r || row.l.pick) ? [row.l.ln] : [];
          const patch = buildCpPatch(c.diff, addLns, delLns);
          if (!patch) return;
          if (!(await cpApplyPatch(patch))) return;
          c.applied.push({
            patch,
            texts: row.r ? [row.r.text] : [],
            ln: row.l?.ln ?? lastOldLnBefore(rows, i) + 1,
            kind: row.r ? "add" : "del",
          });
          setStatus(
            row.r && row.l
              ? `Line ${row.l.ln} replaced with the commit's version`
              : row.r
                ? "Line inserted from the commit"
                : `Line ${row.l!.ln} removed`
          );
          await refreshCpDiff();
        });
      } else {
        el.title = "Local change — not part of this commit, nothing to pick";
        el.addEventListener("click", () =>
          setStatus("This is a local change — not part of this commit")
        );
      }
    }

    // drop target for dragged picked lines (needs a real worktree line)
    el.addEventListener("dragover", (ev) => {
      if (!dragging || !row.l) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      scrollEl.querySelectorAll(".cp-ins").forEach((x) => x.classList.remove("cp-ins"));
      el.classList.add("cp-ins");
    });
    el.addEventListener("drop", async (ev) => {
      if (!dragging || !row.l) return;
      ev.preventDefault();
      ev.stopPropagation();
      const m = dragging;
      dragging = null;
      const from = m.ln - 1;
      const to = row.l.ln - 1;
      if (to === from || to === from + 1) return;
      try {
        await invoke("move_line", { path: c.path, file: c.file, from, to });
        m.ln = (to > from ? to - 1 : to) + 1;
        await afterStageChange();
        setStatus("Line moved");
        await refreshCpDiff();
      } catch (e) {
        errorModal("Move failed:\n" + String(e));
      }
    });

    scrollEl.appendChild(el);
  });
  if (!rows.length)
    scrollEl.innerHTML = `<div class="cprow ctx"><span class="ln"></span><span class="cpc l ctx">(no differences — the working tree already matches this commit's file)</span></div>`;

  // minimap: green/red = pickable changes, purple = local-only, bright = done
  const mapEl = $("diff-minimap");
  mapEl.innerHTML = "";
  const total = rows.length || 1;
  rows.forEach((row, i) => {
    let kind = "";
    if (markOf.has(i)) kind = "done";
    else if (row.kind !== "change") return;
    else if (!(row.r?.pick || (!row.r && row.l?.pick))) kind = "dup";
    else kind = row.r ? "add" : "del";
    const mark = document.createElement("div");
    mark.className = `mm ${kind}`;
    mark.style.top = `${(i / total) * 100}%`;
    mark.addEventListener("click", () => {
      scrollEl.scrollTop = (i / total) * scrollEl.scrollHeight - scrollEl.clientHeight / 2;
    });
    mapEl.appendChild(mark);
  });
  void fileLines;
}

// worktree line number of the last real line above row i (insert position)
function lastOldLnBefore(rows: { l?: { ln: number } }[], i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    const l = rows[j].l;
    if (l && l.ln) return l.ln;
  }
  return 0;
}

// show an image change as before/after previews
async function showImageDiff(
  title: string,
  path: string,
  file: string,
  hash: string | null
) {
  await showImageRevs(title, path, file, hash ? `${hash}^` : "HEAD", hash ?? "");
}

async function showImageRevs(
  title: string,
  path: string,
  file: string,
  oldRev: string,
  newRev: string
) {
  $("diffview-title").textContent = title;
  $("diff-minimap").innerHTML = "";
  const body = $("diffview-body");
  body.innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  showDiffView(true);
  const [oldUrl, newUrl] = await Promise.all([
    invoke<string>("blob_data_url", { path, rev: oldRev, file }).catch(() => ""),
    invoke<string>("blob_data_url", { path, rev: newRev, file }).catch(() => ""),
  ]);

  const pane = (label: string, url: string, cls: string) =>
    `<div class="imgpane">` +
    `<div class="imglabel ${cls}">${label}</div>` +
    `<div class="imgwrap"><img src="${url}" alt="${escapeHtml(label)}"/></div>` +
    `</div>`;

  let html = "";
  if (oldUrl && newUrl) {
    html = pane("Before", oldUrl, "del") + pane("After", newUrl, "add");
  } else if (newUrl) {
    html = pane("Added", newUrl, "add");
  } else if (oldUrl) {
    html = pane("Deleted", oldUrl, "del");
  } else {
    html = `<div class='dl ctx'><span class='dc'>(no image data)</span></div>`;
  }
  body.innerHTML = `<div class="imgdiff">${html}</div>`;
}

// show files that differ between a commit and the working tree, as a list;
// click a file for its own diff (split per file, not one giant blob)
async function compareCommitToWorking(path: string, hash: string) {
  const sha = hash.slice(0, 8);
  $("detail").classList.remove("collapsed");
  $("detail-empty").classList.add("hidden");
  $("commit-panel").classList.add("hidden");
  $("conflict-panel").classList.add("hidden");
  $("detail-body").classList.remove("hidden");
  showDiffView(false);
  $("d-summary").textContent = `Compare ${sha} ↔ working directory`;
  $("d-meta").innerHTML = `<div>files that differ between this commit and your working tree</div>`;
  const ul = $("d-files");
  ul.innerHTML = "<li class='muted'>loading…</li>";
  try {
    const files = await invoke<FileChange[]>("compare_files", { path, hash });
    ul.innerHTML = "";
    if (!files.length) ul.innerHTML = "<li class='muted'>(no differences)</li>";
    files.forEach((f) => {
      const li = document.createElement("li");
      const s = f.status.charAt(0).toUpperCase();
      const cls = s === "?" ? "Q" : s;
      li.innerHTML = `<span class="fstatus ${cls}">${s}</span><span>${escapeHtml(f.path)}</span>`;
      li.addEventListener("click", () => {
        ul.querySelectorAll("li").forEach((x) => x.classList.remove("selected"));
        li.classList.add("selected");
        openCompareDiff(path, hash, f.path);
      });
      ul.appendChild(li);
    });
  } catch (e) {
    ul.innerHTML = `<li class='muted'>${escapeHtml(String(e))}</li>`;
  }
}

// one file's diff between a commit and the working tree
async function openCompareDiff(path: string, hash: string, file: string) {
  diffCtx = { path, file, hash };
  lastView = () => openCompareDiff(path, hash, file);
  setBlameBtn(false);
  setPlainBtn(false);
  setEditBtn(false);
  setPickButtons(false);
  const title = `${file} — ${hash.slice(0, 8)} ↔ working`;
  if (isImage(file)) {
    await showImageRevs(title, path, file, hash, ""); // old=commit, new=working
    return;
  }
  $("diffview-title").textContent = title;
  $("diffview-body").innerHTML = "<div class='dl ctx'><span class='dc'>loading…</span></div>";
  showDiffView(true);
  try {
    const diff = await invoke<string>("diff_against_working", { path, hash, file });
    showDiffText(title, diff);
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
  const contentH = body.scrollHeight || 1;
  if (!total) return;
  for (let i = 0; i < total; i++) {
    const el = rows[i] as HTMLElement;
    const kind = el.classList.contains("add")
      ? "add"
      : el.classList.contains("del")
        ? "del"
        : "";
    if (!kind) continue;
    // position by the row's REAL pixel offset, not its index — hunk headers
    // and other rows aren't uniform height, so index fractions drift
    const top = el.offsetTop;
    const mark = document.createElement("div");
    mark.className = `mm ${kind}`;
    mark.style.top = `${(top / contentH) * 100}%`;
    mark.addEventListener("click", () => {
      body.scrollTop = top - body.clientHeight / 2;
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
    errorModal(String(e));
  }
}
async function doUnstage(file: string) {
  const t = cur();
  if (!t) return;
  try {
    await invoke("unstage_file", { path: t.repo.path, file });
    await afterStageChange();
  } catch (e) {
    errorModal(String(e));
  }
}
async function doStageAll() {
  const t = cur();
  if (!t) return;
  try {
    await invoke("stage_all", { path: t.repo.path });
    await afterStageChange();
  } catch (e) {
    errorModal(String(e));
  }
}
async function doUnstageAll() {
  const t = cur();
  if (!t) return;
  try {
    await invoke("unstage_all", { path: t.repo.path });
    await afterStageChange();
  } catch (e) {
    errorModal(String(e));
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
  pushBusy();
  try {
    await invoke("commit", { path: t.repo.path, message, amend });
    ($("c-summary") as HTMLInputElement).value = "";
    ($("c-desc") as HTMLTextAreaElement).value = "";
    ($("c-amend") as HTMLInputElement).checked = false;
    await reloadActive("Committed");
  } catch (e) {
    errorModal("Commit failed:\n" + String(e));
  } finally {
    popBusy();
  }
}

// reload repo data + graph/sidebar, but DON'T touch the detail/commit panel
async function reloadGraphOnly() {
  const t = cur();
  if (!t) return;
  try {
    const repo = await invoke<RepoData>("open_repo", { path: t.repo.path });
    t.repo = repo;
    t.nodes = buildNodes(repo, t.hidden);
    renderSidebar(t);
    renderGraph(t);
    saveRepoCache(t.repo.path, repo);
    t.fingerprint = repo.fingerprint; // included in open_repo — no extra call
  } catch (e) {
    console.warn("graph reload failed", String(e));
  }
}

// quietly fetch in the background so pushes from elsewhere show up; the
// fingerprint poll then detects the updated remote refs and reloads.
let autoFetching = false;
async function autoFetch() {
  const t = cur();
  if (!t || autoFetching || isBusy() || t.repo.conflict.active) return;
  autoFetching = true;
  try {
    await invoke("fetch", { path: t.repo.path });
  } catch {
    /* offline / no remote / auth — ignore */
  } finally {
    autoFetching = false;
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
    await checkOpenFileChanged(); // content edits don't move the fingerprint
    const fp = await invoke<string>("repo_fingerprint", { path: t.repo.path });
    if (t.fingerprint === undefined) {
      t.fingerprint = fp; // first sight: baseline, don't reload
    } else if (fp !== t.fingerprint) {
      t.fingerprint = fp;
      await reloadGraphOnly();
      if (t.selected === WIP_ID) await refreshCommitFiles();
      await refreshOpenFileView(); // the open file may have changed on disk
    }
  } catch {
    /* repo gone/locked — ignore this tick */
  } finally {
    polling = false;
  }
}

// The repo fingerprint is status-based, so it does NOT move when an already
// modified file is edited again (" M file" either way). Watch the open file's
// own mtime+size so those edits still refresh the view.
let openFileStamp = "";
async function checkOpenFileChanged() {
  if (!diffCtx || $("diffview").classList.contains("hidden")) return;
  if (editOn || isBusy()) return;
  // only working-tree content can change under us (commit blobs are immutable)
  if (!cpOn && diffCtx.hash) return;
  let stamp: string;
  try {
    stamp = await invoke<string>("file_stamp", {
      path: diffCtx.path,
      file: diffCtx.file,
    });
  } catch {
    return; // file deleted / unreadable — leave the view alone
  }
  const tagged = `${diffCtx.path} ${diffCtx.file} ${stamp}`;
  if (!openFileStamp) {
    openFileStamp = tagged; // first sight: baseline, don't refresh
    return;
  }
  if (openFileStamp !== tagged) {
    openFileStamp = tagged;
    await refreshOpenFileView();
  }
}

// A file view showing WORKING-TREE content can go stale when the file changes
// behind our back (your editor, a build script, another git tool). Re-render it
// when the repo fingerprint moves — but never destroy in-progress user state.
async function refreshOpenFileView() {
  if ($("diffview").classList.contains("hidden")) return; // no file view open
  if (editOn) return; // mid-edit: refreshing would throw away the typing
  if (isBusy()) return; // an action is mid-flight; it refreshes on its own
  const body = $("diffview-body");
  const scroll = body.scrollTop;

  if (cpOn) {
    // cherry-pick split compares against the worktree, so it must follow along
    await refreshCpDiff();
  } else if (!diffCtx || diffCtx.hash) {
    return; // committed blobs are immutable — nothing to refresh
  } else if (plainOn) {
    await renderPlainView();
  } else if (blameOn) {
    await showBlame();
  } else if (wipDiffCtx) {
    await openWipDiff(wipDiffCtx.path, wipDiffCtx.file, wipDiffCtx.staged);
  } else {
    await lastView?.();
  }
  body.scrollTop = scroll; // stay where the user was reading
}

// enable/disable + tooltip the top toolbar based on repo state
function setToolbar(repo: RepoData | null) {
  const set = (id: string, disabled: boolean, title?: string) => {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (!b) return; // button may not exist
    b.disabled = disabled;
    if (title !== undefined) b.title = title;
  };
  if (!repo) {
    ["fetch-btn", "pull-btn", "push-btn", "branch-btn", "stash-btn", "terminal-btn"].forEach(
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
  set("terminal-btn", false);
  if (isBusy()) applyBusy(); // keep greyed while an action runs
}

// ---- reload / write operations ----
async function reloadActive(statusMsg?: string) {
  const t = cur();
  if (!t) return;
  try {
    const repo = await invoke<RepoData>("open_repo", { path: t.repo.path });
    t.repo = repo;
    t.stale = false;
    t.nodes = buildNodes(repo, t.hidden);
    if (t.selected && !t.nodes.find((n) => n.id === t.selected)) {
      t.selected = repo.head || (repo.wip ? WIP_ID : null);
    }
    saveRepoCache(t.repo.path, repo);
    t.fingerprint = repo.fingerprint; // included in open_repo — no extra call
    renderActive();
    if (statusMsg) setStatus(statusMsg);
    refreshRemoteTags(t);
  } catch (e) {
    errorModal("Reload failed:\n" + String(e));
  }
}

// double-click checkout: confirm first if there are uncommitted changes
async function doCheckoutConfirm(t: Tab, target: string, upstream?: string) {
  if (t.repo.wip) {
    const ok = await confirmModal(
      `Checkout ${target}? Uncommitted changes will be stashed.`
    );
    if (!ok) return;
  }
  doCheckout(target, upstream);
}

// right-click on a repo (tab / path) -> open it externally
function repoMenu(path: string): MenuItem[] {
  return [
    {
      label: "Open in File Explorer",
      action: () => invoke("open_in_explorer", { path }).catch((e) => errorModal(String(e))),
    },
    {
      label: "Open in VS Code",
      action: () =>
        invoke("open_in_vscode", { path }).catch(() =>
          errorModal("Could not launch VS Code — is 'code' on your PATH?")
        ),
    },
    {
      label: "Open Terminal here",
      action: () => invoke("open_terminal", { path }).catch((e) => errorModal(String(e))),
    },
    chatEnabled(path)
      ? {
          label: "Disable Chat",
          action: () => setChatEnabled(path, false),
        }
      : {
          label: "Enable Chat…",
          action: async () => {
            const ok = await confirmModal(
              "Enable repo chat?\n\nMessages are stored on a hidden git ref (refs/jkt-chat/main) and pushed to origin — everyone with repo access who ALSO enables chat can read and write them. Nothing is fetched or pushed unless enabled."
            );
            if (ok) setChatEnabled(path, true);
          },
        },
  ];
}

// ---- per-repo chat (STRICTLY opt-in: no UI, no fetches, no refs unless
// the user enabled it for this repo) ----
const chatKey = (path: string) => `jkt.chat:${path}`;
const chatSeenKey = (path: string) => `jkt.chatseen:${path}`;
const chatEnabled = (path: string): boolean =>
  localStorage.getItem(chatKey(path)) === "1";
function setChatEnabled(path: string, on: boolean) {
  try {
    if (on) localStorage.setItem(chatKey(path), "1");
    else {
      localStorage.removeItem(chatKey(path));
      localStorage.removeItem(chatSeenKey(path));
    }
  } catch {}
  if (!on) showChatPanel(false);
  chatMsgs = [];
  updateChatButton();
  if (on) void chatPoll(true);
  setStatus(on ? "Chat enabled for this repo" : "Chat disabled for this repo");
}

interface ChatMsg {
  hash: string;
  author: string;
  email: string;
  time: number;
  text: string;
}
let chatMsgs: ChatMsg[] = [];
let chatOpen = false;
let chatPolling = false;
const chatCache = new Map<string, ChatMsg[]>(); // per repo path

// keep the chat state in step with the active tab
function syncChatToTab() {
  const t = cur();
  chatMsgs = t ? (chatCache.get(t.repo.path) ?? []) : [];
  updateChatButton();
  if (chatOpen) {
    if (t && chatEnabled(t.repo.path)) {
      renderChatMsgs();
      void chatPoll(true);
    } else {
      showChatPanel(false);
    }
  }
}

function updateChatButton() {
  const t = cur();
  const on = !!t && chatEnabled(t.repo.path);
  $("chat-btn").classList.toggle("hidden", !on);
  if (!on) showChatPanel(false);
  updateChatUnread();
}

function updateChatUnread() {
  const t = cur();
  const badge = $("chat-unread");
  if (!t || !chatEnabled(t.repo.path) || !chatMsgs.length) {
    badge.classList.add("hidden");
    return;
  }
  const seen = localStorage.getItem(chatSeenKey(t.repo.path)) ?? "";
  const idx = chatMsgs.findIndex((m) => m.hash === seen);
  const unread = idx === -1 ? chatMsgs.length : chatMsgs.length - 1 - idx;
  badge.textContent = String(unread);
  badge.classList.toggle("hidden", unread === 0 || chatOpen);
}

function markChatSeen() {
  const t = cur();
  if (!t || !chatMsgs.length) return;
  try {
    localStorage.setItem(chatSeenKey(t.repo.path), chatMsgs[chatMsgs.length - 1].hash);
  } catch {}
  updateChatUnread();
}

function showChatPanel(on: boolean) {
  chatOpen = on;
  $("chat-panel").classList.toggle("hidden", !on);
  if (on) {
    renderChatMsgs();
    markChatSeen();
    ($("chat-input") as HTMLInputElement).focus();
    void chatPoll(true);
  }
}

function renderChatMsgs() {
  const t = cur();
  if (!t) return;
  $("chat-title").textContent = `Chat — ${basename(t.repo.path)}`;
  const box = $("chat-msgs");
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  box.innerHTML = "";
  if (!chatMsgs.length) {
    box.innerHTML = `<div class="chat-empty">No messages yet — say hi. Messages sync via origin (hidden ref), so teammates see them after their next chat fetch.</div>`;
  }
  for (const m of chatMsgs) {
    const row = document.createElement("div");
    row.className = "chat-msg";
    row.innerHTML =
      `<img class="chat-av" src="${avatarFor(m.email, m.author)}" alt=""/>` +
      `<div class="chat-body"><div class="chat-meta">` +
      `<span class="chat-author">${escapeHtml(m.author)}</span>` +
      `<span class="chat-time">${fmtDate(m.time)}</span></div>` +
      `<div class="chat-text">${escapeHtml(m.text)}</div></div>`;
    box.appendChild(row);
  }
  if (atBottom || true) box.scrollTop = box.scrollHeight; // keep pinned to newest
}

// fetch messages for the ACTIVE repo — only ever called when chat is enabled
async function chatPoll(force = false) {
  const t = cur();
  if (!t || !chatEnabled(t.repo.path) || chatPolling) return;
  if (!force && (isBusy() || t.repo.conflict.active)) return;
  chatPolling = true;
  const path = t.repo.path;
  try {
    const msgs = await invoke<ChatMsg[]>("chat_pull", { path });
    chatCache.set(path, msgs);
    if (cur()?.repo.path !== path) return; // tab switched meanwhile
    const changed =
      msgs.length !== chatMsgs.length ||
      (msgs.length &&
        chatMsgs.length &&
        msgs[msgs.length - 1].hash !== chatMsgs[chatMsgs.length - 1].hash);
    chatMsgs = msgs;
    if (changed && chatOpen) {
      renderChatMsgs();
      markChatSeen();
    }
    updateChatUnread();
  } catch {
    /* offline / no origin — try again next tick */
  } finally {
    chatPolling = false;
  }
}

async function chatSendCurrent() {
  const t = cur();
  if (!t || !chatEnabled(t.repo.path)) return;
  const input = $("chat-input") as HTMLInputElement;
  const text = input.value.trim();
  if (!text) return;
  const btn = $("chat-send") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    chatMsgs = await invoke<ChatMsg[]>("chat_send", { path: t.repo.path, text });
    chatCache.set(t.repo.path, chatMsgs);
    input.value = "";
    renderChatMsgs();
    markChatSeen();
  } catch (e) {
    errorModal(
      "Could not send — do you have push access to origin?\n" + String(e)
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "Send";
  }
}

async function doCheckout(target: string, upstream?: string) {
  const t = cur();
  if (!t) return;
  setStatus(`checking out ${target}…`);
  pushBusy();
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
    errorModal("Checkout failed:\n" + String(e));
  } finally {
    popBusy();
  }
}

async function doFetch() {
  const t = cur();
  if (!t) return;
  setStatus("fetching…");
  pushBusy("fetch-btn");
  try {
    await invoke<string>("fetch", { path: t.repo.path });
    await reloadActive("Fetched");
  } catch (e) {
    setStatus("");
    errorModal("Fetch failed:\n" + String(e));
  } finally {
    popBusy();
  }
}

async function doPull() {
  const t = cur();
  if (!t) return;
  setStatus("pulling…");
  runAction(invoke("pull", { path: t.repo.path }), "Pulled", "pull-btn");
}
async function doPush() {
  const t = cur();
  if (!t) return;
  setStatus("pushing…");
  pushBusy("push-btn");
  try {
    const msg = await invoke<string>("push", { path: t.repo.path });
    await reloadActive(msg);
  } catch (e) {
    setStatus("");
    errorModal("Push failed:\n" + String(e));
  } finally {
    popBusy();
  }
}
async function doBranch() {
  const t = cur();
  if (!t) return;
  const name = await promptModal("New branch name", "feature/my-branch");
  if (name)
    runAction(
      invoke("create_branch_checkout", { path: t.repo.path, name }),
      `Created & switched to ${name}`,
      "branch-btn"
    );
}
async function doStashBtn() {
  const t = cur();
  if (!t) return;
  runAction(invoke("stash_push", { path: t.repo.path }), "Stashed changes", "stash-btn");
}
async function doTerminal() {
  const t = cur();
  if (!t) return;
  try {
    await invoke("open_terminal", { path: t.repo.path });
  } catch (e) {
    errorModal("Open terminal failed:\n" + String(e));
  }
}

// ---- context menu ----
interface MenuItem {
  label?: string;
  action?: () => void;
  separator?: boolean;
  checked?: boolean; // renders a tick column; undefined = plain item
  keepOpen?: boolean; // toggles stay open so several can be flipped at once
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
    // a menu with any checkable item reserves a tick column so labels align
    if (items.some((m) => m.checked !== undefined)) {
      row.classList.add("checkable");
      row.innerHTML =
        `<span class="ctxtick">${it.checked ? "✓" : ""}</span>` +
        `<span>${escapeHtml(it.label ?? "")}</span>`;
    } else {
      row.textContent = it.label ?? "";
    }
    row.addEventListener("click", (e) => {
      if (it.keepOpen) {
        e.stopPropagation();
        it.action?.();
        return;
      }
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

// ---- busy state: grey toolbar + spinner while a git action runs ----
let busyCount = 0;
let loadingBtn: string | null = null;
const TOOLBAR_BTNS = ["fetch-btn", "pull-btn", "push-btn", "branch-btn", "stash-btn", "terminal-btn"];
const isBusy = () => busyCount > 0;
function applyBusy() {
  for (const id of TOOLBAR_BTNS) {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (b) b.disabled = true;
  }
}
function pushBusy(btnId?: string) {
  busyCount++;
  if (btnId && !loadingBtn) {
    loadingBtn = btnId;
    document.getElementById(btnId)?.classList.add("loading");
  }
  applyBusy();
}
function popBusy() {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount === 0) {
    if (loadingBtn) {
      document.getElementById(loadingBtn)?.classList.remove("loading");
      loadingBtn = null;
    }
    const t = cur();
    setToolbar(t ? t.repo : null); // restore proper enabled/disabled states
  }
}

// run a mutating git action, then refresh the graph
async function runAction(p: Promise<unknown>, okMsg: string, btnId?: string) {
  pushBusy(btnId);
  try {
    const stashed = await p;
    await reloadActive(stashed === true ? `${okMsg} (changes stashed)` : okMsg);
  } catch (e) {
    setStatus("");
    errorModal(`${okMsg} failed:\n${String(e)}`);
  } finally {
    popBusy();
  }
}

function errorModal(msg: string) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    `<div class="modal error-modal">` +
    `<div class="error-head"><span class="error-bang">!</span><span>Something went wrong</span></div>` +
    `<pre class="error-msg">${escapeHtml(msg)}</pre>` +
    `<div class="modal-btns"><button class="modal-ok">OK</button></div>` +
    `</div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const ok = overlay.querySelector(".modal-ok") as HTMLButtonElement | null;
  ok?.addEventListener("click", close);
  ok?.focus();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
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
  if (name)
    runAction(
      invoke("create_branch", { path, name, start }),
      `Created & switched to ${name}`
    );
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

  // tags get their own menu (push/delete to/from remote)
  if (isTag) {
    const onRemote = (cur()?.remoteTags ?? new Set()).has(r.name);
    items.push({ label: `Checkout tag ${r.name}`, action: () => doCheckout(r.name) });
    items.push({ separator: true });
    if (!onRemote) {
      items.push({
        label: `Push tag ${r.name} to origin`,
        action: () => runAction(invoke("push_tag", { path, name: r.name }), `Pushed tag ${r.name}`),
      });
    } else {
      items.push({ label: `✓ on origin` });
    }
    items.push({
      label: `Delete tag ${r.name} (local)`,
      action: async () => {
        if (await confirmModal(`Delete local tag ${r.name}?`))
          runAction(invoke("delete_tag", { path, name: r.name }), `Deleted tag ${r.name}`);
      },
    });
    if (onRemote) {
      items.push({
        label: `Delete tag ${r.name} on origin`,
        action: async () => {
          if (await confirmModal(`Delete tag ${r.name} on origin?`))
            runAction(invoke("delete_remote_tag", { path, name: r.name }), `Deleted ${r.name} on origin`);
        },
      });
    }
    items.push({ separator: true });
    items.push({ label: "Create branch here…", action: () => doCreateBranch(path, hash) });
    items.push({ label: "Copy tag name", action: () => copyText(r.name) });
    items.push({ label: "Copy commit SHA", action: () => copyText(hash) });
    items.push({
      label: "Compare commit against working directory",
      action: () => compareCommitToWorking(path, hash),
    });
    return items;
  }

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
  eye: `<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>`,
  folder: `<path d="M1.8 12.5V4.2a.7.7 0 0 1 .7-.7h3.1l1.4 1.6h5.7a.7.7 0 0 1 .7.7v6.7a.7.7 0 0 1-.7.7H2.5a.7.7 0 0 1-.7-.7z"/>`,
  submodule: `<rect x="2" y="2" width="5.5" height="5.5" rx="1"/><rect x="8.5" y="2" width="5.5" height="5.5" rx="1"/><rect x="5.2" y="8.5" width="5.5" height="5.5" rx="1"/>`,
  eyeoff: `<path d="M2 2l12 12"/><path d="M6.7 6.7a2 2 0 0 0 2.6 2.6"/><path d="M9.8 3.6A6 6 0 0 1 14.5 8a12 12 0 0 1-1.4 1.9"/><path d="M3.9 3.9A11 11 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.3-.45"/>`,
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
// ---- contributor avatars from the repo's GitLab instance ----
// Resolved through GitLab's public /api/v4/avatar lookup and cached (including
// misses, so a non-GitLab host isn't queried over and over). Until an avatar
// resolves — or when it can't be — the generated identicon is used.
let repoHost = ""; // origin host of the ACTIVE repo ("" = local/none)
const glAvatars = new Map<string, string>(); // "host|email" -> url ("" = none)
const glPending = new Set<string>();
const LS_AVATARS = "jkt.avatars";

function loadAvatarCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_AVATARS) ?? "{}");
    for (const [k, v] of Object.entries(raw)) glAvatars.set(k, String(v));
  } catch {}
}
function saveAvatarCache() {
  try {
    localStorage.setItem(LS_AVATARS, JSON.stringify(Object.fromEntries(glAvatars)));
  } catch {}
}

// origin host for the active repo; avatars are looked up against it
async function syncRepoHost() {
  const t = cur();
  if (!t) {
    repoHost = "";
    return;
  }
  try {
    const host = await invoke<string>("remote_host", { path: t.repo.path });
    if (host !== repoHost) {
      repoHost = host;
      schedulePaint();
    }
  } catch {
    repoHost = "";
  }
}

let avatarRepaint = 0;
function ensureGitlabAvatar(email: string) {
  const key = `${repoHost}|${email.toLowerCase()}`;
  if (glAvatars.has(key) || glPending.has(key)) return;
  glPending.add(key);
  void invoke<string>("gitlab_avatar", { host: repoHost, email })
    .then((url) => glAvatars.set(key, url))
    .catch(() => glAvatars.set(key, "")) // remember the miss, don't retry
    .finally(() => {
      glPending.delete(key);
      saveAvatarCache();
      // one repaint per burst of lookups instead of one each
      window.clearTimeout(avatarRepaint);
      avatarRepaint = window.setTimeout(() => {
        schedulePaint();
        if (chatOpen) renderChatMsgs();
      }, 200);
    });
}

// real avatar when we have one, generated identicon otherwise
function avatarFor(email: string, name: string): string {
  const mail = (email || "").trim();
  if (mail && repoHost) {
    const hit = glAvatars.get(`${repoHost}|${mail.toLowerCase()}`);
    if (hit) return hit;
    ensureGitlabAvatar(mail);
  }
  return avatarUrl(mail || name);
}

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
// Wrap the [start,end) CHARACTER range of already-highlighted HTML in a marker
// span, splitting across the syntax spans as needed. Lets the char-level diff
// marks sit on top of syntax highlighting instead of replacing it.
function markRange(html: string, start: number, end: number, cls: string): string {
  if (start >= end) return html;
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) texts.push(node as Text);

  let pos = 0;
  for (const t of texts) {
    const len = t.data.length; // capture BEFORE splitting
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s < e) {
      const localS = s - pos;
      const localE = e - pos;
      t.splitText(localE); // tail stays a sibling; t is now [0, localE)
      const mid = t.splitText(localS); // mid is [localS, localE)
      const span = document.createElement("span");
      span.className = cls;
      mid.replaceWith(span);
      span.appendChild(mid);
    }
    pos += len;
  }
  return holder.innerHTML;
}

// char-level diff of two strings: syntax-highlight both, then mark the
// differing middle (common prefix/suffix stripped).
function intraline(
  oldS: string,
  newS: string,
  lang: string | null = null
): { o: string; n: string } {
  const min = Math.min(oldS.length, newS.length);
  let p = 0;
  while (p < min && oldS[p] === newS[p]) p++;
  let s = 0;
  while (
    s < min - p &&
    oldS[oldS.length - 1 - s] === newS[newS.length - 1 - s]
  )
    s++;
  return {
    o: markRange(hlLine(oldS, lang), p, oldS.length - s, "chg"),
    n: markRange(hlLine(newS, lang), p, newS.length - s, "chg"),
  };
}

// Parse a unified diff into rows with line numbers, per-line coloring, and
// char-level highlighting on paired changed lines.
function renderUnifiedDiff(diff: string): string {
  const lines = diff.split("\n");
  const lang = hlLang; // set by the view that opened the diff
  let oldN = 0;
  let newN = 0;
  const rows: string[] = [];
  // data-ln = the file line this row maps to (new side; old side for pure
  // deletions) — used by "history of selected lines"
  const row = (cls: string, ln1: string, ln2: string, codeHtml: string) => {
    const ln = ln2 || ln1;
    const attr = ln ? ` data-ln="${ln}"` : "";
    return (
      `<div class="dl ${cls}"${attr}><span class="ln">${ln1}</span>` +
      `<span class="ln">${ln2}</span><span class="dc">${codeHtml}</span></div>`
    );
  };

  // buffered consecutive removals/additions, flushed as a paired block.
  // Paired lines keep the character-level change highlight (no syntax there);
  // everything else gets syntax highlighting.
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
          i < pair ? intraline(d.text, adds[i].text, lang).o : hlLine(d.text, lang)
        )
      )
    );
    adds.forEach((a, i) =>
      rows.push(
        row(
          "add",
          "",
          String(a.ln),
          i < pair ? intraline(dels[i].text, a.text, lang).n : hlLine(a.text, lang)
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
      rows.push(row("ctx", String(oldN++), String(newN++), hlLine(line.slice(1), lang)));
    }
  }
  flush();
  return rows.join("");
}

window.addEventListener("DOMContentLoaded", () => {
  $("open-btn").addEventListener("click", openRepo);
  $("clone-btn").addEventListener("click", doClone);
  $("fetch-btn").addEventListener("click", doFetch);
  $("pull-btn").addEventListener("click", doPull);
  $("push-btn").addEventListener("click", doPush);
  $("branch-btn").addEventListener("click", doBranch);
  $("stash-btn").addEventListener("click", doStashBtn);
  $("terminal-btn").addEventListener("click", doTerminal);
  $("stage-all").addEventListener("click", doStageAll);
  $("unstage-all").addEventListener("click", doUnstageAll);
  $("c-commit").addEventListener("click", doCommit);
  $("c-amend").addEventListener("change", updateCommitEnabled);
  $("c-summary").addEventListener("input", updateCommitEnabled);
  $("diffview-close").addEventListener("click", () => showDiffView(false));
  $("diffview-blame").addEventListener("click", () => {
    if (blameOn) lastView?.(); // back to the diff/content view
    else showBlame();
  });
  $("diffview-history").addEventListener("click", showFileHistory);
  $("hist-close").addEventListener("click", clearFileHistory);
  $("diffview-pickfile").addEventListener("click", doCherryPickFile);
  $("diffview-picklines").addEventListener("click", toggleCherryPickLines);
  $("diffview-plain").addEventListener("click", () => void togglePlainView());
  $("diffview-copy").addEventListener("click", () => void copyPlainFile());
  $("diffview-modify").addEventListener("click", () => void toggleEditFile());
  $("diffview-save").addEventListener("click", () => void saveEditedFile());
  // right-click a text selection in the file view -> history of those lines
  $("diffview-body").addEventListener("contextmenu", (e) => {
    if (!diffCtx) return;
    const range = selectedLineRange();
    if (!range) return; // no selection -> let the native menu (copy) show
    e.preventDefault();
    const label =
      range.start === range.end
        ? `History of line ${range.start}`
        : `History of lines ${range.start}–${range.end}`;
    const sel = window.getSelection()?.toString() ?? "";
    showMenu(e.clientX, e.clientY, [
      { label, action: () => void showLineHistory(range.start, range.end) },
      { separator: true },
      { label: "Copy", action: () => void navigator.clipboard.writeText(sel).catch(() => {}) },
    ]);
  });
  $("diffview-whole").addEventListener("click", () => {
    const scroll = $("diffview-body").scrollTop;
    const restore = () => ($("diffview-body").scrollTop = scroll);
    if (wipDiffCtx) {
      const c = wipDiffCtx;
      wipFull = !wipFull;
      void openWipDiff(c.path, c.file, c.staged).then(restore);
    } else if (diffCtx?.hash) {
      const { path, file, hash } = diffCtx;
      const title = $("diffview-title").textContent ?? file;
      diffFull = !diffFull;
      void openDiff(title, path, file, hash, histSplit).then(restore);
    }
  });
  // find-in-file bar
  $("dvf-input").addEventListener("input", (e) =>
    dvfRun((e.target as HTMLInputElement).value)
  );
  $("dvf-input").addEventListener("keydown", (e) => {
    const k = e as KeyboardEvent;
    if (k.key === "Enter") dvfStep(k.shiftKey ? -1 : 1);
    else if (k.key === "Escape") dvfClose();
  });
  $("dvf-prev").addEventListener("click", () => dvfStep(-1));
  $("dvf-next").addEventListener("click", () => dvfStep(1));
  $("dvf-close").addEventListener("click", dvfClose);
  // arrow through file history (when its panel is open) to flip through the
  // file's diff at each commit fast — ignore while typing in an input
  window.addEventListener("keydown", (e) => {
    if ($("hist-panel").classList.contains("hidden")) return;
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      stepHistEntry(1); // older
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      stepHistEntry(-1); // newer
    }
  });
  applyColumns(); // restore which columns are visible
  $("col-gear").addEventListener("click", (e) => {
    e.stopPropagation();
    const r = ($("col-gear") as HTMLElement).getBoundingClientRect();
    showColumnMenu(r.right - 4, r.bottom + 4);
  });
  setupGraphPan(); // graph column scrolls sideways on its own
  linkHistScroll(); // list <-> graph proportional scroll in file-history split
  // clicking the sidebar or empty graph space resets the branch highlight
  $("sidebar").addEventListener("click", clearGraphHighlight);
  $("hist-panel").addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".hist-item")) clearGraphHighlight();
  });
  $("scroll").addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".crow")) clearGraphHighlight();
  });
  // sync-scroll the 3 merge-resolver panes so lines stay aligned
  linkScroll(["mv-ours-code", "mv-theirs-code", "mv-result", "mv-output"]);
  setupSplitter("split-left", "sidebar", "left");
  setupSplitter("split-right", "detail", "right");
  $("d-tree-toggle").addEventListener("click", () => {
    filesTreeMode = !filesTreeMode;
    $("d-tree-toggle").textContent = filesTreeMode ? "Flat" : "Tree";
    renderFileList();
  });
  $("d-all-toggle").addEventListener("click", () => {
    filesAllMode = !filesAllMode;
    $("d-all-toggle").textContent = filesAllMode ? "Changed" : "Project";
    $("d-files-label").textContent = filesAllMode ? "Project files" : "Changed files";
    ($("d-tree-toggle") as HTMLElement).style.display = filesAllMode ? "none" : "";
    renderFileList();
  });
  $("scroll").addEventListener("scroll", schedulePaint, { passive: true });
  window.addEventListener("resize", schedulePaint);
  $("detail-close").addEventListener("click", () =>
    $("detail").classList.add("collapsed")
  );
  $("repo-path").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const t = cur();
    if (t) showMenu(e.clientX, e.clientY, repoMenu(t.repo.path));
  });
  $("sb-right").addEventListener("click", showAbout);
  $("search-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSearch();
  });
  $("search").addEventListener("input", (e) =>
    runSearch((e.target as HTMLInputElement).value)
  );
  $("search").addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") {
      ($("search") as HTMLInputElement).value = "";
      closeSearch();
    }
  });
  // merge resolver
  $("mv-ours").addEventListener("click", () => resolveAll("ours"));
  $("mv-theirs").addEventListener("click", () => resolveAll("theirs"));
  $("mv-prev").addEventListener("click", () => jumpToConflict(mvJumpIdx - 1));
  $("mv-next").addEventListener("click", () => jumpToConflict(mvJumpIdx + 1));
  $("mv-edit").addEventListener("click", toggleManual);
  $("mv-save").addEventListener("click", saveResolved);
  $("mv-close").addEventListener("click", () => showDiffView(false));
  $("cf-abort").addEventListener("click", abortMerge);
  $("cf-finish").addEventListener("click", finishMerge);
  setupCollapsible();
  getVersion()
    .then((v) => {
      appVersion = v;
      updateStatusBar(cur());
      checkForUpdate();
    })
    .catch(() => {});
  loadAvatarCache();
  renderTabs();
  restoreSession();
  setInterval(pollActive, 1500); // local changes (files/stage/commits/branches)
  setInterval(autoFetch, 90000); // remote changes (someone pushed) — quiet fetch
  setInterval(() => void chatPoll(), 30000); // repo chat — no-op unless enabled

  // chat panel wiring (panel/button only visible when chat is enabled)
  $("chat-btn").addEventListener("click", () => showChatPanel(!chatOpen));
  $("chat-close").addEventListener("click", () => showChatPanel(false));
  $("chat-refresh").addEventListener("click", () => void chatPoll(true));
  $("chat-send").addEventListener("click", () => void chatSendCurrent());
  $("chat-input").addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") void chatSendCurrent();
  });
});
// clear drag state when any drag ends
window.addEventListener("dragend", () => {
  dragSource = null;
  document
    .querySelectorAll(".drop-target,.dragging")
    .forEach((x) => x.classList.remove("drop-target", "dragging"));
});

// close context menu on any outside click / escape / scroll
window.addEventListener("click", (e) => {
  closeMenu();
  if (!(e.target as HTMLElement).closest(".search-box, #search-btn")) closeSearch();
});
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    // file view open -> find inside the file; otherwise repo-wide search
    if (!$("diffview").classList.contains("hidden")) dvfOpen();
    else openSearch();
  }
});
// Ctrl/Cmd+S saves the file while editing it
window.addEventListener("keydown", (e) => {
  if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")) return;
  if (!editOn) return;
  e.preventDefault();
  void saveEditedFile();
});
// Ctrl/Cmd+A in the file view selects ONLY the file content, not the whole UI
window.addEventListener("keydown", (e) => {
  if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")) return;
  if ($("diffview").classList.contains("hidden")) return; // no file open
  const tag = (document.activeElement?.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea") return; // let inputs select their text
  e.preventDefault();
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents($("diffview-body"));
  sel.removeAllRanges();
  sel.addRange(r);
});
window.addEventListener("scroll", closeMenu, true);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});
