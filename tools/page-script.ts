// The page's script as the build writes it (D1106). The first frame waits for two files: main.js, the shell's entry, and
// page.js, every other module the first frame runs, in one piece. Each file the page fetches later takes what it uses of
// the first frame's code from page.js's exports, so there is one copy of every module and its state, as there was.
//
// Bun's splitting did otherwise: it cut the code a late file shares with the first frame into a piece for each set of
// late files that share it, 13 files the first frame waited for. Each piece was compressed apart, and the names that
// cross between pieces took the short names, so the locals in every piece were a letter longer: 31 KB of the first
// frame's Brotli more than the same code in one file. page.js holds no top-level await (the shell's are in main.js), so
// a late file the shell waits for at its start can import it.
//
//   bun tools/page-script.ts --check [folder]   builds the script into the folder, a passing one if none, and checks it

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { finishScript, withoutNotes } from "./script-notes.ts";

const ROOT = resolve(import.meta.dir, "..");
/** The shell's entry, which alone may wait at its top level. */
export const ENTRY = "client/shell/main.ts";
/** The file every first-frame module but the entry is in. */
export const PAGE = "page.js";
const FROM_PAGE = `./${PAGE}`;

export { withoutNotes };

const resolveFrom = (spec: string, importer: string): string | null => {
  try {
    return Bun.resolveSync(spec, dirname(importer));
  } catch {
    return null;
  }
};

/** A late file's name in the folder: its module's. */
const lateName = (file: string): string => `${basename(file).replace(/\.ts$/, "")}.js`;

/** The names `importer`'s import or export statements take from `spec`; every export of the module where it takes it whole. */
function taken(text: string, spec: string, exports: readonly string[]): string[] {
  const quoted = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new Set<string>();
  for (const m of text.matchAll(new RegExp(`^(?:import|export)\\s+(?!type\\s)([^;]*?)\\s+from\\s+["']${quoted}["']`, "gms"))) {
    const what = m[1]!.trim();
    if (!what.startsWith("{")) return [...exports];
    for (const part of what.slice(1, what.indexOf("}")).split(",")) {
      const p = part.trim();
      if (p !== "" && !p.startsWith("type ")) names.add(p.split(/\s+as\s+/)[0]!);
    }
  }
  return exports.filter((n) => names.has(n));
}

const DIGITS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Builds the page's script into `dist`, with `define` as the page's build defines it. Returns the files written, main.js
 * and page.js first.
 */
