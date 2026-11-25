// A city's map, v2: bun tools/maps/city.ts <city> [--from <stage>] [--to <stage>] [--only <stage>]
//
// assets/source/maps/<city>/ holds what people wrote and nothing made (README.md): city.json (the city, its cut and
// its settings), rules.json (its rules over tools/maps/rules), places.json and compositions.json (its named places),
// and whatever look/ holds. This lays them over tools/maps/defaults.json and sources.json into a work folder,
// var/mapdata/<city>/<cut>/<city>/, one for each centre and bounds so a new cut never reads another's downloads, and runs
// the stages there. Each stage is run again only when what it reads, its own code or a stage before it changed
// (stages.json beside them). The map is var/maps/<city>.snmap, shared by every cut: var/maps/<city>/stamp.json names the
// cut and build key that made it, and the build runs again unless they are this run's. Nothing it makes goes into git:
// the downloads are a build's, kept on a machine that does map work and fetched again where they are gone.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const HERE = import.meta.dir;
const LEGACY = join(ROOT, "tools/mapdata");
const python = join(LEGACY, ".venv/bin/python");

/**
 * Every file of the repository's own TypeScript `entry` imports, itself and onward, by relative import, sorted, and the
 * JSON beside them it imports. The build's key is its code: with no code in it a fix to ground.ts or pack.ts never
 * built a city again, and each needed a forced --only build.
 */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  // A file of the client or the server the build imports is part of the key (the packer takes the page's first-frame
  // rule from client/core/mapload.ts), but not what that file imports in turn: followed, those were 378 files, the
  // client's renderer among them, and nearly any merge of main built all five cities again.
  const leaf = (file: string): boolean => [join(ROOT, "client"), join(ROOT, "server")].some((d) => file.startsWith(`${d}/`));
  const visit = (file: string): void => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    if (!file.endsWith(".ts") || leaf(file)) return;
    for (const m of readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) visit(resolve(file, "..", m[1]!));
  };
  visit(entry);
  return [...seen].sort();
}

type Json = Record<string, unknown>;

/** The stages in order: a name, what it runs, and the files of code it is (its key changes when they do). */
function pythonArgs(...args: string[]): string[] {
  if (!existsSync(python)) throw new Error("This stage needs tools/mapdata/.venv: see tools/maps/README.md");
  return [python, "-I", ...args];
}

const py = (script: string, ...args: string[]) => (work: string): string[] => pythonArgs(join(LEGACY, script), work, ...args);
/** What every Python stage imports, so part of each one's code. */
const COMMON = join(LEGACY, "common.py");
// A stage's key is the stage before it's, its code, and what it reads beyond the city's settings (`own`: authored files
// in the city's folder and settings sections no stage before it reads). Too eager is safe; a key that misses an input
// keeps a stale layer, so a section goes in `own` only where one stage alone reads it.
export interface Stage {
  name: string;
  run: (work: string, city: string) => string[];
  code: string[];
  own?: { files: string[]; sections: string[]; folders?: string[] };
  /** It writes `<maps>/<city>.snmap`, which every cut shares, and stands done only while the stamp beside it is its own. */
  stamped?: boolean;
}

