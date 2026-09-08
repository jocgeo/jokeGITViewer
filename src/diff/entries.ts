export interface DiffEntry {
  t: " " | "+" | "-";
  text: string;
  oldLn: number; // old-side line number (0 for pure adds)
  newLn: number; // new-side line number (0 for pure dels)
}

export function parseDiffEntries(diff: string): DiffEntry[] {
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