export async function buildPageScript(dist: string, define: Record<string, string>, root = ROOT): Promise<string[]> {
  const entry = join(root, ENTRY);
  const opts = { target: "browser", minify: true, define } as const;
  // The first frame's modules, as the bundler loads them, and the files it fetches later.
  const first = new Set<string>();
  const late = new Set<string>();
  const find = await Bun.build({ ...opts, entrypoints: [entry], plugins: [{ name: "find", setup(b) {
    b.onResolve({ filter: /^\./ }, (a) => {
      const file = resolveFrom(a.path, a.importer);
      if (file === null) return undefined;
      if (a.kind === "dynamic-import") {
        late.add(file);
        return { path: `./${lateName(file)}`, external: true };
      }
      first.add(file);
      return undefined;
    });
  } }] });
  if (!find.success) throw new Error(find.logs.map(String).join("\n"));
  first.delete(entry);
  for (const f of first) late.delete(f);
  // Each export of a first-frame module has a short name of its own in page.js, in a fixed order, so a build of the
  // same code writes the same files.
  const linked = [...first].filter((f) => f.endsWith(".ts")).sort();
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const exportsOf = new Map(linked.map((f) => [f, transpiler.scan(readFileSync(f, "utf8")).exports]));
  const alias = new Map<string, string>();
  for (const f of linked) for (const name of exportsOf.get(f)!) {
    let k = alias.size, short = "";
    do {
      short = DIGITS[k % DIGITS.length] + short;
      k = Math.floor(k / DIGITS.length) - 1;
    } while (k >= 0);
    alias.set(`${f}\0${name}`, `$${short}`);
  }
  const named = (file: string, name: string): string => alias.get(`${file}\0${name}`)!;
  const dynamic: Bun.BunPlugin = { name: "late", setup(b) {
    b.onResolve({ filter: /^\./ }, (a) => {
      if (a.kind !== "dynamic-import") return undefined;
      const file = resolveFrom(a.path, a.importer);
      return file !== null && late.has(file) ? { path: `./${lateName(file)}`, external: true } : undefined;
    });
  } };
  // The entry and the late files see each first-frame module as page.js's exports of the names they take from it.
  const link: Bun.BunPlugin = { name: "link", setup(b) {
    b.onResolve({ filter: /^\./ }, (a) => {
      if (a.path === FROM_PAGE) return { path: FROM_PAGE, external: true };
      const file = resolveFrom(a.path, a.importer);
      if (file === null || !exportsOf.has(file)) return undefined;
      const all = exportsOf.get(file)!;
      const names = a.kind === "dynamic-import" ? all : taken(readFileSync(a.importer, "utf8"), a.path, all);
      return { path: `${file}?${names.join(",")}`, namespace: "page" };
    });
    b.onLoad({ filter: /.*/, namespace: "page" }, (a) => {
      const [file, list] = a.path.split("?") as [string, string];
      const names = list === "" ? [] : list.split(",");
      return { contents: names.length > 0 ? `export { ${names.map((n) => `${named(file, n)} as ${n}`).join(", ")} } from "${FROM_PAGE}";` : `import "${FROM_PAGE}";`, loader: "js" };
    });
  } };
  const later = late.size > 0 ? await Bun.build({ ...opts, entrypoints: [...late], outdir: dist, naming: { entry: "[name].[ext]", chunk: "chunk-[hash].[ext]" }, splitting: true, sourcemap: "linked", plugins: [dynamic, link] }) : null;
  if (later && !later.success) throw new Error(later.logs.map(String).join("\n"));
  const main = await Bun.build({ ...opts, entrypoints: [entry], outdir: dist, naming: "[name].[ext]", sourcemap: "linked", plugins: [dynamic, link] });
  if (!main.success) throw new Error(main.logs.map(String).join("\n"));
  // What they take, which page.js exports.
  const takenBy = (outputs: Bun.BuildArtifact[]): Set<string> => {
    const out = new Set<string>();
    for (const o of outputs) if (o.path.endsWith(".js")) for (const m of readFileSync(o.path, "utf8").matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*"\.\/page\.js"/g)) for (const part of m[1]!.split(",")) out.add(part.trim().split(/\s+as\s+/)[0]!);
    return out;
  };
  const byEntry = takenBy(main.outputs), wanted = new Set([...byEntry, ...takenBy(later?.outputs ?? [])]);
  // page.js runs the modules in the order the entry imports those it uses or runs for what they do, so they run in the
  // order they did; the rest it names after, when they have run.
  const own = [...readFileSync(entry, "utf8").matchAll(/^import\s+(?!type\s)([^;"']*?\sfrom\s+)?["']([^"']+)["']/gms)].map((m) => ({ file: resolveFrom(m[2]!, entry), bare: m[1] === undefined }));
  const ran = own.filter((o) => o.file !== null && exportsOf.has(o.file) && (o.bare || exportsOf.get(o.file)!.some((n) => byEntry.has(named(o.file!, n))))).map((o) => o.file!);
  const lines: string[] = [];
  for (const file of new Set([...ran, ...linked])) {
    const names = exportsOf.get(file)!.filter((n) => wanted.has(named(file, n)));
    if (names.length > 0) lines.push(`export { ${names.map((n) => `${n} as ${named(file, n)}`).join(", ")} } from ${JSON.stringify(file)};`);
    else if (ran.includes(file)) lines.push(`import ${JSON.stringify(file)};`);
  }
  const page = await Bun.build({ ...opts, entrypoints: [PAGE.replace(/\.js$/, ".ts")], root, outdir: dist, naming: "[name].[ext]", sourcemap: "linked", plugins: [dynamic, { name: "page", setup(b) {
    b.onResolve({ filter: /^page\.ts$/ }, (a) => (String(a.kind).startsWith("entry-point") ? { path: "page.ts", namespace: "entry" } : undefined));
    b.onLoad({ filter: /.*/, namespace: "entry" }, () => ({ contents: lines.join("\n"), loader: "js" }));
  } }] });
  if (!page.success) throw new Error(page.logs.map(String).join("\n"));
  const files = [...main.outputs, ...page.outputs, ...(later?.outputs ?? [])].filter((o) => o.path.endsWith(".js")).map((o) => o.path);
  // Sent without the notes written for readers (tools/script-notes.ts).
  for (const f of files) finishScript(f);
  return files.map((f) => relative(dist, f)).sort((a, b) => (a === "main.js" ? -1 : b === "main.js" ? 1 : a === PAGE ? -1 : b === PAGE ? 1 : a.localeCompare(b)));
}

/** The files main.js imports before it runs, which the page asks for beside it. */
export function preloaded(dist: string): string[] {
  return [...new Set([...readFileSync(join(dist, "main.js"), "utf8").matchAll(/\bimport\s*(?:\{[^}]*\}\s*from\s*)?"\.\/([^"]+\.js)"/g)].map((m) => m[1]!))];
}

/**
 * What is wrong with the page's script in `dist`, if anything: the first frame waits for main.js and page.js alone,
 * page.js imports nothing and holds none of the entry's code, and every name a file takes from page.js is one it exports.
 */
export function pageScriptProblems(dist: string): string[] {
  const out: string[] = [];
  const read = (f: string): string => readFileSync(join(dist, f), "utf8");
  const first = preloaded(dist);
  if (first.join() !== PAGE) out.push(`the first frame waits for main.js and ${first.join(", ")}, not main.js and ${PAGE} alone`);
  const page = read(PAGE);
  if (/\bimport\s*(?:\{[^}]*\}\s*from\s*|\*\s*as\s*[\w$]+\s*from\s*)?"\.\//.test(page.replace(/`(?:[^`\\]|\\.)*`/g, "``"))) out.push(`${PAGE} imports another file before it runs`);
  const sources = (JSON.parse(read(`${PAGE}.map`)) as { sources: string[] }).sources;
  if (sources.some((s) => resolve(dist, s).endsWith(join(sep, ENTRY)))) out.push(`${PAGE} holds the shell's entry, which may wait at its top level`);
  const exported = new Set<string>();
  for (const m of page.matchAll(/\bexport\s*\{([^}]*)\}/g)) for (const part of m[1]!.split(",")) exported.add(part.trim().split(/\s+as\s+/).pop()!);
  for (const f of readdirSync(dist).filter((n) => n.endsWith(".js") && n !== PAGE)) {
    const text = read(f);
    if (/\bimport\s*\*\s*as\s*[\w$]+\s*from\s*"\.\/page\.js"/.test(text)) out.push(`${f} takes ${PAGE} whole`);
    for (const m of text.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*"\.\/page\.js"/g)) for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0]!;
      if (!exported.has(name)) out.push(`${f} takes ${name} from ${PAGE}, which does not export it`);
    }
  }
  return out;
}

if (import.meta.main && process.argv.includes("--check")) {
  const named = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const dist = named ? resolve(named) : mkdtempSync(join(tmpdir(), "snark-script-"));
  try {
    const define = { __HUD_ATLAS_URL__: '"assets/hud.webp"', __TOUCH_ATLAS_URL__: '"assets/touch.webp"', __SKY_FILE__: '"assets/sky.bin"', __CONTENT_FILE__: '"assets/content.json"' };
    const files = await buildPageScript(dist, define);
    const problems = pageScriptProblems(dist);
    for (const p of problems) console.error(`the page's script: ${p}`);
    console.log(`the page's script: ${files.length} files, the first frame waiting for main.js and ${preloaded(dist).join(", ")}`);
    if (problems.length > 0) process.exitCode = 1;
  } finally {
    if (!named && existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  }
}