export const STAGES: Stage[] = [
  { name: "frame", run: py("frame.py", "--force"), code: [join(LEGACY, "frame.py")] },
  { name: "fetch", run: py("fetch.py", "tiger", "dem", "nlcd", "fema", "bathymetry", "osm"), code: [join(LEGACY, "fetch.py"), join(LEGACY, "osm_local.py"), ...["buildings", "features", "osm", "streets", "ways"].map((q) => join(LEGACY, `${q}.overpassql`))] },
  { name: "prepare", run: py("prepare.py"), code: [join(LEGACY, "prepare.py"), join(LEGACY, "streets.py")] },
  { name: "attributes", run: (work) => ["bun", join(ROOT, "tools/mapworld/fetch-attributes.ts"), work], code: [join(ROOT, "tools/mapworld/fetch-attributes.ts")] },
  { name: "split", run: py("split.py"), code: [join(LEGACY, "split.py")] },
  { name: "future", run: py("future.py"), code: [join(LEGACY, "future.py"), join(LEGACY, "tunnels.py")] },
  { name: "fine", run: py("fine.py"), code: [join(LEGACY, "fine.py"), join(LEGACY, "tunnels.py")] },
  { name: "bathymetry", run: py("bathy.py"), code: [join(LEGACY, "bathy.py")] },
  { name: "labels", run: py("labels.py"), code: [join(LEGACY, "labels.py")], own: { files: ["heights.json"], sections: [] } },
  { name: "ways", run: py("ways.py"), code: [join(LEGACY, "ways.py")] },
  { name: "world", run: py("world.py", "--accept"), code: [join(LEGACY, "world.py")], own: { files: ["world.json"], sections: ["world"] } },
  { name: "vocabulary", run: py("vocabulary.py"), code: [join(LEGACY, "vocabulary.py"), join(HERE, "rules/tables.json"), join(ROOT, "tools/mapworld/rules/default.json")],
    own: { files: ["rules.json", "places.json", "compositions.json", "districts.json"], sections: ["ruins"] } },
  // The build reads the city's street overlay (streets/*.jsonl) alone, so an entry there builds the map again and no stage before it.
  { name: "build", run: (work) => ["bun", join(ROOT, "tools/mapworld/build.ts"), work], code: importGraph(join(ROOT, "tools/mapworld/build.ts")), own: { files: [], sections: [], folders: ["streets"] }, stamped: true },
];

const readJson = (path: string): Json => JSON.parse(readFileSync(path, "utf8")) as Json;
const sha = (...parts: (string | Uint8Array)[]): string => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
};

/** `over` laid on `base`: objects key by key, anything else replaced; keys starting "_" are notes and dropped. */
function lay(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (base && over && typeof base === "object" && typeof over === "object" && !Array.isArray(base) && !Array.isArray(over)) {
    const out: Json = { ...(base as Json) };
    for (const [k, v] of Object.entries(over as Json)) if (!k.startsWith("_")) out[k] = lay(out[k], v);
    return out;
  }
  return over;
}
const notes = (v: Json): Json => Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith("_")));

/**
 * The settings the stages read, as one file: the defaults, then the shared sources (footprints with the city's own
 * split settings), then the city's own keys. The stages are the old tools/mapdata ones and read the old file's shape.
 */
export function compose(city: Json): Json {
  const defaults = notes(readJson(join(HERE, "defaults.json")));
  const sources = notes(readJson(join(HERE, "sources.json")));
  const own = notes(city);
  const merged = lay(lay(defaults, sources), own) as Json;
  if (own.v !== 2) throw new Error(`${own.name}: city.json is not v2 (no "v": 2); see tools/maps/README.md`);
  delete merged.v;
  const bounds = own.bounds as number[] | undefined;
  if (!bounds || bounds.length !== 4) throw new Error(`${own.name}: city.json needs bounds [west, south, east, north]`);
  // The south-east corner on the lattice: today's squares put theirs, at east 4,064 and south -4,064, on its middle.
  merged.frame = [2048 - (bounds[2] - 4064) / 64, 2048 + (bounds[1] + 4064) / 64];
  return merged;
}

/**
 * What can be known wrong from a city's own files, thrown before the first stage rather than an hour on: each was a
 * build that died at its vocabulary or its last step on 2026-11-18.
 */
function preflight(name: string, settings: Json, source: string): void {
  const fail = (why: string): never => { throw new Error(`${name}: ${why}`); };
  if ((settings.ruins as Json | undefined)?.rules_from) fail(`city.json's ruins.rules_from names another map's vocabulary, which v2 has no folder for: its tables are tools/maps/rules/tables.json and the city's own rules.json`);
  const world = (settings.world ?? {}) as Json;
  const authored = existsSync(join(source, "world.json")) ? ((readJson(join(source, "world.json")).spawns ?? []) as { name: string }[]) : [];
  const wanted = (world.spawn_places ?? []) as (string | { name: string })[];
  const names = [...new Set([...authored.map((s) => s.name), ...wanted.map((w) => (typeof w === "string" ? w : w.name))])];
  if (names.length > 16) fail(`${names.length} spawn points named (world.json's and spawn_places), and a map file holds 16`);
  const long = names.filter((n) => new TextEncoder().encode(n).length > 48);
  if (long.length > 0) fail(`spawn point names over 48 bytes: ${long.join(", ")}`);
}

