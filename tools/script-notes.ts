// What a player is sent of the comments written for readers: nothing. The sources keep their comments; the build takes
// out of the scripts and the page it writes what only a reader needs, and weighs what is left
// (tools/first-frame.ts, "comment and blank text"), so a feature that ships a shader's notes is seen.
//
// The minifier drops a script's comments, but not those in template text, where the shaders are. There a line that is
// wholly a comment is left empty (D1074), shader text (a template that reads as GLSL) loses its comments and trailing
// spaces, and every line left empty in shader text or between statements goes, with its line of the source map.
// Indentation stays: code finds lines of shader text by it (`"  vRel = p;"` in world-surfaces.ts, facade.ts and
// glsl.ts). Other template text is left as it is. Each script so made is checked to mean what it did: its plain text
// the same, its shader text the same words.

import { readFileSync, writeFileSync } from "node:fs";

/**
 * A script as the page is sent it: each line wholly a `//` comment left empty. In the minifier's output a line break
 * is only ever in template text, where such a line is a shader's note, or between statements, where it is a comment
 * anyway. A line holding a backtick, a `$` or a backslash is kept, and no line is taken away, so the source map reads.
 */
export function withoutNotes(js: string): string {
  return js.replace(/\n[ \t]*\/\/[^\n`$\\]*(?=\n)/g, "\n");
}

/** A word that marks template text as shader text; a template that names two or more is GLSL. */
const GLSL_WORD = /\b(?:vec[234]|mat[234]|float|uniform|sampler2D\w*|void|precision|highp|mediump|#define|#version|#ifdef|#endif)\b/g;
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);

export interface Template {
  /** The spans of its text, between its backticks and `${}`s. */
  pieces: [number, number][];
  glsl: boolean;
}

/** A minified script read as far as telling code from text: its comments and its template literals. */
export function scriptText(js: string): { comments: [number, number][]; templates: Template[] } {
  const comments: [number, number][] = [];
  const templates: Template[] = [];
  /** What the scan is in: code (the template whose `${}` it is in, and the braces open there), or a template's text. */
  const stack: { tpl: Template | null; braces: number; inText: boolean }[] = [{ tpl: null, braces: 0, inText: false }];
  let i = 0, from = 0, prev = "", word = "";
  while (i < js.length) {
    const top = stack[stack.length - 1]!;
    const c = js[i]!;
    if (top.inText) {
      if (c === "\\") i += 2;
      else if (c === "`") {
        top.tpl!.pieces.push([from, i]);
        stack.pop();
        i++;
        prev = "`";
        word = "";
      } else if (c === "$" && js[i + 1] === "{") {
        top.tpl!.pieces.push([from, i]);
        stack.pop();
        stack.push({ tpl: top.tpl, braces: 0, inText: false });
        i += 2;
        prev = "{";
        word = "";
      } else i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < js.length && js[j] !== c) j += js[j] === "\\" ? 2 : 1;
      i = j + 1;
      prev = c;
      word = "";
    } else if (c === "`") {
      const tpl: Template = { pieces: [], glsl: false };
      templates.push(tpl);
      stack.push({ tpl, braces: 0, inText: true });
      from = ++i;
    } else if (c === "/" && js[i + 1] === "/") {
      const end = js.indexOf("\n", i);
      comments.push([i, end < 0 ? js.length : end]);
      i = end < 0 ? js.length : end;
    } else if (c === "/" && js[i + 1] === "*") {
      const end = js.indexOf("*/", i + 2);
      comments.push([i, end < 0 ? js.length : end + 2]);
      i = end < 0 ? js.length : end + 2;
    } else if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev) || REGEX_AFTER_WORD.has(word))) {
      // A regular expression: to its closing slash, past any in a class, and its flags.
      let j = i + 1, inClass = false;
      for (; j < js.length && js[j] !== "\n"; j++) {
        if (js[j] === "\\") j++;
        else if (js[j] === "[") inClass = true;
        else if (js[j] === "]") inClass = false;
        else if (js[j] === "/" && !inClass) break;
      }
      for (j++; j < js.length && /[a-z]/.test(js[j]!); j++);
      i = j;
      prev = "/";
      word = "";
    } else {
      if (c === "{") top.braces++;
      else if (c === "}") {
        if (top.braces === 0 && top.tpl !== null) {
          stack.pop();
          stack.push({ tpl: top.tpl, braces: 0, inText: true });
          from = ++i;
          continue;
        }
        top.braces--;
      }
      if (/[\w$]/.test(c)) word = prev === "a" ? word + c : c;
      if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? "a" : c;
      i++;
    }
  }
  for (const t of templates) t.glsl = t.pieces.reduce((n, [a, b]) => n + (js.slice(a, b).match(GLSL_WORD)?.length ?? 0), 0) >= 2;
  return { comments, templates };
}

/** A line of shader text without its comments and trailing spaces, its indentation kept; null where it must stay as it is. */
function bare(line: string): string | null {
  const lead = /^[ \t]*/.exec(line)![0], body = line.slice(lead.length);
  // A backslash at the end joins the next line to it in the template's text.
  if (/(^|[^\\])(\\\\)*\\$/.test(body)) return null;
  if (body.startsWith("//")) return "";
  if (body.includes("\\")) return null;
  const open = body.replace(/\/\*.*?\*\//g, "");
  if (open.includes("/*")) return null;
  return (lead + (open.includes("//") ? open.slice(0, open.indexOf("//")) : open)).trimEnd();
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...B64].map((c, i) => [c, i]));

