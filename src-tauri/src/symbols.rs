// A code index: enough to answer "where is this defined?" on a Ctrl+Click,
// without a compiler or a language server.
//
// Every tracked source file is read once and walked line by line. Comments and
// the insides of strings are blanked out first, so a brace in a comment or a
// semicolon in a string cannot be read as code; braces are then counted to know
// what is nested inside what, and declarations are recognised by shape rather
// than by grammar. That is shallow on purpose: it costs one pass over the repo,
// it needs no build system, and where it is wrong it is wrong visibly (an
// unknown macro in front of a function, say) rather than subtly.
//
// What comes out is, per file: functions and their prototypes, types, macros,
// file-scope variables, struct fields, and the parameters and locals of each
// function together with the line range they live in. That range is what makes
// a local beat a global of the same name when the click is inside the function.

use crate::git_ro;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024; // generated or minified — skip

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Function,  // the implementation, with a body
    Prototype, // a declaration without one
    Type,      // struct / union / enum / typedef / class / interface / trait
    Macro,
    Variable, // file scope
    Field,    // member of a type
    Local,    // declared inside a function body
    Param,
}

impl Kind {
    fn is_definition(self) -> bool {
        !matches!(self, Kind::Prototype | Kind::Local | Kind::Param)
    }
}

#[derive(Clone, Serialize, Debug)]
pub struct Symbol {
    pub name: String,
    pub kind: Kind,
    pub file: String,
    pub line: u32,
    pub text: String,  // the source line, trimmed — what the picker shows
    pub scope: String, // enclosing function or type, empty at file scope
    pub rank: u8,      // how good a target this is; equal ranks mean a real choice
    #[serde(skip)]
    pub scope_start: u32,
    #[serde(skip)]
    pub scope_end: u32, // 0 until the enclosing block closes
}

#[derive(Serialize)]
pub struct IndexStats {
    pub files: usize,
    pub symbols: usize,
    pub parsed: usize, // files read this time round; 0 means nothing had changed
}

// ---------------------------------------------------------------- languages

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    C,
    Rust,
    Web,
    Python,
}

pub fn lang_of(file: &str) -> Option<Lang> {
    let ext = file.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "c" | "h" | "cpp" | "hpp" | "cc" | "hh" | "cxx" | "hxx" | "inl" | "ino" => Lang::C,
        "rs" => Lang::Rust,
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => Lang::Web,
        "py" => Lang::Python,
        _ => return None,
    })
}

// Words that can never be the name of anything, so a line that ends on one has
// declared nothing. Deliberately narrow: words that are structure in one
// language are ordinary names in another — `from` is a keyword to an import and
// a perfectly good parameter, `type` and `in` likewise — and those are caught
// where they are read as structure, not here.
const KEYWORDS: &[&str] = &[
    "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return",
    "goto", "sizeof", "typeof", "instanceof", "try", "catch", "finally", "throw", "new", "delete",
    "typedef", "struct", "union", "enum", "class", "namespace", "template", "typename", "operator",
    "public", "private", "protected", "virtual", "explicit", "friend", "constexpr", "noexcept",
    "mutable", "register", "restrict", "volatile", "extern", "inline", "static", "const",
    "unsigned", "signed", "auto", "void", "nullptr", "null", "undefined", "true", "false", "this",
    "fn", "let", "mut", "impl", "pub", "crate", "self", "super", "where", "dyn", "loop", "unsafe",
    "use", "function", "var", "def", "lambda", "elif", "pass", "raise", "assert", "global",
    "nonlocal", "import", "export", "extends", "implements", "async", "await", "yield",
];

fn is_keyword(word: &str) -> bool {
    KEYWORDS.contains(&word)
}

// keywords that can never be the type in front of a declaration
const NOT_A_TYPE: &[&str] = &[
    "return", "case", "goto", "else", "do", "break", "continue", "new", "delete", "throw", "in",
    "of", "yield", "await", "and", "or", "not", "is", "assert", "del", "raise", "with", "import",
    "from",
];

fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '$'
}

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