/** Where a run reads and writes, and which stages it runs; a test gives its own table and folders. */
export interface CityRun {
  stages?: Stage[];
  /** The city's authored folder; assets/source/maps/<city>. */
  source?: string;
  /** Where the cuts' work folders go; var/mapdata. */
  mapdata?: string;
  /** Where the map and its stamp go; var/maps. */
  maps?: string;
  /** The stages' working directory; the repository. */
  cwd?: string;
  from?: string;
  to?: string;
  only?: string;
}

/** `from` copied to `to` with nothing more: a file gone from `from` goes from `to`, and so does `to` when `from` is gone. */
function mirror(from: string, to: string): void {
  if (!existsSync(from)) {
    rmSync(to, { recursive: true, force: true });
    return;
  }
  cpSync(from, to, { recursive: true });
  const prune = (dir: string): void => {
    for (const e of readdirSync(join(to, dir), { withFileTypes: true })) {
      const rel = join(dir, e.name);
      if (!existsSync(join(from, rel))) rmSync(join(to, rel), { recursive: true, force: true });
      else if (e.isDirectory()) prune(rel);
    }
  };
  prune("");
}

/** Whether `<maps>/<city>/stamp.json` names this cut and key, and the map beside it is the file it describes. */
function stampHolds(maps: string, city: string, cut: string, key: string): boolean {
  const path = join(maps, city, "stamp.json");
  const file = join(maps, `${city}.snmap`);
  if (!existsSync(path) || !existsSync(file)) return false;
  try {
    const stamp = readJson(path) as { cut?: string; key?: string; bytes?: number; mtimeMs?: number };
    const made = statSync(file);
    return stamp.cut === cut && stamp.key === key && stamp.bytes === made.size && stamp.mtimeMs === made.mtimeMs;
  } catch {
    return false;
  }
}

/** One run of a city's stages: the CLI's whole work, its folders and stage table open to a test. */
export function runCity(name: string, o: CityRun = {}): { cut: string; work: string; ran: string[]; current: boolean } {
  const stages = o.stages ?? STAGES;
  const cwd = o.cwd ?? ROOT;
  const maps = o.maps ?? join(ROOT, "var/maps");
  const names = stages.map((s) => s.name);
  const only = o.only;
  const from = names.indexOf(only ?? o.from ?? names[0]!);
  const to = names.indexOf(only ?? o.to ?? names[names.length - 1]!);
  if (from < 0 || to < 0) throw new Error(`the stages are ${names.join(", ")}`);

  const source = o.source ?? join(ROOT, "assets/source/maps", name);
  const city = readJson(join(source, "city.json"));
  const settings = compose(city);
  preflight(name, settings, source);
  const cut = sha(JSON.stringify([settings.centre, settings.bounds])).slice(0, 10);
  const top = join(o.mapdata ?? join(ROOT, "var/mapdata"), name);
  const work = join(top, cut, name);
  mkdirSync(join(work, "ruins"), { recursive: true });
  // One run of a city at a time, taken before the run writes anything: two wrote one stages.json and one set of layers,
  // and stopping one took pkill. Made only where none is (wx), so two runs starting together cannot both take it; it
  // holds the run's process id and is let go when the run ends, and one a process no longer running left is taken over.
  const lock = join(top, "run.lock");
  const take = (): boolean => { try { writeFileSync(lock, String(process.pid), { flag: "wx" }); return true; } catch { return false; } };
  if (!take()) {
    const held = Number(readFileSync(lock, "utf8"));
    let alive = false;
    try { alive = held > 0 && process.kill(held, 0); } catch { alive = false; }
    if (alive) throw new Error(`${name}: another run of this city is going, process ${held} (${lock})`);
    unlinkSync(lock);
    if (!take()) throw new Error(`${name}: another run took ${lock} as this one found it left behind`);
  }
  const release = (): void => { try { if (readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock); } catch { /* gone already */ } };
  process.on("exit", release);
  try {
    return stagesOf(name, { stages, names, cwd, maps, source, settings, cut, top, work, from, to, only });
  } finally {
    release();
    process.off("exit", release);
  }
}

