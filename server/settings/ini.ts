// Parses ini files as ARK writes them. A key may repeat (a list) or carry an index (`Key[3]=0.5`). A value is words to the end of the
// line, or a struct such as `(A=1,B="x",C=((D=1),(D=2)))`. Nothing here throws. A line that cannot be read is reported with its number.

export type IniNode = string | IniList;

export interface IniList {
  readonly items: readonly IniItem[];
}

/** `Key=value` inside a struct, or a bare value, whose `key` is "". */
export interface IniItem {
  readonly key: string;
  readonly value: IniNode;
}

export interface IniEntry {
  /** As written. "" before any section. */
  readonly section: string;
  readonly key: string;
  /** The number in `Key[3]`, or -1. */
  readonly index: number;
  readonly value: IniNode;
  readonly line: number;
}

export interface IniFile {
  readonly entries: IniEntry[];
  readonly faults: { line: number; why: string }[];
}

export const isList = (n: IniNode | undefined): n is IniList => typeof n === "object";

/** Matches the name without regard to case. */
export function field(list: IniList, name: string): IniNode | undefined {
  const want = name.toLowerCase();
  for (const item of list.items) if (item.key.toLowerCase() === want) return item.value;
  return undefined;
}

/** NaN unless the text is a decimal number and nothing else. */
export function toNumber(text: string): number {
  const t = text.trim();
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
}

/** ARK writes True and False. 1 and 0 are read too. Null for anything else. */
export function toSwitch(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  return t === "true" || t === "1" ? true : t === "false" || t === "0" ? false : null;
}

export function unquote(text: string): string {
  const t = text.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

/** Reads up to a `,` or `)` outside quotes and nested brackets, or to the end of the line when `top`. A string result is the fault. */
function readNode(s: string, at: number, top: boolean): { node: IniNode; end: number } | string {
  let i = at;
  while (i < s.length && s[i] === " ") i++;
  if (s[i] === "(") {
    const items: IniItem[] = [];
    i++;
    for (;;) {
      while (i < s.length && s[i] === " ") i++;
      if (i >= s.length) return "a bracket is not closed";
      if (s[i] === ")") {
        i++;
        break;
      }
      // An item is `Key=value` if an `=` comes before anything that ends or nests it, else a bare value.
      let j = i;
      let key = "";
      while (j < s.length && s[j] !== "=" && s[j] !== "," && s[j] !== ")" && s[j] !== "(" && s[j] !== '"') j++;
      if (s[j] === "=") {
        key = s.slice(i, j).trim();
        if (key === "") return "a field has no name";
        i = j + 1;
      }
      const got = readNode(s, i, false);
      if (typeof got === "string") return got;
      items.push({ key, value: got.node });
      i = got.end;
      while (i < s.length && s[i] === " ") i++;
      if (s[i] === ",") i++;
      else if (s[i] !== ")") return i >= s.length ? "a bracket is not closed" : `"${s[i]}" where a comma or a closing bracket should be`;
    }
    if (top) {
      while (i < s.length && s[i] === " ") i++;
      if (i < s.length) return "something follows the closing bracket";
    }
    return { node: { items }, end: i };
  }
  if (top) return { node: s.slice(at).trim(), end: s.length };
  let j = i;
  let quoted = false;
  for (; j < s.length; j++) {
    const ch = s[j];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "," || ch === ")")) break;
  }
  if (quoted) return "a quote is not closed";
  return { node: s.slice(i, j).trim(), end: j };
}

export function parseIni(text: string): IniFile {
  const entries: IniEntry[] = [];
  const faults: { line: number; why: string }[] = [];
  let section = "";
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!;
    const line = raw.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      if (!line.endsWith("]") || line.length < 3) faults.push({ line: n + 1, why: "a section name is not closed" });
      else section = line.slice(1, -1).trim();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      faults.push({ line: n + 1, why: "not a Key=Value line" });
      continue;
    }
    let key = line.slice(0, eq).trim();
    let index = -1;
    const open = key.indexOf("[");
    if (open >= 0) {
      const inner = key.endsWith("]") ? key.slice(open + 1, -1) : "";
      if (!/^\d+$/.test(inner)) {
        faults.push({ line: n + 1, why: `"${key}" is not a key with a whole number in brackets` });
        continue;
      }
      index = Number(inner);
      key = key.slice(0, open).trim();
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      faults.push({ line: n + 1, why: `"${key}" is not a key` });
      continue;
    }
    const got = readNode(line, eq + 1, true);
    if (typeof got === "string") faults.push({ line: n + 1, why: got });
    else entries.push({ section, key, index, value: got.node, line: n + 1 });
  }
  return { entries, faults };
}

/** As ARK writes it, on one line with no spaces. */
export function writeNode(n: IniNode): string {
  if (!isList(n)) return n;
  return `(${n.items.map((it) => (it.key === "" ? "" : `${it.key}=`) + writeNode(it.value)).join(",")})`;
}
