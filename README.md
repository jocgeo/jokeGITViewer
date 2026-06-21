# jokeGITViewer

A fast, lightweight Git GUI for Windows, Linux and macOS — a slimmed-down, open take on visual Git
clients like GitKraken. View your whole history at a glance, manage branches and
stashes, stage and commit, all from one window.

Built with **Tauri 2** (Rust backend + web UI) and the local **`git` CLI** — no
bundled libgit2, no heavy runtime. Small binary, native window.

> ⚠️ Hobby project. Read-and-write Git operations run real `git` commands on your
> repos — review what each action does before using it on important work.

---

## Features

### Commit graph
- Full **commit graph** with colored lanes and merge edges
- Per-author **identicon avatars** on every commit (deterministic — same author
  always gets the same icon)
- **HEAD** highlighted with a ring + badge; **detached HEAD** clearly flagged in red
- **Stashes** shown in the graph as dashed rectangles
- **Uncommitted changes** shown as a dashed "WIP" node on top of HEAD
- Three-column layout: **Branch/Tag · Graph · Commit message**
- Auto-refreshes when the repo changes on disk (external edits, terminal commands)

### Repositories & branches
- **Multiple repos in tabs** — open many, switch, close; reopened automatically on restart
- Sidebar with collapsible **Local / Remote / Stashes / Tags** sections
- Local 🖥 / remote ☁ icons; remote-only branches marked "not checked out locally"
- Branches sorted by most recent commit

### Diffs
- File diffs open in the **main view** with old/new **line numbers**
- Full-file context (not just hunks)
- **Character-level highlighting** — see exactly which characters changed in a line
- Red/green **change minimap** down the right edge (click to jump)

### Staging & commits
- **Commit panel**: stage / unstage files (or all), per-file diff
- Write **summary + description**, **amend** previous commit
- Commit locally (push is a separate, explicit action)

### Toolbar
- **Fetch** · **Pull** · **Push** (current branch only) · **Branch** · **Stash** · **Pop** · **Terminal**
- Hover any button for the exact `git` command + what it does

### Right-click actions
**On a branch / tag** (sidebar or graph badge):
- Checkout · Merge into current · Rebase current onto it
- Reset current branch to a remote branch (soft / hard)
- Create branch here · Cherry-pick · Create tag (lightweight / annotated)
- Copy branch name / SHA · Compare against working directory

**On a commit:**
- Checkout (branch-aware, or detached) · Create worktree · Create branch here
- Cherry-pick · Rebase onto · Reset (soft / mixed / hard) · Revert
- Copy SHA · Compare against working directory · Create tag

**On a stash:**
- Apply · Pop · Delete

Operations that need a clean tree (merge, rebase, cherry-pick, checkout, …)
**auto-stash** dirty changes first so they never get blocked.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Shell | Tauri 2 (Rust) |
| Backend | Rust → local `git` CLI via subprocess |
| Frontend | TypeScript + Vite, hand-rolled SVG graph (no framework) |

---

## Requirements

- Windows 10/11 (WebView2 ships with Windows 11)
- [Git](https://git-scm.com/) on `PATH`
- For building: [Rust](https://rustup.rs/) (1.86+) and [Node.js](https://nodejs.org/) 18+

---

## Build & run

```bash
npm install

# dev (hot reload)
npm run tauri dev

# production build -> installer + exe
npm run tauri build
```

Output after build:
- exe → `src-tauri/target/release/jokeGITViewer.exe`
- installers → `src-tauri/target/release/bundle/` (`.msi`, NSIS `.exe`)

---

## Not yet implemented

Merge/rebase **conflict resolution** (conflicts currently error out), interactive
rebase, undo/redo, commit search, and host integrations (GitHub PRs). See the
project notes for the roadmap.

---

## License

[MIT](LICENSE) © Georg Jocher

Not affiliated with GitKraken or any other Git client. "Git" is a trademark of
the Software Freedom Conservancy.
