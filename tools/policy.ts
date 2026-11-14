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
