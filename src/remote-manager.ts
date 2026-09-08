import { invoke } from "@tauri-apps/api/core";
import "./remote-manager.css";

interface Remote { name: string; urls: string[]; push_urls: string[] }
interface Settings {
  remotes: Remote[]; branch: string; upstream: string; upstream_config: string;
  push_remote: string; push_default: string; branches: string[];
}

export function showRemoteManager(path: string, onChanged: () => Promise<void>) {
  if (document.getElementById("remote-manager")) return;
  const previousFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.id = "remote-manager";
  dialog.setAttribute("aria-labelledby", "remote-manager-title");
  dialog.innerHTML = `
    <form method="dialog" class="rm-heading"><h2 id="remote-manager-title">Manage remotes</h2><button>Close</button></form>
    <p class="rm-path"></p>
    <p>Edit repository connections and the current branch’s destinations.</p>
    <button type="button" class="rm-refresh">Refresh settings</button>
    <div class="rm-content"></div>
    <p class="rm-status" role="status" aria-live="polite"></p>`;
  const content = dialog.querySelector<HTMLElement>(".rm-content")!;
  const status = dialog.querySelector<HTMLElement>(".rm-status")!;
  dialog.querySelector<HTMLElement>(".rm-path")!.textContent = path;
  let busy = false;
  const locked = new WeakSet<HTMLElement>();
  function setBusy(value: boolean) {
    busy = value;
    for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) {
      control.disabled = value || locked.has(control);
    }
  }
  function button(label: string, action: () => void, disabled = false) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label;
    if (disabled) { b.disabled = true; locked.add(b); }
    b.addEventListener("click", action);
    return b;
  }
  function input(parent: HTMLElement, label: string, value = "", disabled = false) {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    const field = document.createElement("input");
    field.value = value; field.spellcheck = false;
    if (disabled) { field.disabled = true; locked.add(field); }
    wrapper.append(field); parent.append(wrapper);
    return field;
  }
  function text(parent: HTMLElement, message: string) {
    const p = document.createElement("p"); p.textContent = message; parent.append(p);
  }
  async function refresh() {
    const settings = await invoke<Settings>("remote_settings", { path });
    if (dialog.isConnected) render(settings);
  }
  async function run(action: () => Promise<unknown>, message: string, changed = true) {
    if (busy) return;
    setBusy(true); status.textContent = "Working…";
    try {
      await action();
      await refresh();
      status.textContent = message;
      if (changed) {
        try { await onChanged(); } catch { status.textContent += " Refresh the repository to update its view."; }
      }
    } catch (e) {
      // A multi-step Git operation can partially succeed; show the actual state.
      try { await refresh(); } catch { /* retain the original error */ }
      status.textContent = `Could not complete the action: ${String(e)}`;
    } finally { setBusy(false); }
  }
  function manage(action: string, name: string, value: string, message: string) {
    void run(() => invoke("remote_manage", { path, action, name, input: value.trim() }), message);
  }
  function select(parent: HTMLElement, label: string, options: { value: string; label: string }[], value: string) {
    const wrapper = document.createElement("label"); wrapper.textContent = label;
    const field = document.createElement("select");
    if (value && !options.some(o => o.value === value)) options.push({ value, label: `${value} (unavailable)` });
    for (const item of options) {
      const option = document.createElement("option"); option.value = item.value; option.textContent = item.label; field.append(option);
    }
    field.value = value; wrapper.append(field); parent.append(wrapper);
    return field;
  }
  function render(settings: Settings) {
    content.replaceChildren();
    for (const remote of settings.remotes) {
      const card = document.createElement("section"); card.className = "rm-card";
      const title = document.createElement("h3"); title.textContent = remote.name; card.append(title);
      const name = input(card, "Remote name", remote.name);
      card.append(button("Rename", () => manage("rename", remote.name, name.value, "Remote renamed.")));
      const multiple = remote.urls.length > 1;
      const url = input(card, "Fetch URL (also used for Push unless overridden)", remote.urls[0] ?? "", multiple);
      card.append(button("Save URL", () => manage("url", remote.name, url.value, "Remote URL saved."), multiple));
      if (multiple) text(card, `Multiple fetch URLs; edit with Git: ${remote.urls.join(" · ")}`);
      const multiplePush = remote.push_urls.length > 1;
      const push = input(card, "Push URL override (leave empty to use the fetch URL)", remote.push_urls[0] ?? "", multiplePush);
      card.append(button("Save push URL", () => manage("push-url", remote.name, push.value, "Push URL saved."), multiplePush));
      if (multiplePush) text(card, `Multiple push URLs; edit with Git: ${remote.push_urls.join(" · ")}`);
      const removal = document.createElement("div"); removal.className = "rm-remove";
      const remove = button("Remove remote…", () => {
        removal.replaceChildren();
        text(removal, `Remove ${remote.name} and its remote-tracking references from this repository? Local branches and the remote server remain in place.`);
        removal.append(button("Confirm remove", () => manage("remove", remote.name, "", "Remote removed.")),
          button("Cancel", () => removal.replaceChildren(remove)));
      });
      removal.append(remove); card.append(removal); content.append(card);
    }
    if (!settings.remotes.length) text(content, "This repository has no remotes yet.");
    const add = document.createElement("section"); add.className = "rm-card";
    const title = document.createElement("h3"); title.textContent = "Add remote"; add.append(title);
    const name = input(add, "Name"); name.placeholder = "origin";
    const url = input(add, "URL or local repository path");
    add.append(button("Add remote", () => manage("add", name.value.trim(), url.value, "Remote added.")));
    content.append(add);

    const branch = document.createElement("section"); branch.className = "rm-card";
    const heading = document.createElement("h3"); heading.textContent = settings.branch ? `Branch: ${settings.branch}` : "Branch destinations"; branch.append(heading);
    content.append(branch);
    if (!settings.branch) { text(branch, "Detached HEAD: check out a branch to configure its destinations."); setBusy(busy); return; }
    text(branch, "Pull follows the upstream branch. Push may use a separate remote, such as your fork.");
    if (!settings.upstream && settings.upstream_config) text(branch, `Configured upstream is not available locally: ${settings.upstream_config}. Fetch to update remote branches.`);
    const upstream = select(branch, "Upstream branch for Pull", [{ value: "", label: "No upstream" },
      ...settings.branches.map(ref => ({ value: ref, label: ref.startsWith("refs/remotes/") ? ref.slice(13) : `${ref.slice(11)} (local)` }))], settings.upstream);
    const saveBranch = (setting: string, target: string) => void run(() => invoke("branch_remote_setting", { path, branch: settings.branch, setting, target }), "Branch destination saved.");
    branch.append(button("Save upstream", () => saveBranch("upstream", upstream.value)));
    const push = select(branch, "Push remote", [{ value: "", label: settings.push_default ? `Default (${settings.push_default})` : "Default (upstream remote, or choose when pushing)" },
      ...settings.remotes.map(r => ({ value: r.name, label: r.name }))], settings.push_remote);
    branch.append(button("Save push destination", () => saveBranch("push", push.value)));
    text(branch, "Only fetched remote branches appear in the upstream list.");
    branch.append(button("Fetch remote branches", () => void run(() => invoke("fetch", { path }), "Remote branches fetched.")));
    setBusy(busy);
  }
  dialog.querySelector(".rm-refresh")!.addEventListener("click", () => void run(async () => {}, "Settings refreshed.", false));
  dialog.addEventListener("keydown", e => e.stopPropagation());
  dialog.addEventListener("cancel", e => { if (busy) e.preventDefault(); });
  dialog.addEventListener("close", () => { dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus(); });
  document.body.append(dialog); dialog.showModal();
  void run(async () => {}, "", false);
}
