// A city's prepared data as one file another machine can build the city from without downloading it again (D810):
//
//   bun tools/maps/kit.ts pack <city|all>  writes var/kits/<city>-<cut>.tar.gz from var/mapdata/<city>/current
//   bun tools/maps/kit.ts unpack <file>    puts it in var/mapdata/<city>/<cut>/ and points `current` at it
//   bun tools/maps/kit.ts publish          packs every city onto the remote's `mapdata` branch, replacing it
//   bun tools/maps/kit.ts fetch            takes that branch's kits into var/kits and unpacks each
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

/** The branch on the repository's own remote that holds the latest kits, and only them: made again whole each time. */
const BRANCH = "mapdata";
const CITIES = ["tampa", "miami", "los-angeles", "san-francisco", "las-vegas"];

/**
 * Packs every city and puts its kits on the remote's `mapdata` branch as one commit with no parent, replacing what was
 * there, so the repository holds the latest kits and never their history (the committed layers maps v2 took out had
 * grown to 1.45 GB). Made with a scratch index, so no checkout is touched.
 */
function publish(remote: string): void {
  // Every city built through; one mid-run (its stages.json without a build) waits for the next publish.
  const done = (c: string): boolean => {
    const keys = join(MAPDATA, c, "current", "stages.json");
    return existsSync(keys) && !existsSync(join(MAPDATA, c, "run.lock")) && Boolean((JSON.parse(readFileSync(keys, "utf8")) as Record<string, string>).build);
  };
  const files = CITIES.filter(done).map((c) => pack(c));
  for (const c of CITIES.filter((c) => !done(c))) console.log(`${c}: not built through, left for the next publish`);
  const index = join(KITS, ".index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const git = (args: string[]): string => {
    const r = Bun.spawnSync(["git", ...args], { cwd: ROOT, env, stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
    return r.stdout.toString().trim();
  };
  git(["read-tree", "--empty"]);
  const readme = join(KITS, "README.md");
  writeFileSync(readme, `# City kits\n\nEach city's prepared map data, made at ${run(["git", "rev-parse", "--short", "HEAD"])} on ${new Date().toISOString().slice(0, 10)}. Take them with\n\`bun tools/maps/kit.ts fetch\` and build a city with \`bun tools/maps/city.ts <city>\` (tools/maps/README.md, \"kits\").\nThis branch is made again whole each time; it has no history.\n`);
  for (const f of [readme, ...files.flatMap((f) => [f, `${f.slice(0, -".tar.gz".length)}.json`])]) {
    git(["update-index", "--add", "--cacheinfo", `100644,${git(["hash-object", "-w", f])},${basename(f)}`]);
  }
  const commit = git(["commit-tree", git(["write-tree"]), "-m", `City kits made at ${run(["git", "rev-parse", "--short", "HEAD"])}`]);
  run(["git", "push", "--force", remote, `${commit}:refs/heads/${BRANCH}`]);
  console.log(`${files.length} kits on ${remote}'s ${BRANCH} as ${commit.slice(0, 9)}`);
}

/** Takes the kits from the remote's `mapdata` branch into var/kits and unpacks each. */
function fetchKits(remote: string): void {
  run(["git", "fetch", "--no-tags", remote, `+refs/heads/${BRANCH}:refs/remotes/${remote}/${BRANCH}`]);
  mkdirSync(KITS, { recursive: true });
  run(["sh", "-c", `git archive ${remote}/${BRANCH} | tar -x -C "${KITS}"`]);
  for (const f of readdirSync(KITS).filter((f) => f.endsWith(".tar.gz")).sort()) console.log(unpack(join(KITS, f)));
}

if (import.meta.main) {
  const [verb, what] = process.argv.slice(2);
  // The remote main follows (origin here, forgejo on the Mac), unless named.
  const upstream = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "main@{upstream}"], { cwd: ROOT }).stdout.toString().trim();
  const remote = process.env.KIT_REMOTE ?? (upstream.includes("/") ? upstream.slice(0, upstream.indexOf("/")) : "origin");
  if (verb === "pack" && what) for (const city of what === "all" ? CITIES : [what]) console.log(pack(city));
  else if (verb === "unpack" && what) console.log(unpack(what));
  else if (verb === "publish") publish(what ?? remote);
  else if (verb === "fetch") fetchKits(what ?? remote);
  else { console.error("bun tools/maps/kit.ts pack <city | all> | unpack <file> | publish [remote] | fetch [remote]"); process.exit(2); }
}
