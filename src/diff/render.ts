import { hlLine, hlLines } from "../highlighting";
import { escapeHtml } from "../html";

// Wrap a character range in highlighted HTML without replacing syntax spans.
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
export function intraline(
  oldS: string,
  newS: string,
  lang: string | null = null,
  oHtml?: string, // pre-highlighted (block-aware) HTML when the caller has it
  nHtml?: string
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
    o: markRange(oHtml ?? hlLine(oldS, lang), p, oldS.length - s, "chg"),
    n: markRange(nHtml ?? hlLine(newS, lang), p, newS.length - s, "chg"),
  };
}

// Parse a unified diff into rows with line numbers, per-line coloring, and
// char-level highlighting on paired changed lines.
export function renderUnifiedDiff(diff: string, lang: string | null): string {
  const lines = diff.split("\n");
  // Thousands of per-line DOM parses for character highlights can stall the
  // WebView. Large diffs keep line colors and numbers without that extra work.
  const detailed = lines.length <= 2000 && diff.length <= 300000;
  if (!detailed) lang = null;
  // Pre-pass: rebuild each SIDE of the diff as its own document and
  // highlight it in one go. Per-row highlighting breaks block comments and
  // multi-line strings — continuation lines get coloured as plain code.
  const oldTexts: string[] = [];
  const newTexts: string[] = [];
  const isMetaLine = (l: string) =>
    l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("+++") ||
    l.startsWith("---") || l.startsWith("new file") ||
    l.startsWith("deleted file") || l.startsWith("old mode") ||
    l.startsWith("new mode") || l.startsWith("similarity") ||
    l.startsWith("rename ") || l.startsWith("\\");
  for (const l of lines) {
    if (l === "" || l.startsWith("@@") || isMetaLine(l)) continue;
    if (l.startsWith("+")) newTexts.push(l.slice(1));
    else if (l.startsWith("-")) oldTexts.push(l.slice(1));
    else {
      oldTexts.push(l.slice(1));
      newTexts.push(l.slice(1));
    }
  }
  const oldHl = hlLines(oldTexts, lang);
  const newHl = hlLines(newTexts, lang);
  let oi = 0; // cursor into oldHl
  let ni = 0; // cursor into newHl
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
  let dels: { text: string; ln: number; html: string }[] = [];
  let adds: { text: string; ln: number; html: string }[] = [];
  const flush = () => {
    const pair = Math.min(dels.length, adds.length);
    dels.forEach((d, i) =>
      rows.push(
        row(
          "del",
          String(d.ln),
          "",
          detailed && i < pair
            ? intraline(d.text, adds[i].text, lang, d.html, adds[i].html).o
            : d.html
        )
      )
    );
    adds.forEach((a, i) =>
      rows.push(
        row(
          "add",
          "",
          String(a.ln),
          detailed && i < pair
            ? intraline(dels[i].text, a.text, lang, dels[i].html, a.html).n
            : a.html
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
      adds.push({ text: line.slice(1), ln: newN++, html: newHl[ni++] ?? "" });
    } else if (line.startsWith("-")) {
      dels.push({ text: line.slice(1), ln: oldN++, html: oldHl[oi++] ?? "" });
    } else {
      flush();
      const ctxHtml = newHl[ni++] ?? ""; // context exists on both sides
      oi++;
      rows.push(row("ctx", String(oldN++), String(newN++), ctxHtml));
    }
  }
  flush();
  return rows.join("");
}