interface Prepared {
  stages: Stage[]; names: string[]; cwd: string; maps: string; source: string; settings: Json;
  cut: string; top: string; work: string; from: number; to: number; only: string | undefined;
}

function stagesOf(name: string, p: Prepared): { cut: string; work: string; ran: string[]; current: boolean } {
  const { stages, names, cwd, maps, source, settings, cut, top, work, from, to, only } = p;
  const ran: string[] = [];
  // TIGER's roads and water come a county a file: the counties the cut touches, unless city.json names them.
  const tiger = settings.tiger as Json;
  if (!tiger.counties) {
    const kept = join(top, cut, "counties.json");
    if (!existsSync(kept)) {
      const [lon, lat] = settings.centre as number[];
      const run = Bun.spawnSync(pythonArgs(join(HERE, "counties.py"), String(lon), String(lat), ...(settings.bounds as number[]).map(String)), { cwd: ROOT, stderr: "inherit" });
      if (run.exitCode !== 0) throw new Error("counties.py failed");
      writeFileSync(kept, run.stdout);
    }
    const counties = JSON.parse(readFileSync(kept, "utf8")) as { geoid: string; name: string }[];
    tiger.counties = counties.map((c) => c.geoid);
    tiger.source = `Census TIGER/Line ${tiger.year}, ${counties.map((c) => c.name).join(", ")}`;
  }

  // The work folder's inputs, written only where they changed, so the stages' keys follow what they hold.
  const write = (rel: string, text: string): void => {
    const path = join(work, rel);
    mkdirSync(resolve(path, ".."), { recursive: true });
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
  };
  write("city.json", `${JSON.stringify(settings, null, 2)}\n`);
  // The vocabulary's seed: the shared tables with the city's rules over them, less what vocabulary.py makes (its MADE:
  // the budgets it scales by the city's footprints, its districts and compositions). A file of its own, which the stage
  // reads and never writes: merged into ruins/vocabulary.json, the stage's own output, it was written back over the
  // stage's budgets, and a build that ran without that stage took 1.5 M pieces where Tampa's were 13.4 M.
  const tables = notes(readJson(join(HERE, "rules/tables.json")));
  const rules = existsSync(join(source, "rules.json")) ? notes(readJson(join(source, "rules.json"))) : {};
  const MADE = new Set(["districts", "budgets", "compositions", "composed"]);
  const seeded = Object.fromEntries(Object.entries({ ...tables, ...rules }).filter(([k]) => !MADE.has(k)));
  write("ruins/vocabulary.seed.json", `${JSON.stringify(seeded, null, 2)}\n`);
  // Never a file a stage writes: vocabulary.py reads the authored places and writes ruins/places.json resolved.
  for (const [from, to] of [["places.json", "ruins/places.authored.json"], ["heights.json", "blocks/heights.authored.json"], ["compositions.json", "ruins/compositions.json"], ["districts.json", "ruins/districts.json"],
    ["world.json", "world/authored.json"]] as const) {
    if (existsSync(join(source, from))) write(to, readFileSync(join(source, from), "utf8"));
    else rmSync(join(work, to), { force: true });
  }
  mirror(join(source, "look"), join(work, "look"));
  // The street overlay as written, its files alone: one taken out of the city's folder is taken out here too.
  const overlay = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort() : []);
  for (const f of overlay(join(work, "streets"))) if (!existsSync(join(source, "streets", f))) unlinkSync(join(work, "streets", f));
  for (const f of overlay(join(source, "streets"))) write(join("streets", f), readFileSync(join(source, "streets", f), "utf8"));

  const keysPath = join(work, "stages.json");
  const keys = (existsSync(keysPath) ? readJson(keysPath) : {}) as Record<string, string>;
  const ownSections = new Set(stages.flatMap((s) => s.own?.sections ?? []));
  // A section a later stage owns keys from that stage on; of `world`, prepare reads the sea's height alone, which stays
  // in the chain, so moving a spawn point costs the world stage onward and not prepare's half hour.
  const sea = ((settings.world ?? {}) as Json).seaNavd88 ?? null;
  let chain = sha(JSON.stringify({ ...Object.fromEntries(Object.entries(settings).filter(([k]) => !ownSections.has(k))), sea }));
  console.log(`${name}: cut ${cut}, ${(settings.bounds as number[]).join(", ")}; work ${work}`);
  // Each stage's key as the inputs and code stand now, run or not, for `current` below.
  const now: Record<string, string> = {};
  // A stage stands done when its key is today's; the map's stage also needs the stamp beside the map to be its own.
  const done = (s: Stage): boolean => keys[s.name] === now[s.name] && (!s.stamped || stampHolds(maps, name, cut, now[s.name]!));
  for (const [i, stage] of stages.entries()) {
    const own = stage.own ? [JSON.stringify(stage.own.sections.map((s) => settings[s] ?? null)),
      ...stage.own.files.map((f) => (existsSync(join(source, f)) ? readFileSync(join(source, f)) : `no ${f}`)),
      ...(stage.own.folders ?? []).flatMap((d) => overlay(join(source, d)).flatMap((f) => [`${d}/${f}`, readFileSync(join(source, d, f))]))] : [];
    const code = stage.code.some((f) => f.endsWith(".py")) ? [...stage.code, COMMON] : stage.code;
    const key = sha(chain, stage.name, ...code.map((f) => readFileSync(f)), ...own);
    chain = key;
    now[stage.name] = key;
    if (i < from || i > to) continue;
    if (done(stage) && !only) {
      console.log(`== ${stage.name}: unchanged`);
      continue;
    }
    if (keys[stage.name] === key && stage.stamped) console.log(`== ${stage.name}: ${name}.snmap is another cut's or build's`);
    // A kit's work folder (tools/maps/kit.ts) has no downloads: a stage that reads them runs after fetch makes them.
    const kitted = join(work, "raw/KIT");
    if (existsSync(kitted) && names.includes("prepare") && i >= names.indexOf("prepare") && i <= names.indexOf("ways")) {
      console.log(`== ${stage.name} reads the downloads a kit leaves out: fetching them first`);
      const fetched = Bun.spawnSync(stages[names.indexOf("fetch")]!.run(work, name), { cwd, stdout: "inherit", stderr: "inherit" });
      if (fetched.exitCode !== 0) throw new Error(`${name}: fetch failed with ${fetched.exitCode}`);
      unlinkSync(kitted);
    }
    const t0 = performance.now();
    console.log(`== ${stage.name}`);
    // This stage and every one after it are out of date from now until each runs again: a run that dies half way must
    // not leave a key standing over half-written layers.
    for (const later of stages.slice(i)) delete keys[later.name];
    writeFileSync(keysPath, `${JSON.stringify(keys, null, 2)}\n`);
    const env = stage.stamped ? { ...process.env, SNARK_MAP_STAMP: JSON.stringify({ cut, key }) } : process.env;
    const run = Bun.spawnSync(stage.run(work, name), { cwd, env, stdout: "inherit", stderr: "inherit" });
    ran.push(stage.name);
    if (run.exitCode !== 0) throw new Error(`${name}: ${stage.name} failed with ${run.exitCode}`);
    if (stage.stamped && !stampHolds(maps, name, cut, key)) throw new Error(`${name}: ${stage.name} left no stamp for cut ${cut} beside ${join(maps, `${name}.snmap`)}`);
    keys[stage.name] = key;
    writeFileSync(keysPath, `${JSON.stringify(keys, null, 2)}\n`);
    console.log(`== ${stage.name} done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  // current: the cut built last, once every stage of it stands done with today's inputs and code (a run --to fetch, or
  // a stage whose key no longer matches, leaves it where it was), so a tool
  // reading it never meets a cut half built. A new link under another name, renamed over the old: no moment without one.
  if (!stages.every(done)) return { cut, work, ran, current: false };
  const current = join(top, "current");
  const next = `${current}.${process.pid}`;
  symlinkSync(join(cut, name), next);
  renameSync(next, current);
  return { cut, work, ran, current: true };
}

function main(): void {
  const args = process.argv.slice(2);
  const name = args[0];
  if (!name || name.startsWith("-")) {
    console.error("bun tools/maps/city.ts <city> [--from <stage>] [--to <stage>] [--only <stage>]");
    process.exit(2);
  }
  const opt = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  runCity(name, { from: opt("--from"), to: opt("--to"), only: opt("--only") });
}

if (import.meta.main) main();