// every identifier in a line, with where it starts
fn idents(text: &str) -> Vec<(String, usize)> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if is_ident_start(chars[i]) {
            let start = i;
            while i < chars.len() && is_ident_char(chars[i]) {
                i += 1;
            }
            out.push((chars[start..i].iter().collect(), start));
        } else {
            i += 1;
        }
    }
    out
}

// ------------------------------------------------------------------ cleaning

// Blank comments and string bodies, keeping every line and column in place, so
// that later passes can trust braces, parens and semicolons and still report
// the line a symbol really sits on.
pub fn blank_noise(src: &str, lang: Lang) -> Vec<String> {
    let mut out = Vec::new();
    let mut block = 0usize; // /* */, which Rust lets you nest
    let mut triple: Option<char> = None; // Python docstrings
    for raw in src.lines() {
        let chars: Vec<char> = raw.chars().collect();
        let mut line: Vec<char> = Vec::with_capacity(chars.len());
        let mut quote: Option<char> = None;
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            let next = chars.get(i + 1).copied().unwrap_or(' ');
            if let Some(q) = triple {
                if c == q && next == q && chars.get(i + 2).copied() == Some(q) {
                    triple = None;
                    line.extend([' ', ' ', ' ']);
                    i += 3;
                } else {
                    line.push(' ');
                    i += 1;
                }
                continue;
            }
            if block > 0 {
                if c == '*' && next == '/' {
                    block -= 1;
                    line.extend([' ', ' ']);
                    i += 2;
                } else if lang == Lang::Rust && c == '/' && next == '*' {
                    block += 1;
                    line.extend([' ', ' ']);
                    i += 2;
                } else {
                    line.push(' ');
                    i += 1;
                }
                continue;
            }
            if let Some(q) = quote {
                if c == '\\' {
                    line.push(' ');
                    if i + 1 < chars.len() {
                        line.push(' ');
                    }
                    i += 2;
                    continue;
                }
                if c == q {
                    quote = None;
                    line.push(c);
                } else {
                    line.push(' ');
                }
                i += 1;
                continue;
            }
            // a comment runs to the end of the line
            if (lang == Lang::Python && c == '#') || (lang != Lang::Python && c == '/' && next == '/')
            {
                break;
            }
            if lang != Lang::Python && c == '/' && next == '*' {
                block = 1;
                line.extend([' ', ' ']);
                i += 2;
                continue;
            }
            if lang == Lang::Python
                && (c == '"' || c == '\'')
                && next == c
                && chars.get(i + 2).copied() == Some(c)
            {
                triple = Some(c);
                line.extend([' ', ' ', ' ']);
                i += 3;
                continue;
            }
            // In Rust a lone ' is a lifetime, not a string that never ends
            let opens_char = c == '\''
                && (lang != Lang::Rust
                    || next == '\\'
                    || chars.get(i + 2).copied() == Some('\''));
            if c == '"' || opens_char || (lang == Lang::Web && c == '`') {
                quote = Some(c);
                line.push(c);
                i += 1;
                continue;
            }
            line.push(c);
            i += 1;
        }
        out.push(line.into_iter().collect());
    }
    out
}

// ------------------------------------------------------------------ parsing

struct Frame {
    name: String,
    is_type: bool,
    start: u32,
    out_start: usize,
}

fn push_symbol(
    out: &mut Vec<Symbol>,
    name: &str,
    kind: Kind,
    file: &str,
    line: u32,
    text: &str,
    frame: Option<&Frame>,
) {
    if name.is_empty() || is_keyword(name) {
        return;
    }
    let (scope, scope_start) = match frame {
        Some(f) => (f.name.clone(), f.start),
        None => (String::new(), 0),
    };
    out.push(Symbol {
        name: name.to_string(),
        kind,
        file: file.to_string(),
        line,
        text: text.trim().chars().take(200).collect(),
        scope,
        rank: 0,
        scope_start,
        scope_end: 0,
    });
}

pub fn parse(file: &str, src: &str) -> Vec<Symbol> {
    let Some(lang) = lang_of(file) else {
        return Vec::new();
    };
    let lines = blank_noise(src, lang);
    let mut out = Vec::new();
    if lang == Lang::Python {
        parse_python(file, &lines, &mut out);
    } else {
        parse_braced(file, &lines, lang, &mut out);
    }
    out
}

