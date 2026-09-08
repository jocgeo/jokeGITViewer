// ---- cherry-pick patch builder (single line OR whole hunk) ----
// Works EXACTLY like the staging patch builder: the diff's old side is the
// working tree itself (diff_worktree_to_commit uses -R), so the patch base
// always matches the apply target — no guessing, no drifting line numbers.
// addLns: new-side line numbers to insert; delLns: old-side line numbers to
// remove. A changed line = its del + its add together (replacement).
export function buildCpPatch(
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

