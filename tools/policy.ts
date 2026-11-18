// Reading source for the check's rules. A rule that looks for an import or a banned call must not see comments, and
// must not be fooled by what a string holds: "/*" in a string is not the start of a comment.

/** A "/" after one of these words begins a regular expression, not a division. */
const BEFORE_REGEX = new Set(["return", "typeof", "case", "do", "else", "in", "of", "void", "delete", "throw", "new", "yield", "await"]);

/** Where the string or template that opens at `i` ends: the index after its closing quote. */
function stringEnd(src: string, i: number): number {
  const quote = src[i]!;
  let j = i + 1;
  while (j < src.length) {
    const c = src[j]!;
    if (c === "\\") j += 2;
    else if (c === quote) return j + 1;
    else if (quote !== "`" && c === "\n") return j;
    else if (quote === "`" && c === "$" && src[j + 1] === "{") j = codeEnd(src, j + 2);
    else j++;
  }
  return src.length;
}

/** Where the `${ }` whose inside begins at `i` ends: the index after its closing brace. */
function codeEnd(src: string, i: number): number {
  let depth = 1;
  let j = i;
  while (j < src.length) {
    const c = src[j]!;
    if (c === '"' || c === "'" || c === "`") j = stringEnd(src, j);
    else if (c === "{") (depth++, j++);
    else if (c === "}") {
      j++;
      if (--depth === 0) return j;
    } else j++;
  }
  return src.length;
}

/** Where the regular expression that opens at `i` ends, or -1 if what opens there is not one. */
function regexEnd(src: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j]!;
    if (c === "\n") return -1;
    if (c === "\\") j++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      j++;
      while (j < src.length && /[a-z]/.test(src[j]!)) j++;
      return j;
    }
  }
  return -1;
}

/** An import or export from a named file, a named `import()`, or a bare import: the name is the first group that matched. */
export const IMPORT = /^[ \t]*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^[ \t]*import\s*['"]([^'"]+)['"]/gm;

/**
 * The source with its comments gone and its lines where they were. With `blank`, what strings, templates and regular
 * expressions hold is gone too, leaving their quotes, so that what is left is code and nothing a string could fake.
 */
export function stripComments(src: string, blank = false): string {
  let out = "";
  let word = "";
  let last = "";
  let gap = false;
  const keep = (text: string): string => (blank ? text.replace(/[^\n]/g, "") : text);
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      const end = stringEnd(src, i);
      out += blank ? c + keep(src.slice(i + 1, end - 1)) + c : src.slice(i, end);
      i = end;
      last = c;
      word = "";
    } else if (c === "/" && (last === "" || "(,=:[!&|?{};+-*%<>~^".includes(last) || BEFORE_REGEX.has(word)) && regexEnd(src, i) > 0) {
      const end = regexEnd(src, i);
      out += blank ? "/" + keep(src.slice(i + 1, end)) : src.slice(i, end);
      i = end;
      last = "/";
      word = "";
    } else {
      out += c;
      const space = /\s/.test(c);
      if (/[A-Za-z0-9_$]/.test(c)) word = !gap && /[A-Za-z0-9_$]/.test(last) ? word + c : c;
      else if (!space) word = "";
      if (!space) last = c;
      gap = space;
      i++;
    }
  }
  return out;
}

/** How many times the code, strings aside, calls `import(` or `require(`. */
export function dynamicLoads(src: string): number {
  return (stripComments(src, true).match(/\b(?:import|require)\s*\(/g) ?? []).length;
}

/** Where the bracket that opens at `i` closes, or -1. Strings are blank (stripComments). */
function closeOf(code: string, i: number): number {
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if ((c === ")" || c === "]" || c === "}") && --depth === 0) return j;
  }
  return -1;
}

/** Whether the `)` at `i` closes the condition of an `if`, `for` or `while`, which a statement may follow. */
function closesCondition(code: string, i: number): boolean {
  let depth = 0;
  for (let j = i; j >= 0; j--) {
    const c = code[j]!;
    if (c === ")" || c === "]" || c === "}") depth++;
    else if ((c === "(" || c === "[" || c === "{") && --depth === 0) return /(?:^|[^\w$])(?:if|for|while)\s*$/.test(code.slice(Math.max(0, j - 8), j));
  }
  return false;
}

/** Whether the right side of an assignment that begins at `i` gives an array literal: one at its own level, up to its `;` or `,`. */
function givesLiteral(code: string, i: number): boolean {
  let depth = 0;
  let last = "=";
  for (let j = i; j < code.length; j++) {
    const c = code[j]!;
    if (/\s/.test(c)) continue;
    if (depth === 0 && (c === ";" || c === ",")) return false;
    if (c === "[" && depth === 0 && "=?:|&(,".includes(last)) return true;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (--depth < 0) return false;
    }
    last = c;
  }
  return false;
}

/**
 * What in the code makes an array JavaScriptCore makes every time, even in its top tier: an array literal destructured
 * (`[a, b] = [x, y]`, `const [a, b] = c ? [x, y] : [z, w]`), a literal handed to `set` (`t.set([x, y], k)`), and a
 * destructuring for…of head, which makes an array for each entry of a Map. Each by its line, comments and strings aside.
 */
export function madeArrays(src: string): { line: number; what: "destructured" | "set" | "for" }[] {
  const code = stripComments(src, true);
  const out: { line: number; what: "destructured" | "set" | "for" }[] = [];
  const line = (i: number): number => code.slice(0, i).split("\n").length;
  for (const m of code.matchAll(/\.set\(\s*\[/g)) out.push({ line: line(m.index), what: "set" });
  for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s*\[/g)) out.push({ line: line(m.index), what: "for" });
  for (let i = code.indexOf("["); i >= 0; i = code.indexOf("[", i + 1)) {
    // A pattern begins a statement, follows a condition, or is declared.
    let j = i - 1;
    while (j >= 0 && /\s/.test(code[j]!)) j--;
    const starts = j < 0 || ";{}".includes(code[j]!) || (code[j] === ")" && closesCondition(code, j)) || /(?:^|[^\w$])(?:const|let|var|else)$/.test(code.slice(Math.max(0, j - 5), j + 1));
    if (!starts) continue;
    const end = closeOf(code, i);
    if (end < 0 || code.slice(i + 1, end).trim() === "") continue;
    const eq = /^\s*=(?![=>])/.exec(code.slice(end + 1, end + 64));
    if (eq && givesLiteral(code, end + 1 + eq[0].length)) out.push({ line: line(i), what: "destructured" });
  }
  return out.sort((a, b) => a.line - b.line);
}
