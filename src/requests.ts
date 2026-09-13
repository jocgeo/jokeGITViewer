import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import './requests.css';

interface Target { remote: string; host: string; project: string; provider: string }
interface Request { number: number; title: string; url: string; author: string; source: string; target: string; draft: boolean; reasons: string[] }
interface Result { user: string | null; items: Request[] }
let path = '';
let version = 0;
let targets: Target[] = [];
let busy = false;
let initialized = false;
const el = (id: string) => document.getElementById(id)!;
const select = (id: string) => el(id) as HTMLSelectElement;
function selected() { return targets.find(t => t.remote === select('requests-remote').value); }
function args() { return { path, remote: select('requests-remote').value, provider: select('requests-provider').value }; }
function status(text: string) { el('requests-status').textContent = text; }
function clear() {
  el('requests-mine').replaceChildren(); el('requests-all').replaceChildren();
  el('requests-mine-count').textContent = ''; el('requests-all-count').textContent = '';
}
function rememberProvider(t: Target) {
  try { localStorage.setItem(`jkt.requests.provider.${t.host}`, select('requests-provider').value); } catch { /* optional */ }
}
function setProvider() {
  const t = selected();
  let saved = '';
  try { saved = localStorage.getItem(`jkt.requests.provider.${t?.host}`) ?? ''; } catch { /* optional */ }
  select('requests-provider').value = t?.provider || (['github', 'gitlab'].includes(saved) ? saved : '');
  select('requests-provider').disabled = !!t?.provider;
  el('requests-repo').textContent = t ? `${t.host}/${t.project}` : '';
}
function renderRows(id: string, items: Request[]) {
  const list = el(id); list.replaceChildren();
  if (!items.length) { const row = document.createElement('li'); row.textContent = 'No open requests'; row.className = 'muted'; list.append(row); }
  for (const item of items) {
    const row = document.createElement('li');
    const button = document.createElement('button'); button.className = 'request-row';
    const title = document.createElement('span'); title.textContent = `${item.draft ? 'Draft · ' : ''}#${item.number} ${item.title}`;
    const meta = document.createElement('small'); meta.textContent = `${item.author}${item.reasons.length ? ' · ' + item.reasons.join(' · ') : ''}`;
    button.title = `${item.source} → ${item.target}\nOpen in browser`;
    button.append(title, meta);
    button.addEventListener('click', () => void openUrl(item.url).catch(e => status(String(e))));
    row.append(button); list.append(row);
  }
}
async function refresh() {
  const t = selected();
  if (!path || !t) return;
  const input = args();
  const ticket = ++version;
  clear();
  if (!input.provider) { busy = false; status('Choose GitHub or GitLab for this server.'); return; }
  busy = true; status('Loading open requests…');
  try {
    const result = await invoke<Result>('request_list', input);
    if (ticket !== version) return;
    const mine = result.items.filter(r => r.reasons.length);
    renderRows('requests-all', result.items);
    if (result.user) renderRows('requests-mine', mine);
    else el('requests-mine').textContent = 'Connect to identify your requests.';
    el('requests-all-count').textContent = String(result.items.length);
    el('requests-mine-count').textContent = result.user ? String(mine.length) : '—';
    status(result.user ? `Connected as ${result.user} · updated ${new Date().toLocaleTimeString()}` : 'Public requests · connect for private projects and personal requests');
  } catch (e) { if (ticket === version) status(String(e)); }
  finally { if (ticket === version) busy = false; }
}
async function discover() {
  const ticket = ++version;
  busy = true; clear(); status('Reading remotes…');
  const previous = select('requests-remote').value;
  targets = []; select('requests-remote').replaceChildren();
  try {
    const found = await invoke<Target[]>('request_targets', { path });
    if (ticket !== version) return;
    targets = found;
    for (const t of targets) {
      const option = document.createElement('option'); option.value = t.remote; option.textContent = t.remote;
      select('requests-remote').append(option);
    }
    select('requests-remote').value = targets.find(t => t.remote === previous)?.remote ?? targets.find(t => t.remote === 'origin')?.remote ?? targets[0]?.remote ?? '';
    setProvider();
    if (!targets.length) { status('Add a GitHub or GitLab remote to list requests.'); return; }
    await refresh();
  } catch (e) { if (ticket === version) status(String(e)); }
  finally { if (ticket === version) busy = false; }
}
function connect() {
  const t = selected();
  const input = args();
  if (!t || !input.provider) { status('Choose a remote and provider first.'); return; }
  const dialog = document.createElement('dialog'); dialog.className = 'requests-connect';
  dialog.innerHTML = '<h3>Connect hosting account</h3><p class="host"></p><p class="help"></p><form><label>Personal access token<input type="password" autocomplete="off" required /></label><p class="error"></p><button type="submit">Connect</button> <button type="button" class="cancel">Cancel</button></form>';
  dialog.querySelector('.host')!.textContent = `${input.provider === 'github' ? 'GitHub' : 'GitLab'} · ${t.host}`;
  dialog.querySelector('.help')!.textContent = input.provider === 'github'
    ? 'Use Pull requests: Read permission (or an appropriate classic token). Kept in memory until the app closes.'
    : 'Use read_api scope. Kept in memory until the app closes.';
  const token = dialog.querySelector('input')!;
  const submit = dialog.querySelector('button[type=submit]') as HTMLButtonElement;
  const close = () => { token.value = ''; dialog.close(); dialog.remove(); };
  dialog.querySelector('.cancel')!.addEventListener('click', () => { if (!submit.disabled) close(); });
  dialog.addEventListener('cancel', e => { e.preventDefault(); if (!submit.disabled) close(); });
  dialog.querySelector('form')!.addEventListener('submit', async e => {
    e.preventDefault(); submit.disabled = true;
    (dialog.querySelector('.cancel') as HTMLButtonElement).disabled = true;
    const secret = token.value; token.value = '';
    try {
      await invoke('request_connect', { ...input, token: secret });
      close();
      if (path === input.path && args().remote === input.remote && args().provider === input.provider) await refresh();
    } catch (error) { dialog.querySelector('.error')!.textContent = String(error); }
    finally {
      submit.disabled = false;
      const cancel = dialog.querySelector('.cancel') as HTMLButtonElement | null;
      if (cancel) cancel.disabled = false;
    }
  });
  document.body.append(dialog); dialog.showModal(); token.focus();
}
function initialize() {
  if (initialized) return;
  initialized = true;
  el('requests-panel').innerHTML = `
    <div class="requests-heading">
      <button id="requests-toggle" aria-expanded="false" aria-controls="requests-content"><span id="requests-chevron" aria-hidden="true">▸</span> Pull / merge requests</button>
      <button id="requests-gear" class="mini" title="Request settings" aria-label="Request settings" aria-expanded="false" aria-controls="requests-settings">⚙</button>
    </div>
    <div id="requests-content" class="hidden">
    <div id="requests-settings" class="hidden">
    <div class="requests-controls"><select id="requests-remote" aria-label="Request repository remote"></select>
      <select id="requests-provider" aria-label="Hosting provider"><option value="">Provider…</option><option value="github">GitHub</option><option value="gitlab">GitLab</option></select></div>
    <div id="requests-repo"></div>
    <div class="requests-controls"><button id="requests-connect" class="mini">Connect</button><button id="requests-disconnect" class="mini">Disconnect</button><button id="requests-refresh" class="mini">Refresh</button></div>
    </div>
    <div id="requests-status" role="status"></div>
    <details open><summary>For me <span id="requests-mine-count"></span></summary><small>Authored, assigned, or directly requested to review</small><ul id="requests-mine"></ul></details>
    <details open><summary>All open <span id="requests-all-count"></span></summary><ul id="requests-all"></ul></details>
    </div>`;
  const expand = (open: boolean) => {
    el('requests-content').classList.toggle('hidden', !open);
    el('requests-toggle').setAttribute('aria-expanded', String(open));
    el('requests-chevron').textContent = open ? '▾' : '▸';
    if (!open) {
      el('requests-settings').classList.add('hidden');
      el('requests-gear').setAttribute('aria-expanded', 'false');
    }
  };
  el('requests-toggle').addEventListener('click', () => expand(el('requests-content').classList.contains('hidden')));
  el('requests-gear').addEventListener('click', () => {
    const open = el('requests-settings').classList.contains('hidden');
    expand(true);
    el('requests-settings').classList.toggle('hidden', !open);
    el('requests-gear').setAttribute('aria-expanded', String(open));
  });
  select('requests-remote').addEventListener('change', () => { setProvider(); void refresh(); });
  select('requests-provider').addEventListener('change', () => { const t = selected(); if (t) rememberProvider(t); void refresh(); });
  el('requests-refresh').addEventListener('click', () => void discover());
  el('requests-connect').addEventListener('click', connect);
  el('requests-disconnect').addEventListener('click', async () => {
    if (!selected() || !args().provider) return;
    const input = args(); ++version; clear();
    try { await invoke('request_disconnect', input); if (path === input.path) await refresh(); }
    catch (e) { status(String(e)); }
  });
  setInterval(() => { if (path && !busy && !document.hidden) void refresh(); }, 120000);
}
export function showRequests(repoPath: string | null) {
  initialize();
  const next = repoPath ?? '';
  el('requests-panel').classList.toggle('hidden', !next);
  if (path === next) return;
  path = next; ++version; busy = false; clear();
  if (path) void discover();
}