fn balance(text: &str) -> i32 {
    text.chars().fold(0, |n, c| match c {
        '(' => n + 1,
        ')' => n - 1,
        _ => n,
    })
}

fn parse_braced(file: &str, lines: &[String], lang: Lang, out: &mut Vec<Symbol>) {
    let mut stack: Vec<Frame> = Vec::new();
    let mut pending: Option<Frame> = None; // a header waiting for its {
    let mut i = 0usize;
    while i < lines.len() {
        // a signature may be split over several lines — read on until the
        // parentheses close, so the whole header can be judged at once
        let mut text = lines[i].trim().to_string();
        let mut last = i;
        while balance(&text) > 0 && last + 1 < lines.len() && last - i < 16 {
            last += 1;
            text.push(' ');
            text.push_str(lines[last].trim());
        }
        let opens_next = !text.contains('{')
            && lines
                .get(last + 1..)
                .and_then(|rest| rest.iter().find(|l| !l.trim().is_empty()))
                .is_some_and(|l| l.trim_start().starts_with('{'));
        let named = stack.iter().rev().find(|f| !f.name.is_empty());
        let header = classify(
            file,
            &text,
            (i + 1) as u32,
            lang,
            named,
            stack.last().map(|f| f.is_type).unwrap_or(false),
            stack.is_empty(),
            text.contains('{') || opens_next,
            out,
        );
        if let Some(frame) = header {
            pending = Some(frame);
        }
        for k in i..=last {
            for c in lines[k].chars() {
                match c {
                    '{' => {
                        let frame = pending.take().unwrap_or(Frame {
                            name: String::new(),
                            is_type: false,
                            start: (k + 1) as u32,
                            out_start: out.len(),
                        });
                        stack.push(frame);
                    }
                    '}' => {
                        if let Some(frame) = stack.pop() {
                            close_frame(&frame, (k + 1) as u32, out);
                        }
                    }
                    ';' => pending = None, // it was a declaration after all
                    _ => {}
                }
            }
        }
        i = last + 1;
    }
    let end = lines.len() as u32;
    while let Some(frame) = stack.pop() {
        close_frame(&frame, end, out);
    }
}

fn close_frame(frame: &Frame, line: u32, out: &mut [Symbol]) {
    if frame.name.is_empty() {
        return;
    }
    for s in out.iter_mut().skip(frame.out_start) {
        if s.scope_end == 0 && s.scope == frame.name {
            s.scope_end = line;
        }
    }
}

