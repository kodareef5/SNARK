// A city's prepared data as one file another machine can build the city from without downloading it again (D810):
//
//   bun tools/maps/kit.ts pack <city|all>  writes var/kits/<city>-<cut>.tar.gz from var/mapdata/<city>/current
//   bun tools/maps/kit.ts unpack <file>    puts it in var/mapdata/<city>/<cut>/ and points `current` at it
//   bun tools/maps/kit.ts fetch <host>     takes the kits from a machine that keeps them, over ssh, and unpacks each
//
// A kit is the cut's work folder as its stages left it, less the downloads (raw/, 8 to 10 GB a city) and the build's
// reports, with raw/osm/all.json kept so the world stage can propose again, and the stages' keys. A stage's key is its
// inputs and its code, never a path, so on a machine at the same commit tools/maps/city.ts finds every stage done, and an
// edit to the build's code builds the map again from the kit alone. An edit that reaches a stage reading the downloads
// (prepare to ways) makes city.ts fetch them first: raw/KIT marks a kit's work folder.

import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const MAPDATA = join(ROOT, "var/mapdata");
const KITS = join(ROOT, "var/kits");

/** What a kit says of itself, beside it and inside it. */
interface Kit { city: string; cut: string; commit: string; made: string; stages: Record<string, string> }

const run = (cmd: string[], cwd = ROOT): string => {
  const r = Bun.spawnSync(cmd, { cwd, stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
};

function pack(city: string): string {
  const current = join(MAPDATA, city, "current");
  if (!existsSync(current)) throw new Error(`${city} has no built cut (var/mapdata/${city}/current): build it with tools/maps/city.ts`);
  const [cut] = readlinkSync(current).split("/") as [string];
  const work = join(MAPDATA, city, cut, city);
  const stages = JSON.parse(readFileSync(join(work, "stages.json"), "utf8")) as Record<string, string>;
  if (!stages.build) throw new Error(`${city}'s cut ${cut} is not built through (stages.json has no build): finish it first`);
  const kit: Kit = { city, cut, commit: run(["git", "rev-parse", "HEAD"]), made: new Date().toISOString(), stages };
  writeFileSync(join(work, "kit.json"), `${JSON.stringify(kit, null, 2)}\n`);
  mkdirSync(KITS, { recursive: true });
  const file = join(KITS, `${city}-${cut}.tar.gz`);
  const part = `${file}.part`;
  // The cut's counties and every entry of the work folder but its downloads and reports, named one by one (an
  // exclusion would take all.json out with raw/), and all.json.
  const entries = readdirSync(work).filter((e) => e !== "raw" && e !== "reports").sort().map((e) => `${cut}/${city}/${e}`);
  const inside = [`${cut}/counties.json`, ...entries, `${cut}/${city}/raw/osm/all.json`].filter((p) => existsSync(join(MAPDATA, city, p)));
  const gzip = Bun.which("pigz") ? "pigz" : "gzip";
  run(["tar", "--use-compress-program", gzip, "-cf", part, ...inside], join(MAPDATA, city));
  renameSync(part, file);
  writeFileSync(`${file.slice(0, -".tar.gz".length)}.json`, `${JSON.stringify(kit, null, 2)}\n`);
  return file;
}

function unpack(file: string): string {
  const name = basename(file);
  const m = /^(.+)-([0-9a-f]{10})\.tar\.gz$/.exec(name);
  if (!m) throw new Error(`${name} is not a kit's name (<city>-<cut>.tar.gz)`);
  const [, city, cut] = m as unknown as [string, string, string];
  const top = join(MAPDATA, city);
  if (existsSync(join(top, "run.lock"))) throw new Error(`${city} has a run going or left (var/mapdata/${city}/run.lock): let it end first`);
  mkdirSync(top, { recursive: true });
  run(["tar", "-xzf", resolve(file)], top);
  const work = join(top, cut, city);
  const kit = JSON.parse(readFileSync(join(work, "kit.json"), "utf8")) as Kit;
  // Its stages' keys as the kit's machine left them, the same code here finding them done; all but the build's, whose
  // map (var/maps/<city>.snmap) a kit does not carry, so the first run here makes it from the kit.
  const { build: _built, ...made } = kit.stages;
  writeFileSync(join(work, "stages.json"), `${JSON.stringify(made, null, 2)}\n`);
  mkdirSync(join(work, "raw"), { recursive: true });
  writeFileSync(join(work, "raw/KIT"), `${kit.commit}\n`);
  const current = join(top, "current");
  const next = `${current}.${process.pid}`;
  symlinkSync(join(cut, city), next);
  renameSync(next, current);
  const here = run(["git", "rev-parse", "HEAD"]);
  return `${city}'s cut ${cut}, made at ${kit.commit.slice(0, 9)}${here === kit.commit ? " (this commit)" : `; this tree is at ${here.slice(0, 9)}, so the stages whose code differs run again`}: bun tools/maps/city.ts ${city}`;
}

const CITIES = ["tampa", "miami", "los-angeles", "san-francisco", "las-vegas"];

/** Whether a city's current cut is built through and no run of it is going: a kit of one mid-run would be half old. */
function builtThrough(city: string): boolean {
  const keys = join(MAPDATA, city, "current", "stages.json");
  return existsSync(keys) && !existsSync(join(MAPDATA, city, "run.lock")) && Boolean((JSON.parse(readFileSync(keys, "utf8")) as Record<string, string>).build);
}

/**
 * Takes the kits from a machine that keeps them, over ssh (`host` as ssh names it, its kits at var/kits of its tree, or
 * the folder a read-only rrsync key gives), into var/kits, and unpacks each. Kits stay out of git: a branch of them
 * would come with every clone and fetch of the repository, 1.4 GB again each time they are made.
 */
function fetchKits(host: string, folder: string): void {
  mkdirSync(KITS, { recursive: true });
  const r = Bun.spawnSync(["rsync", "-a", "--partial", "--info=progress2", "--include=*.tar.gz", "--include=*.json", "--exclude=*", `${host}:${folder}`, `${KITS}/`], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`rsync from ${host}:${folder} failed with ${r.exitCode}`);
  for (const f of readdirSync(KITS).filter((f) => f.endsWith(".tar.gz")).sort()) console.log(unpack(join(KITS, f)));
}

if (import.meta.main) {
  const [verb, what] = process.argv.slice(2);
  if (verb === "pack" && what) {
    for (const city of what === "all" ? CITIES : [what]) {
      if (what === "all" && !builtThrough(city)) console.log(`${city}: not built through, or a run of it is going; not packed`);
      else console.log(pack(city));
    }
  } else if (verb === "unpack" && what) console.log(unpack(what));
  else if (verb === "fetch" && what) fetchKits(what, process.env.KIT_FOLDER ?? "./");
  else { console.error("bun tools/maps/kit.ts pack <city | all> | unpack <file> | fetch <ssh host>   (KIT_FOLDER: the folder there, ./ under an rrsync key)"); process.exit(2); }
}
