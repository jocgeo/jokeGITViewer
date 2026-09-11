// Locate brace-delimited function definitions without counting braces in
// comments or strings. Keep offsets into the original file for surgical edits.
export function functionSourceRange(source: string, name: string): { start: number; end: number } {
  const masked = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|R"([^ ()\\\t\r\n]{0,16})\([\s\S]*?\)\1"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g,
    value => value.replace(/[^\r\n]/g, ' '));
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^\\w$])${escaped}\\s*\\(`, 'gm');
  const ranges: { start: number; end: number }[] = [];
  for (const match of masked.matchAll(pattern)) {
    const open = match.index! + match[0].lastIndexOf('(');
    let i = open + 1, depth = 1;
    for (; i < masked.length && depth; i++) {
      if (masked[i] === '(') depth++;
      if (masked[i] === ')') depth--;
    }
    if (depth) continue;
    const tail = masked.slice(i).match(/^\s*(?:(?:const|noexcept|override|final)\s*)*\{/);
    if (!tail) continue; // calls, prototypes and unsupported signatures
    const brace = i + tail[0].lastIndexOf('{');
    depth = 1;
    i = brace + 1;
    for (; i < masked.length && depth; i++) {
      if (masked[i] === '{') depth++;
      if (masked[i] === '}') depth--;
    }
    if (depth) continue;
    const nameOffset = match.index! + match[1].length;
    let start = source.lastIndexOf('\n', nameOffset - 1) + 1;
    // Do not include another declaration sharing the same physical line.
    if (/[;{}]/.test(masked.slice(start, nameOffset))) continue;
    // Include a return type on its own preceding line.
    const previousStart = source.lastIndexOf('\n', start - 2) + 1;
    if (start > 0 && /^[\w:*&<> \t]+$/.test(masked.slice(previousStart, start).trim()) &&
        masked.slice(previousStart, start).trim()) start = previousStart;
    ranges.push({ start, end: i });
  }
  if (ranges.length !== 1) throw new Error(ranges.length
    ? `More than one definition of ${name} exists. Open the whole file to edit it.`
    : `Could not locate a brace-delimited definition of ${name} in the current file. It may have been renamed or use an unsupported syntax.`);
  return ranges[0];
}

export function replaceSourceRange(source: string, range: { start: number; end: number }, replacement: string): string {
  const text = source.includes('\r\n') ? replacement.replace(/\r?\n/g, '\r\n') : replacement;
  return source.slice(0, range.start) + text + source.slice(range.end);
}
