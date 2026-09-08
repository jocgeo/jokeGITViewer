import { escapeHtml } from "./html";
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

export function langForFile(file: string): string | null {
  const base = file.split("/").pop()?.toLowerCase() ?? "";
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  if (base === "cmakelists.txt") return "makefile";
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return HL_EXT[ext] ?? null;
}

// Highlight a whole block at once and hand back per-line HTML.
// Highlighting line-by-line breaks anything that spans lines (block comments,
// multi-line strings): the continuation lines have no idea they are inside it.
// So we highlight the joined text, then split the result on newlines, closing
// every still-open span at the end of a line and reopening it on the next.
export function hlLines(lines: string[], lang: string | null): string[] {
  if (!lang) return lines.map(escapeHtml);
  let html: string;
  try {
    html = hljs.highlight(lines.join("\n"), {
      language: lang,
      ignoreIllegals: true,
    }).value;
  } catch {
    return lines.map(escapeHtml);
  }
  const out: string[] = [];
  const open: string[] = []; // stack of currently open <span ...> tags
  let cur = "";
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) {
        cur += html.slice(i);
        break;
      }
      const tag = html.slice(i, end + 1);
      if (tag.startsWith("</")) open.pop();
      else open.push(tag);
      cur += tag;
      i = end + 1;
    } else if (ch === "\n") {
      out.push(cur + "</span>".repeat(open.length)); // close for this line
      cur = open.join(""); // ...and reopen on the next
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  out.push(cur);
  // hljs never drops or adds lines, but stay defensive about the mapping
  while (out.length < lines.length) out.push("");
  return out.slice(0, lines.length);
}

// highlight ONE line of code (stateless per line — good enough for diffs);
// falls back to plain escaping for unknown languages or hljs errors
export function hlLine(text: string, lang: string | null): string {
  if (!lang || !text) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}


export default hljs;