// Reads one logical line and records what it declares. Returns the name of a
// block this line opens (function or type), so the caller can attach whatever
// is found inside it to this scope.
#[allow(clippy::too_many_arguments)]
fn classify(
    file: &str,
    text: &str,
    line: u32,
    lang: Lang,
    frame: Option<&Frame>,
    in_type: bool,
    at_file_scope: bool,
    has_body: bool,
    out: &mut Vec<Symbol>,
) -> Option<Frame> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    // #define NAME / #define NAME(a, b) — the only preprocessor line worth an entry
    if let Some(rest) = trimmed.strip_prefix('#') {
        let rest = rest.trim_start();
        if let Some(def) = rest.strip_prefix("define ") {
            if let Some((name, _)) = idents(def).first() {
                push_symbol(out, name, Kind::Macro, file, line, trimmed, None);
            }
        }
        return None;
    }
    let in_function = frame.is_some_and(|f| !f.is_type);

    // `} Sensor;` — where an anonymous `typedef struct { … }` finally gets its
    // name. One identifier and nothing else, or this would swallow `} while (x);`
    if trimmed.starts_with('}') && trimmed.ends_with(';') {
        let names = idents(trimmed);
        if names.len() == 1 && !is_keyword(&names[0].0) {
            push_symbol(out, &names[0].0, Kind::Type, file, line, trimmed, None);
        }
        return None;
    }

    // `for (int i = 0; …)` declares i, which the shape rules below would miss
    // because the line neither ends in a semicolon nor opens a plain block
    if matches!(lang, Lang::C | Lang::Web) && trimmed.starts_with("for") {
        if let Some(open) = trimmed.find('(') {
            if trimmed[..open].trim() == "for" {
                let init = trimmed[open + 1..].split(';').next().unwrap_or("");
                for name in declared_names(&format!("{init};"), lang, in_function) {
                    push_symbol(out, &name, Kind::Local, file, line, trimmed, frame);
                }
            }
        }
        return None;
    }

    // a type header: struct/enum/union/class/interface/trait NAME
    if let Some(name) = type_header(trimmed, lang) {
        push_symbol(out, &name, Kind::Type, file, line, trimmed, None);
        if has_body {
            return Some(Frame {
                name,
                is_type: true,
                start: line,
                out_start: out.len(),
            });
        }
        return None;
    }
    // typedef ... NAME;  /  type NAME = ...
    if let Some(name) = typedef_name(trimmed, lang) {
        push_symbol(out, &name, Kind::Type, file, line, trimmed, None);
        return None;
    }

    // a function: a name, a parameter list, and either a body or a semicolon
    if let Some((name, params)) = signature(trimmed, lang, in_function) {
        if has_body {
            push_symbol(
                out,
                &name,
                Kind::Function,
                file,
                line,
                trimmed,
                frame.filter(|f| f.is_type),
            );
            // the frame has to start BEFORE the parameters go in, or closing
            // it would skip right over them and leave them without a range
            let opened = Frame {
                name: name.clone(),
                is_type: false,
                start: line,
                out_start: out.len(),
            };
            for p in params {
                push_symbol(out, &p, Kind::Param, file, line, trimmed, Some(&opened));
            }
            return Some(opened);
        }
        if !in_function {
            // inside a body the same shape is a call, not a declaration
            push_symbol(out, &name, Kind::Prototype, file, line, trimmed, None);
        }
        return None;
    }

    // whatever is left that ends in a semicolon (or is a Rust/Web binding)
    let _ = at_file_scope;
    for name in declared_names(trimmed, lang, in_function) {
        let kind = if in_type {
            Kind::Field
        } else if in_function {
            Kind::Local
        } else {
            Kind::Variable
        };
        push_symbol(out, &name, kind, file, line, trimmed, frame);
    }
    None
}

fn type_header(text: &str, lang: Lang) -> Option<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let keys: &[&str] = match lang {
        Lang::C => &["struct", "union", "enum", "class"],
        Lang::Rust => &["struct", "enum", "union", "trait", "impl", "mod"],
        Lang::Web => &["class", "interface", "enum", "namespace"],
        Lang::Python => &["class"],
    };
    // skip the words that only qualify what follows
    let mut i = 0;
    while i < words.len()
        && matches!(
            words[i],
            "pub" | "static" | "const" | "export" | "default" | "abstract" | "declare" | "typedef"
        )
    {
        i += 1;
    }
    let key = *words.get(i)?;
    if !keys.contains(&key) {
        return None;
    }
    // `impl Display for Point {` names the type last, `impl Point {` names it first
    if key == "impl" {
        let head = text.split('{').next().unwrap_or(text);
        let name = idents(head).pop()?.0;
        return if is_keyword(&name) { None } else { Some(name) };
    }
    let rest = words.get(i + 1).copied().unwrap_or("");
    let name: String = rest.chars().take_while(|&c| is_ident_char(c)).collect();
    if name.is_empty() {
        // `typedef struct {` — the body has no name here; it gets one at the `}`
        return if rest.is_empty() || rest.starts_with('{') {
            Some(String::new())
        } else {
            None
        };
    }
    if is_keyword(&name) {
        return None;
    }
    // A header is followed by its body, its end, or what it derives from.
    // Anything else means this line only *uses* the type: `struct Foo f;`
    let after = rest[name.len()..].trim_start();
    let follows = after.chars().next().or_else(|| {
        words
            .get(i + 2)
            .and_then(|w| w.chars().next())
    });
    match follows {
        None | Some('{') | Some(';') | Some(':') | Some('<') | Some('(') => Some(name),
        _ => None,
    }
}