/** A source map's mappings as each line's segments, every field absolute: its column, then source, line, column and name where given. */
export function decodeMappings(mappings: string): number[][][] {
  const state = [0, 0, 0, 0, 0];
  return mappings.split(";").map((line) => {
    state[0] = 0;
    return line === "" ? [] : line.split(",").map((seg) => {
      const fields: number[] = [];
      let value = 0, shift = 0;
      for (const c of seg) {
        const d = DIGIT.get(c)!;
        value += (d & 31) << shift;
        if (d & 32) shift += 5;
        else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = shift = 0;
        }
      }
      return fields.map((f, k) => (state[k] = state[k]! + f));
    });
  });
}

/** Each line's segments back as mappings. */
export function encodeMappings(lines: readonly (readonly (readonly number[])[])[]): string {
  const state = [0, 0, 0, 0, 0];
  const vlq = (n: number): string => {
    let v = n < 0 ? (-n << 1) | 1 : n << 1, out = "";
    do {
      let d = v & 31;
      v >>>= 5;
      if (v > 0) d |= 32;
      out += B64[d];
    } while (v > 0);
    return out;
  };
  return lines.map((segs) => {
    state[0] = 0;
    return segs.map((seg) => seg.map((f, k) => { const d = f - state[k]!; state[k] = f; return vlq(d); }).join("")).join(",");
  }).join(";");
}

/** A script without what only a reader needs (above), and its source map's mappings to match. */
export function squeezed(js: string, mappings: string): { js: string; mappings: string } {
  const { templates } = scriptText(js);
  const shader = templates.filter((t) => t.glsl).flatMap((t) => t.pieces), text = templates.flatMap((t) => t.pieces);
  const segs = decodeMappings(mappings), lines = js.split("\n");
  const outLines: string[] = [], outSegs: number[][][] = [];
  let at = 0, k = 0, s = 0;
  lines.forEach((line, n) => {
    const start = at, end = at + line.length;
    at = end + 1;
    // The spans are in order: the first that has not ended before this line.
    while (k < shader.length && shader[k]![1] < start) k++;
    while (s < text.length && text[s]![1] < start) s++;
    const inShader = k < shader.length && shader[k]![0] <= start && end <= shader[k]![1];
    const inText = s < text.length && text[s]![0] <= start && end <= text[s]![1];
    const kept = inShader ? (bare(line) ?? line) : line;
    if (kept.trim() === "" && (inShader || !inText) && n < lines.length - 1) return;
    outLines.push(kept);
    outSegs.push((segs[n] ?? []).filter((seg) => seg[0]! <= kept.length));
  });
  return { js: outLines.join("\n"), mappings: encodeMappings(outSegs) };
}

/** A template's text, its pieces joined by a mark for each `${}`. */
const textOf = (js: string, t: Template): string => t.pieces.map(([a, b]) => js.slice(a, b)).join("\u0000");
/** Shader text as its compiler reads it: its words, without comments or spacing. */
const words = (glsl: string): string => glsl.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").split(/\s+/).filter((w) => w !== "").join(" ");

/** What is wrong if `after` does not mean what `before` did: a template not the same, or shader text not the same words. */
export function meaningChanged(before: string, after: string): string | null {
  const a = scriptText(before).templates, b = scriptText(after).templates;
  if (a.length !== b.length) return `${a.length} templates became ${b.length}`;
  for (let k = 0; k < a.length; k++) {
    const x = textOf(before, a[k]!), y = textOf(after, b[k]!);
    if (a[k]!.glsl ? words(x) !== words(y) : x !== y) return `template ${k} changed: ${JSON.stringify(x.slice(0, 80))}`;
  }
  return null;
}

/** Writes the script at `path` as the page is sent it, and its source map beside it to match. Throws if its meaning changed. */
export function finishScript(path: string): void {
  const js = readFileSync(path, "utf8"), mapPath = `${path}.map`;
  const map = JSON.parse(readFileSync(mapPath, "utf8")) as { mappings: string };
  const noted = withoutNotes(js);
  const out = squeezed(noted, map.mappings);
  const changed = meaningChanged(noted, out.js);
  if (changed !== null) throw new Error(`${path}: taking its notes out would change it: ${changed}`);
  writeFileSync(path, out.js);
  writeFileSync(mapPath, JSON.stringify({ ...map, mappings: out.mappings }));
}

/** Bytes of comment and blank text a script carries: comments outside its strings and in its shader text, trailing spaces there, and empty lines but in other template text. */
export function scriptNoteBytes(js: string): number {
  const { comments, templates } = scriptText(js);
  let n = comments.reduce((sum, [a, b]) => sum + b - a, 0);
  // Lines of shader text that end in a line break: a piece's last part runs on into a `${}` or ends the template.
  for (const t of templates) if (t.glsl) for (const [a, b] of t.pieces) for (const line of js.slice(a, b).split("\n").slice(0, -1)) n += line.length - (bare(line) ?? line).length;
  const text = templates.filter((t) => !t.glsl).flatMap((t) => t.pieces);
  let at = 0;
  for (const line of js.split("\n").slice(0, -1)) {
    const start = at;
    at += line.length + 1;
    if (line.trim() === "" && !text.some(([a, b]) => a <= start && start + line.length <= b)) n += line.length + 1;
  }
  return n;
}

/** The page as it is sent: no HTML comments, none in its style or its script, and no empty lines. */
export function pageWithoutNotes(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<style>)([\s\S]*?)(<\/style>)/g, (_, a: string, css: string, b: string) => a + css.replace(/\/\*[\s\S]*?\*\//g, "") + b)
    .replace(/(<script>)([\s\S]*?)(<\/script>)/g, (_, a: string, js: string, b: string) => a + js.replace(/^[ \t]*\/\/.*$/gm, "") + b)
    .replace(/\n[ \t]*(?=\n)/g, "");
}

/** Bytes of comment and blank text in the page. */
export function pageNoteBytes(html: string): number {
  return html.length - pageWithoutNotes(html).length;
}
