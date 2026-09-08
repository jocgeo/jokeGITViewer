import { invoke } from "@tauri-apps/api/core";
import "./recovery.css";

interface ReflogEntry {
  hash: string;
  selector: string;
  action: string;
  actor: string;
}
interface ReflogPage { entries: ReflogEntry[]; has_more: boolean }
interface ChangedFile { status: string; path: string }

export function showRecovery(path: string, onRecovered: () => Promise<void>) {
  if (document.getElementById("recovery-dialog")) return;
  const previousFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.id = "recovery-dialog";
  dialog.setAttribute("aria-labelledby", "recovery-title");
  dialog.innerHTML = `
    <form method="dialog" class="recovery-heading">
      <h2 id="recovery-title">Recover a commit</h2>
      <button aria-label="Close recovery" title="Close">✕</button>
    </form>
    <p class="recovery-path"></p>
    <p>Find a previous branch or HEAD position and save its commit as a new branch.
       Your current branch and uncommitted changes stay in place.</p>
    <label>Filter loaded entries <input class="recovery-search" type="search"
      placeholder="Commit, branch, action, or author" /></label>
    <div class="recovery-list" role="group" aria-label="Reflog entries"></div>
    <div class="recovery-pagination"><span class="recovery-count"></span>
      <button type="button" class="recovery-more">Load more</button></div>
    <section class="recovery-preview" aria-labelledby="recovery-preview-title">
      <h3 id="recovery-preview-title">Commit changes</h3>
      <p class="recovery-preview-info">Select a history entry to preview its changes.</p>
      <label>Changed file <select class="recovery-files" disabled aria-label="Changed file"></select></label>
      <p class="recovery-preview-status" role="status" aria-live="polite"></p>
      <button type="button" class="recovery-preview-retry" hidden>Retry preview</button>
      <pre class="recovery-diff" tabindex="0" aria-label="Selected file diff"></pre>
    </section>
    <form class="recovery-form">
      <label>New branch name <input class="recovery-name" placeholder="recovered/my-work" required /></label>
      <button type="submit" class="recovery-create" disabled>Recover branch</button>
    </form>
    <p class="recovery-status" role="status" aria-live="polite"></p>
    <small>Reflogs are local history. Expired entries and objects already removed by Git cannot be recovered here.</small>`;
  const get = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const search = get<HTMLInputElement>(".recovery-search");
  const name = get<HTMLInputElement>(".recovery-name");
  const create = get<HTMLButtonElement>(".recovery-create");
  const more = get<HTMLButtonElement>(".recovery-more");
  const status = get(".recovery-status");
  const list = get(".recovery-list");
  const files = get<HTMLSelectElement>(".recovery-files");
  const previewStatus = get(".recovery-preview-status");
  const diff = get(".recovery-diff");
  const retry = get<HTMLButtonElement>(".recovery-preview-retry");
  get(".recovery-path").textContent = path;
  const entries: ReflogEntry[] = [];
  let selected: ReflogEntry | null = null;
  let loading = false;
  let saving = false;
  let hasMore = true;
  let previewRequest = 0;
  const showFile = async () => {
    if (!selected || files.selectedIndex < 0) return;
    const request = ++previewRequest;
    const hash = selected.hash;
    const file = files.value;
    diff.replaceChildren();
    retry.hidden = true;
    previewStatus.textContent = "Loading file changes…";
    try {
      const patch = await invoke<string>("commit_diff", { path, hash, file, full: false });
      if (!dialog.isConnected || request !== previewRequest) return;
      const lines = patch.split("\n");
      const limit = 3000;
      const fragment = document.createDocumentFragment();
      for (const line of lines.slice(0, limit)) {
        const span = document.createElement("span");
        span.className = line.startsWith("@@") ? "diff-hunk" :
          line.startsWith("+") && !line.startsWith("+++") ? "diff-added" :
          line.startsWith("-") && !line.startsWith("---") ? "diff-removed" : "diff-context";
        span.textContent = line || " ";
        fragment.append(span);
      }
      diff.replaceChildren(fragment);
      diff.scrollTop = diff.scrollLeft = 0;
      previewStatus.textContent = !patch.trim() ? "No text diff for this file." :
        lines.length > limit ? "Preview limited to the first 3,000 lines." :
        "Additions are green; deletions are red. Binary changes appear as a notice.";
    } catch (e) {
      if (!dialog.isConnected || request !== previewRequest) return;
      previewStatus.textContent = `Could not load diff: ${String(e)}`;
      retry.hidden = false;
    }
  };
  const preview = async (entry: ReflogEntry) => {
    const request = ++previewRequest;
    files.replaceChildren();
    files.disabled = true;
    diff.replaceChildren();
    retry.hidden = true;
    get(".recovery-preview-info").textContent = `${entry.hash} — changes against its first parent (or an empty tree for the first commit).`;
    previewStatus.textContent = "Loading changed files…";
    try {
      const changed = await invoke<ChangedFile[]>("commit_files", { path, hash: entry.hash });
      if (!dialog.isConnected || request !== previewRequest) return;
      for (const file of changed) {
        const option = document.createElement("option");
        option.value = file.path;
        option.textContent = `${file.status}  ${file.path}`;
        files.append(option);
      }
      files.disabled = !changed.length;
      if (changed.length) await showFile();
      else previewStatus.textContent = "This commit has no file changes against its first parent.";
    } catch (e) {
      if (!dialog.isConnected || request !== previewRequest) return;
      previewStatus.textContent = `Could not load changed files: ${String(e)}`;
      retry.hidden = false;
    }
  };
  files.addEventListener("change", () => void showFile());
  retry.addEventListener("click", () => {
    if (files.options.length) void showFile();
    else if (selected) void preview(selected);
  });
  const update = () => {
    create.disabled = saving || !selected || !name.value.trim();
    more.disabled = saving || loading;
    more.hidden = !hasMore;
    name.disabled = saving;
    search.disabled = saving;
    get<HTMLButtonElement>(".recovery-heading button").disabled = saving;
  };
  const render = () => {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const filtered = entries.filter(e =>
      `${e.hash} ${e.selector} ${e.action} ${e.actor}`.toLowerCase().includes(query));
    for (const entry of filtered) {
      const row = document.createElement("label");
      row.className = "recovery-entry";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "recovery-entry";
      radio.checked = selected === entry;
      radio.disabled = saving;
      radio.setAttribute("aria-label", `${entry.action}, ${entry.hash.slice(0, 12)}, ${entry.selector}`);
      radio.addEventListener("change", () => {
        selected = entry;
        if (!name.value) name.value = `recovered/${entry.hash.slice(0, 12)}`;
        status.textContent = `Selected ${entry.hash}`;
        update();
        void preview(entry);
      });
      const body = document.createElement("span");
      const action = document.createElement("strong");
      action.textContent = entry.action;
      const detail = document.createElement("span");
      detail.className = "recovery-meta";
      detail.textContent = `${entry.hash.slice(0, 12)} · ${entry.selector} · ${entry.actor}`;
      body.append(action, detail);
      row.append(radio, body);
      list.append(row);
    }
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.textContent = loading ? "Loading local history…" :
        query ? "No matching entries in the loaded history." : "No local reflog entries found.";
      list.append(empty);
    }
    get(".recovery-count").textContent = `${filtered.length} shown · ${entries.length} loaded`;
  };
  const load = async () => {
    if (loading || !hasMore) return;
    loading = true;
    status.textContent = "Loading local history…";
    update();
    render();
    try {
      const page = await invoke<ReflogPage>("reflog", { path, offset: entries.length });
      if (!dialog.isConnected) return;
      entries.push(...page.entries);
      hasMore = page.has_more;
      status.textContent = "";
    } catch (e) {
      if (dialog.isConnected) status.textContent = `Could not load history: ${String(e)}. Use Load more to retry.`;
    } finally {
      loading = false;
      if (dialog.isConnected) { render(); update(); }
    }
  };
  search.addEventListener("input", render);
  name.addEventListener("input", update);
  more.addEventListener("click", () => void load());
  get<HTMLFormElement>(".recovery-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (saving || !selected || !name.value.trim()) return;
    const branch = name.value.trim();
    saving = true;
    status.textContent = "Creating recovery branch…";
    update();
    render();
    try {
      await invoke("recover_branch", { path, name: branch, hash: selected.hash });
      status.textContent = `Recovered as “${branch}”. You can check it out from the branch list.`;
      try { await onRecovered(); } catch { status.textContent += " Refresh the repository to see it."; }
    } catch (error) {
      status.textContent = `Recovery failed: ${String(error)}`;
    } finally {
      saving = false;
      update();
      render();
    }
  });
  dialog.addEventListener("cancel", e => { if (saving) e.preventDefault(); });
  dialog.addEventListener("keydown", e => e.stopPropagation());
  dialog.addEventListener("close", () => {
    previewRequest++;
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  search.focus();
  void load();
}
