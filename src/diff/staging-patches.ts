// split a unified diff into per-hunk mini-patches (header + one hunk each)
export function splitHunkPatches(diff: string): { patch: string; newFile: boolean }[] {
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

// Build a minimal patch that stages/unstages ONLY the selected changed line.
// Stage    (index→worktree diff): other + lines dropped, other − lines → context.
// Unstage  (HEAD→index diff, applied in reverse): other + lines → context,
//          other − lines dropped — so the patch's "new" side matches the index.
export function buildLinePatch(
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
  let keptPreviousLine = false;

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
      keptPreviousLine = false;
      continue;
    }
    if (!minus || done) continue; // header noise / already built
    if (line.startsWith("\\")) {
      // This marker belongs to the preceding source line. Carry it only
      // when that line survived selection (including converted context).
      if (keptPreviousLine) cur.push(line);
      continue;
    }
    if (line.startsWith("+")) {
      const isSel = sel.kind === "add" && newN === sel.ln;
      newN++;
      keptPreviousLine = isSel || forUnstage;
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
      keptPreviousLine = isSel || !forUnstage;
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
    keptPreviousLine = true;
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