fn typedef_name(text: &str, lang: Lang) -> Option<String> {
    if lang == Lang::C && text.starts_with("typedef ") {
        let head = text.split(';').next()?;
        // typedef void (*handler_t)(int) — the name is inside the parentheses
        if let Some(open) = head.find("(*") {
            let rest = &head[open + 2..];
            let name: String = rest.chars().take_while(|&c| is_ident_char(c)).collect();
            if !name.is_empty() {
                return Some(name);
            }
        }
        let name = idents(head).pop()?.0;
        if !is_keyword(&name) {
            return Some(name);
        }
        return None;
    }
    if matches!(lang, Lang::Rust | Lang::Web) {
        let words: Vec<&str> = text.split_whitespace().collect();
        let mut i = 0;
        while i < words.len() && matches!(words[i], "pub" | "export" | "declare" | "default") {
            i += 1;
        }
        if words.get(i) == Some(&"type") {
            let name: String = words
                .get(i + 1)?
                .chars()
                .take_while(|&c| is_ident_char(c))
                .collect();
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

// name + parameter names, when the line looks like a function header
fn signature(text: &str, lang: Lang, in_function: bool) -> Option<(String, Vec<String>)> {
    let chars: Vec<char> = text.chars().collect();
    let open = text.find('(')?;
    let before: String = chars[..open].iter().collect();
    // an initialiser or a call: `x = f(...)`, `obj.f(...)`, `p->f(...)`
    if before.contains('=') || before.contains('.') || before.contains("->") {
        return None;
    }
    let mut name = String::new();
    let mut end = open;
    while end > 0 && chars[end - 1].is_whitespace() {
        end -= 1;
    }
    let mut start = end;
    while start > 0 && is_ident_char(chars[start - 1]) {
        start -= 1;
    }
    if start < end {
        name = chars[start..end].iter().collect();
    }
    if name.is_empty() || is_keyword(&name) {
        return None;
    }
    let lead: String = chars[..start].iter().collect();
    let lead_words: Vec<&str> = lead.split_whitespace().collect();
    let declares = match lang {
        // `fn name(`, or a method inside an impl block
        Lang::Rust => lead_words.contains(&"fn"),
        // `function name(`, `name(args) {` as a class method, `async name(`
        Lang::Web => {
            lead_words.contains(&"function")
                || lead_words.iter().all(|w| {
                    matches!(
                        *w,
                        "public" | "private" | "protected" | "static" | "async" | "export" | "get"
                            | "set" | "abstract" | "readonly" | "*"
                    )
                })
        }
        // C needs a return type in front, or it is a call
        Lang::C => !lead_words.is_empty() && !lead_words.iter().any(|w| NOT_A_TYPE.contains(w)),
        Lang::Python => lead_words.contains(&"def"),
    };
    if !declares {
        return None;
    }
    // C: a call inside a body has no type in front, which the check above
    // catches; a prototype inside a body is not a thing worth finding
    if lang == Lang::C && in_function && !text.contains('{') {
        return None;
    }
    let close = matching_paren(&chars, open)?;
    let inside: String = chars[open + 1..close].iter().collect();
    Some((name, param_names(&inside, lang)))
}

fn matching_paren(chars: &[char], open: usize) -> Option<usize> {
    let mut depth = 0;
    for (i, &c) in chars.iter().enumerate().skip(open) {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn param_names(inside: &str, lang: Lang) -> Vec<String> {
    let mut out = Vec::new();
    for chunk in split_top_level(inside, ',') {
        let chunk = chunk.trim();
        if chunk.is_empty() || chunk == "void" || chunk == "..." {
            continue;
        }
        let name = match lang {
            // `name: Type` — the name comes first
            Lang::Rust | Lang::Web | Lang::Python => {
                let head = chunk.split(':').next().unwrap_or(chunk);
                let head = head.split('=').next().unwrap_or(head);
                idents(head).into_iter().next().map(|(n, _)| n)
            }
            // `const char *name[2]` — the name is the last word before any [
            Lang::C => {
                let head = chunk.split('[').next().unwrap_or(chunk);
                let head = head.split('=').next().unwrap_or(head);
                idents(head).pop().map(|(n, _)| n)
            }
        };
        if let Some(name) = name {
            if !is_keyword(&name) && !name.is_empty() {
                out.push(name);
            }
        }
    }
    out
}

fn split_top_level(text: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0;
    let mut current = String::new();
    for c in text.chars() {
        match c {
            '(' | '[' | '{' | '<' => depth += 1,
            ')' | ']' | '}' | '>' => depth -= 1,
            _ => {}
        }
        if c == sep && depth == 0 {
            out.push(std::mem::take(&mut current));
        } else {
            current.push(c);
        }
    }
    out.push(current);
    out
}

// Names bound by a declaration line: `int a, b = 2;`, `let x = 1`, `pub const N: u32 = 4;`
fn declared_names(text: &str, lang: Lang, in_function: bool) -> Vec<String> {
    let mut out = Vec::new();
    match lang {
        Lang::Rust | Lang::Web => {
            let words: Vec<&str> = text.split_whitespace().collect();
            let mut i = 0;
            while i < words.len() && matches!(words[i], "pub" | "export" | "declare" | "default") {
                i += 1;
            }
            let binder = match words.get(i) {
                Some(&"let") | Some(&"const") | Some(&"static") | Some(&"var") => true,
                _ => false,
            };
            if !binder {
                return out;
            }
            let mut rest = words[i + 1..].join(" ");
            if rest.starts_with("mut ") {
                rest = rest[4..].to_string();
            }
            let head = rest.split('=').next().unwrap_or(&rest).to_string();
            // `let (a, b) = ...` binds both
            for chunk in split_top_level(head.trim_matches(|c| c == '(' || c == ')'), ',') {
                let chunk = chunk.split(':').next().unwrap_or(&chunk).to_string();
                if let Some((name, _)) = idents(&chunk).into_iter().next() {
                    out.push(name);
                }
            }
        }
        Lang::C => {
            if !text.ends_with(';') {
                return out;
            }
            let head = text.trim_end_matches(';');
            // a function pointer: `void (*cb)(int);`
            if let Some(at) = head.find("(*") {
                let name: String = head[at + 2..]
                    .chars()
                    .take_while(|&c| is_ident_char(c))
                    .collect();
                if !name.is_empty() && !is_keyword(&name) {
                    out.push(name);
                }
                return out;
            }
            let chunks = split_top_level(head, ',');
            for (n, chunk) in chunks.iter().enumerate() {
                let decl = chunk.split('=').next().unwrap_or(chunk);
                // anything but a plain declarator means this is an expression
                if decl.contains(['(', ')', '+', '-', '.', '/', '%', '?', '!', '|']) {
                    return Vec::new();
                }
                let before_index = decl.split('[').next().unwrap_or(decl);
                let names = idents(before_index);
                // the first chunk carries the type, so it needs two words
                if n == 0 {
                    if names.len() < 2 {
                        return Vec::new();
                    }
                    let type_word = &names[names.len() - 2].0;
                    if NOT_A_TYPE.contains(&type_word.as_str()) {
                        return Vec::new();
                    }
                }
                if let Some((name, _)) = names.last() {
                    if !is_keyword(name) {
                        out.push(name.clone());
                    }
                }
            }
            // `int a;` at file scope is a variable; the same line in a body is a
            // local, which the caller decides — nothing to do here
            let _ = in_function;
        }
        Lang::Python => {}
    }
    out
}

// Python has no braces: indentation gives the scope, and only def/class/= matter
fn parse_python(file: &str, lines: &[String], out: &mut Vec<Symbol>) {
    struct PyFrame {
        name: String,
        indent: usize,
        start: u32,
        out_start: usize,
        is_class: bool,
    }
    let mut stack: Vec<PyFrame> = Vec::new();
    for (n, raw) in lines.iter().enumerate() {
        let line = (n + 1) as u32;
        if raw.trim().is_empty() {
            continue;
        }
        let indent = raw.len() - raw.trim_start().len();
        while stack.last().is_some_and(|f| indent <= f.indent) {
            let frame = stack.pop().unwrap();
            for s in out.iter_mut().skip(frame.out_start) {
                if s.scope_end == 0 && s.scope == frame.name {
                    s.scope_end = line - 1;
                }
            }
        }
        let text = raw.trim();
        let frame = stack.last();
        let scope = frame.map(|f| Frame {
            name: f.name.clone(),
            is_type: f.is_class,
            start: f.start,
            out_start: f.out_start,
        });
        if let Some(rest) = text.strip_prefix("def ").or(text.strip_prefix("async def ")) {
            let name: String = rest.chars().take_while(|&c| is_ident_char(c)).collect();
            push_symbol(
                out,
                &name,
                Kind::Function,
                file,
                line,
                text,
                scope.as_ref().filter(|f| f.is_type),
            );
            let opened = Frame {
                name: name.clone(),
                is_type: false,
                start: line,
                out_start: out.len(),
            };
            if let Some(open) = text.find('(') {
                let chars: Vec<char> = text.chars().collect();
                if let Some(close) = matching_paren(&chars, open) {
                    let inside: String = chars[open + 1..close].iter().collect();
                    for p in param_names(&inside, Lang::Python) {
                        if p != "self" && p != "cls" {
                            push_symbol(out, &p, Kind::Param, file, line, text, Some(&opened));
                        }
                    }
                }
            }
            stack.push(PyFrame {
                name,
                indent,
                start: line,
                out_start: out.len(),
                is_class: false,
            });
            continue;
        }
        if let Some(rest) = text.strip_prefix("class ") {
            let name: String = rest.chars().take_while(|&c| is_ident_char(c)).collect();
            push_symbol(out, &name, Kind::Type, file, line, text, None);
            stack.push(PyFrame {
                name,
                indent,
                start: line,
                out_start: out.len(),
                is_class: true,
            });
            continue;
        }
        // a plain binding: NAME = ... (but not ==, +=, or a comparison)
        if let Some(eq) = text.find('=') {
            let (head, after) = text.split_at(eq);
            if after.starts_with("==") || head.ends_with(['=', '!', '<', '>', '+', '-', '*', '/']) {
                continue;
            }
            let head = head.split(':').next().unwrap_or(head);
            let names = idents(head);
            if names.len() == 1 && !head.contains(['.', '[']) {
                let kind = match frame {
                    Some(f) if f.is_class => Kind::Field,
                    Some(_) => Kind::Local,
                    None => Kind::Variable,
                };
                push_symbol(out, &names[0].0, kind, file, line, text, scope.as_ref());
            }
        }
    }
    let end = lines.len() as u32;
    for frame in stack {
        for s in out.iter_mut().skip(frame.out_start) {
            if s.scope_end == 0 && s.scope == frame.name {
                s.scope_end = end;
            }
        }
    }
}

// ------------------------------------------------------------------- ranking

fn stem(file: &str) -> &str {
    let name = file.rsplit('/').next().unwrap_or(file);
    name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name)
}

// How good a jump target this symbol is for a click on `name` at from_file:from_line.
// Lower is better; the first entry is what a Ctrl+Click follows.
fn rank(s: &Symbol, from_file: &str, from_line: u32, here: Option<Kind>) -> (u8, u32) {
    let same_file = s.file == from_file;
    let near = |a: u32, b: u32| if a > b { a - b } else { b - a };
    if same_file && s.line == from_line {
        return (9, 0); // where the click already is
    }
    if matches!(s.kind, Kind::Local | Kind::Param) {
        let in_scope = same_file
            && s.scope_start <= from_line
            && s.scope_end >= from_line
            && s.line <= from_line;
        return if in_scope {
            (0, from_line - s.line) // the nearest declaration above wins
        } else {
            (8, 0) // someone else's local
        };
    }
    // standing on one half of a function: the other half is the target
    let counterpart = matches!(
        (here, s.kind),
        (Some(Kind::Function), Kind::Prototype) | (Some(Kind::Prototype), Kind::Function)
    );
    if counterpart {
        return (1, 0);
    }
    let same_stem = stem(&s.file) == stem(from_file);
    let group = match (s.kind.is_definition(), same_file, same_stem) {
        (true, true, _) => 2,
        (true, false, true) => 3, // the .c next to the .h, or the other way round
        (true, false, false) => 4,
        (false, true, _) => 5,
        (false, false, true) => 6,
        (false, false, false) => 7,
    };
    (group, if same_file { near(s.line, from_line) } else { 0 })
}

pub fn rank_hits(mut hits: Vec<Symbol>, from_file: &str, from_line: u32) -> Vec<Symbol> {
    let here = hits
        .iter()
        .find(|s| s.file == from_file && s.line == from_line)
        .map(|s| s.kind);
    hits.sort_by(|a, b| {
        rank(a, from_file, from_line, here)
            .cmp(&rank(b, from_file, from_line, here))
            .then_with(|| a.file.cmp(&b.file))
            .then_with(|| a.line.cmp(&b.line))
    });
    hits.truncate(50);
    for s in hits.iter_mut() {
        s.rank = rank(s, from_file, from_line, here).0;
    }
    hits
}

// --------------------------------------------------------------------- index

struct Indexed {
    symbols: Vec<Symbol>,
    stamp: (u64, u64), // modified time, length — a cheap "has this changed"
}

static INDEX: Mutex<Option<HashMap<String, HashMap<String, Indexed>>>> = Mutex::new(None);

fn stamp_of(meta: &std::fs::Metadata) -> (u64, u64) {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    (modified, meta.len())
}

// Rebuild what has changed and nothing else: the file list comes from git, and
// a file is only re-read when its size or modified time moved. The first call
// on a repo reads everything; later ones usually read nothing at all.
fn refresh(path: &str) -> Result<IndexStats, String> {
    let listed = git_ro(path, &["ls-files", "-z"])?;
    let mut guard = INDEX.lock().map_err(|e| e.to_string())?;
    let repos = guard.get_or_insert_with(HashMap::new);
    let files = repos.entry(path.to_string()).or_insert_with(HashMap::new);
    let mut seen = std::collections::HashSet::new();
    let mut parsed = 0usize;
    for name in listed.split('\0').filter(|f| !f.is_empty()) {
        if lang_of(name).is_none() {
            continue;
        }
        seen.insert(name.to_string());
        let full = std::path::Path::new(path).join(name);
        let Ok(meta) = std::fs::metadata(&full) else {
            continue;
        };
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let stamp = stamp_of(&meta);
        if files.get(name).is_some_and(|f| f.stamp == stamp) {
            continue;
        }
        let Ok(src) = std::fs::read_to_string(&full) else {
            continue;
        };
        parsed += 1;
        files.insert(
            name.to_string(),
            Indexed {
                symbols: parse(name, &src),
                stamp,
            },
        );
    }
    files.retain(|name, _| seen.contains(name));
    Ok(IndexStats {
        files: files.len(),
        symbols: files.values().map(|f| f.symbols.len()).sum(),
        parsed,
    })
}

#[tauri::command]
pub async fn symbol_index(path: String) -> Result<IndexStats, String> {
    refresh(&path)
}

// Every place `name` is defined, best guess first.
#[tauri::command]
pub async fn symbol_lookup(
    path: String,
    name: String,
    file: String,
    line: u32,
) -> Result<Vec<Symbol>, String> {
    if name.is_empty() {
        return Ok(Vec::new());
    }
    refresh(&path)?;
    let guard = INDEX.lock().map_err(|e| e.to_string())?;
    let hits: Vec<Symbol> = guard
        .as_ref()
        .and_then(|repos| repos.get(&path))
        .map(|files| {
            files
                .values()
                .flat_map(|f| f.symbols.iter())
                .filter(|s| s.name == name)
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    Ok(rank_hits(hits, &file, line))
}

// Forget a repo's index (closing its tab, or a rebuild after a big checkout).
#[tauri::command]
pub async fn symbol_forget(path: String) -> Result<(), String> {
    let mut guard = INDEX.lock().map_err(|e| e.to_string())?;
    if let Some(repos) = guard.as_mut() {
        repos.remove(&path);
    }
    Ok(())
}
