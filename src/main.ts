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
  showMenu(x, y, [
    {
      label: `Merge ${source} into ${target}`,
      action: () =>
        runAction(invoke("merge_into", { path, source, target }), `Merged ${source} into ${target}`),
    },
    {
      label: `Rebase ${source} onto ${target}`,
      action: () =>
        runAction(invoke("rebase_branch_onto", { path, source, target }), `Rebased ${source} onto ${target}`),
    },
  ]);
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
        const canHide = kind === "local" || kind === "remote";
        const isHidden = canHide && (t.hidden?.has(refKey(r)) ?? false);
        if (isHidden) li.classList.add("branch-hidden");
        li.innerHTML =
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

        // drag & drop between local branches -> merge / rebase
        if (kind === "local") {
          li.draggable = true;
          li.addEventListener("dragstart", (e) => {
            dragSource = r.name;
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", r.name);
            }
            li.classList.add("dragging");
          });
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

// ---- virtualized graph rendering ----
interface GCtx {
  tab: Tab;
  placed: Placed[];
  byId: Map<string, Placed>;
  refsByHash: Map<string, RefInfo[]>;
  graphW: number;
}
let gctx: GCtx | null = null;
let paintQueued = false;

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

  const graphW = laneX(maxLane) + PAD;
  const totalH = placed.length * ROW_H;

  const svg = $("graph-svg") as unknown as SVGSVGElement;
  svg.setAttribute("width", String(graphW));
  svg.setAttribute("height", String(totalH));
  svg.style.left = `${REF_W}px`;
  (document.querySelector(".ch-graph") as HTMLElement).style.width = `${graphW}px`;
  $("rows").style.height = `${totalH}px`;

  // min content width so the message column isn't cut off on narrow windows
  // (horizontal scroll kicks in instead of truncating)
  const MSG_MIN = 420;
  const contentW = REF_W + graphW + MSG_MIN;
  $("graph-content").style.minWidth = `${contentW}px`;
  $("col-headers").style.minWidth = `${contentW}px`;

  gctx = { tab: t, placed, byId, refsByHash, graphW };
  $("empty").classList.add("hidden");
  paintViewport();
}

// render only the rows/nodes/edges visible in the scroll viewport
function paintViewport() {
  if (!gctx) return;
  const { tab: t, placed, byId, refsByHash, graphW } = gctx;
  const repo = t.repo;

  // lineage: highlight the whole branch line — ancestors AND descendants
  // (so you can see where this commit's branch head is), dim the rest.
  // 3-level highlight when a node is selected:
  //  2 = the branch line (first-parent chain, up + down to the head)
  //  1 = every other commit that led here (all ancestors via any parent)
  //  0 = unrelated -> dimmed
  let branchLine: Set<string> | null = null;
  let connected: Set<string> | null = null; // ancestors + all descendants
  if (t.selected && byId.has(t.selected)) {
    branchLine = new Set<string>();
    connected = new Set<string>();
    // children maps: first-parent (branch line) and all-parent (full descendants)
    const childFP = new Map<string, string[]>();
    const childAll = new Map<string, string[]>();
    for (const p of placed) {
      p.node.parents.forEach((par, idx) => {
        if (!byId.has(par)) return;
        (childAll.get(par) ?? childAll.set(par, []).get(par)!).push(p.node.id);
        if (idx === 0) (childFP.get(par) ?? childFP.set(par, []).get(par)!).push(p.node.id);
      });
    }
    // branch line: first-parent ancestors
    let c2: string | undefined = t.selected;
    while (c2 && !branchLine.has(c2)) {
      branchLine.add(c2);
      const fp: string | undefined = byId.get(c2)?.node.parents[0];
      c2 = fp && byId.has(fp) ? fp : undefined;
    }
    // branch line: first-parent descendants (to the head)
    const fp = [t.selected];
    const seenFP = new Set<string>();
    while (fp.length) {
      const id = fp.pop()!;
      if (seenFP.has(id)) continue;
      seenFP.add(id);
      branchLine.add(id);
      for (const ch of childFP.get(id) ?? []) fp.push(ch);
    }
    // connected: all ancestors (led here) + all descendants (everywhere it contributes)
    const up = [t.selected];
    while (up.length) {
      const id = up.pop()!;
      if (connected.has(id)) continue;
      connected.add(id);
      const pp = byId.get(id);
      if (pp) for (const par of pp.node.parents) if (byId.has(par)) up.push(par);
    }
    const down = [t.selected];
    const seenDn = new Set<string>();
    while (down.length) {
      const id = down.pop()!;
      if (seenDn.has(id)) continue;
      seenDn.add(id);
      connected.add(id);
      for (const ch of childAll.get(id) ?? []) down.push(ch);
    }
  }
  const levelOf = (id: string): number => {
    // file-history highlight overrides: only file-changing commits are bright
    if (fileHistoryHL) return fileHistoryHL.has(id) ? 2 : 0;
    return branchLine === null ? 2 : branchLine.has(id) ? 2 : connected!.has(id) ? 1 : 0;
  };
  const edgeOp = (a: string, b: string) => {
    const l = Math.min(levelOf(a), levelOf(b));
    return l === 2 ? "" : l === 1 ? ` opacity="0.5"` : ` opacity="0.13"`;
  };
  const nodeOp = (id: string) => {
    const l = levelOf(id);
    return l === 2 ? "" : l === 1 ? ` opacity="0.55"` : ` opacity="0.16"`;
  };

  const scroll = $("scroll");
  const top = scroll.scrollTop;
  const vh = scroll.clientHeight || 600;
  const BUF = 12;
  const start = Math.max(0, Math.floor(top / ROW_H) - BUF);
  const end = Math.min(placed.length, Math.ceil((top + vh) / ROW_H) + BUF);

  // --- SVG: edges (only those intersecting the viewport) + visible nodes ---
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
        if (isMergeEdge) {
          // merged branch: straight UP the parent's lane, corner at the merge
          // row, then horizontally into the merge commit
          d = `M ${cx} ${cy} L ${px - dir * r} ${cy} Q ${px} ${cy} ${px} ${cy + r} L ${px} ${py}`;
        } else {
          // fork: down the child's lane, corner at the parent's row
          d = `M ${cx} ${cy} L ${cx} ${py - r} Q ${cx} ${py} ${cx + dir * r} ${py} L ${px} ${py}`;
        }
      }
      const dash = p.node.kind !== "commit" ? ` stroke-dasharray="3 3"` : "";
      const op = edgeOp(p.node.id, ph);
      parts.push(`<path d="${d}" fill="none" stroke="${pp.color}" stroke-width="2"${dash}${op}/>`);
    }
  }
  for (let i = start; i < end; i++) {
    const p = placed[i];
    const x = laneX(p.lane), y = rowY(p.row);
    const op = nodeOp(p.node.id);
    if (p.node.kind === "stash") {
      const sz = 11;
      parts.push(`<rect x="${x - sz / 2}" y="${y - sz / 2}" width="${sz}" height="${sz}" rx="2" fill="#1e1e2a" stroke="${STASH_COLOR}" stroke-width="1.5" stroke-dasharray="2 2"${op}/>`);
    } else if (p.node.kind === "wip") {
      parts.push(`<circle cx="${x}" cy="${y}" r="${NODE_R}" fill="#1e1e2a" stroke="${WIP_COLOR}" stroke-width="2" stroke-dasharray="2 2"${op}/>`);
    } else {
      const c = p.node.commit!;
      const half = AVATAR / 2;
      if (c.hash === repo.head) {
        const stroke = repo.head_branch ? "#ffffff" : "#ff8f8f";
        parts.push(`<rect x="${x - half - 2}" y="${y - half - 2}" width="${AVATAR + 4}" height="${AVATAR + 4}" rx="6" fill="none" stroke="${stroke}" stroke-width="2"${op}/>`);
      }
      parts.push(`<image href="${avatarUrl(c.email || c.author)}" x="${x - half}" y="${y - half}" width="${AVATAR}" height="${AVATAR}"${op}><title>${escapeHtml(`${c.author} <${c.email}>`)}</title></image>`);
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
    if (n.id === t.selected) row.classList.add("selected");
    const lvl = levelOf(n.id);
    if (lvl === 0) row.classList.add("dim");
    else if (lvl === 1) row.classList.add("dim-mid");

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
        `<span class="author">${escapeHtml(c.author)}</span>` +
        `<span class="date">${fmtDate(c.time)}</span>` +
        `<span class="hash">${c.hash.slice(0, 8)}</span>`;
    }
    row.innerHTML =
      `<div class="col-ref">${refHtml}</div>` +
      `<div class="col-graph" style="width:${graphW}px"></div>` +
      `<div class="col-msg">${msgHtml}</div>`;
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
  row.addEventListener("click", () => selectNode(n));

  // drag & drop on the graph's branch badges -> merge / rebase
  row.querySelectorAll<HTMLElement>(".col-ref .badge[data-refname]").forEach((b) => {
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
    if (isLocal) {
      b.draggable = true;
      b.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        dragSource = name;
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
  // back to the full graph; highlight applies there
  showDiffView(false);
  const t = cur();
  if (t) renderGraph(t);
  renderHistPanel(file, hist);
}

// left-of-graph column listing every commit that touched the file; clicking
// one jumps the graph to that commit and selects it
function renderHistPanel(file: string, hist: HistEntry[]) {
  $("hist-title").innerHTML =
    `📄 <b>${escapeHtml(basename(file))}</b> · ${hist.length}`;
  ($("hist-title") as HTMLElement).title = file;
  const ul = $("hist-list");
  ul.innerHTML = "";
  if (!hist.length) ul.innerHTML = "<li class='muted'>(no commits)</li>";
  hist.forEach((h) => {
    const li = document.createElement("li");
    li.className = "hist-item";
    const ns =
      h.added < 0 || h.deleted < 0
        ? `<span class="ns-bin">bin</span>`
        : `<span class="ns-add">+${h.added}</span><span class="ns-del">−${h.deleted}</span>`;
    li.innerHTML =
      `<div class="hi-top"><span class="hi-msg">${escapeHtml(h.summary)}</span>` +
      `<span class="numstat">${ns}</span></div>` +
      `<div class="hi-meta"><span class="hi-hash">${h.hash.slice(0, 8)}</span>` +
      `<span class="hi-author">${escapeHtml(h.author)}</span>` +
      `<span class="hi-date">${fmtDate(h.time)}</span></div>`;
    li.title = `${h.hash}\n${h.author} — ${fmtDate(h.time)}\n${h.summary}`;
    li.addEventListener("click", () => {
      const t = cur();
      if (!t) return;
      ul.querySelectorAll("li.selected").forEach((x) => x.classList.remove("selected"));
      li.classList.add("selected");
      const n = t.nodes.find((x) => x.id === h.hash);
      if (n) selectNode(n, true); // select + scroll the graph to the commit
      else setStatus(`commit ${h.hash.slice(0, 8)} not in the loaded graph`);
    });
    ul.appendChild(li);
  });
  $("hist-panel").classList.remove("hidden");
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
  $("hist-filter").classList.add("hidden");
  $("hist-panel").classList.add("hidden");
  const t = cur();
  if (t) renderGraph(t);
}

// blame view: each line shows who/when; click a line to jump to that commit
async function showBlame() {
  if (!diffCtx) return;
  setBlameBtn(true);
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
        `<div class="bl${newGroup ? " bl-top" : ""}${isChange ? " bl-added" : ""}" data-hash="${bl.hash}" title="${escapeHtml(bl.summary)}">` +
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
  saveSession();

  const t = cur();
  if (t) {
    refreshRemoteTags(t);
    if (t.stale) reloadActive(); // refresh the visible tab in the background
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
        html += `<div class="ml"><span class="ln">${n}</span><span class="dc">${hlLine(l, langForFile(mvFile))}</span></div>`;
      }
    } else {
      for (const l of (side === "ours" ? s.ours! : s.theirs!)) {
        n++;
        html += `<div class="ml ${side} conf"><span class="ln">${n}</span><span class="dc">${hlLine(l, langForFile(mvFile))}</span></div>`;
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
        html += `<div class="ml"><span class="ln">${n}</span><span class="dc">${hlLine(l, langForFile(mvFile))}</span></div>`;
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
        html += `<div class="ml ours"><span class="ln">${num}</span><span class="dc">${hlLine(l, langForFile(mvFile))}</span></div>`;
      }
    if (showTheirs)
      for (const l of s.theirs!) {
        const num = c ? String(++n) : "";
        html += `<div class="ml theirs"><span class="ln">${num}</span><span class="dc">${hlLine(l, langForFile(mvFile))}</span></div>`;
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
  mvJumpIdx = -1;
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

async function openDiff(
  title: string,
  path: string,
  file: string,
  hash: string | null
) {
  diffCtx = { path, file, hash };
  lastView = () => openDiff(title, path, file, hash);
  setBlameBtn(false);
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
      ? await invoke<string>("commit_diff", { path, hash, file })
      : await invoke<string>("wip_diff", { path, file });
    showDiffText(title, diff);
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

async function openWipDiff(path: string, file: string, staged: boolean) {
  diffCtx = { path, file, hash: null };
  lastView = () => openWipDiff(path, file, staged);
  setBlameBtn(false);
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
    const diff = await invoke<string>("wip_diff_split", { path, file, staged });
    wipDiffCtx = { path, file, staged, diff };
    showDiffText(title, diff);
    decorateStageableRows(staged);
  } catch (e) {
    body.innerHTML = `<div class='dl ctx'><span class='dc'>${escapeHtml(String(e))}</span></div>`;
    $("diff-minimap").innerHTML = "";
  }
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
      `<img class="chat-av" src="${avatarUrl(m.email || m.author)}" alt=""/>` +
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
  const lang = hlLang; // set by the view that opened the diff
  let oldN = 0;
  let newN = 0;
  const rows: string[] = [];
  const row = (cls: string, ln1: string, ln2: string, codeHtml: string) =>
    `<div class="dl ${cls}"><span class="ln">${ln1}</span>` +
    `<span class="ln">${ln2}</span><span class="dc">${codeHtml}</span></div>`;

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
          i < pair ? intraline(d.text, adds[i].text).o : hlLine(d.text, lang)
        )
      )
    );
    adds.forEach((a, i) =>
      rows.push(
        row(
          "add",
          "",
          String(a.ln),
          i < pair ? intraline(dels[i].text, a.text).n : hlLine(a.text, lang)
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
    openSearch();
  }
});
window.addEventListener("scroll", closeMenu, true);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});
