// A city's prepared data as one file another machine can build the city from without downloading it again (D810):
//
//   bun tools/maps/kit.ts pack <city|all>  writes var/kits/<city>-<cut>.tar.gz from var/mapdata/<city>/current
//   bun tools/maps/kit.ts unpack <file>    puts it in var/mapdata/<city>/<cut>/ and points `current` at it
//   bun tools/maps/kit.ts serve [port]     gives var/kits read-only over http (a free Cloudflare quick tunnel shows it)
//   bun tools/maps/kit.ts fetch <url>      takes every kit that serves lists, each held to its hash, and unpacks it
//
// A kit is the cut's work folder as its stages left it, less the downloads (raw/, 8 to 10 GB a city) and the build's
// reports, with raw/osm/all.json kept so the world stage can propose again, and the stages' keys. A stage's key is its
// inputs and its code, never a path, so on a machine at the same commit tools/maps/city.ts finds every stage done, and an
// edit to the build's code builds the map again from the kit alone. An edit that reaches a stage reading the downloads
// makes city.ts fetch them first (raw/KIT marks a kit's work folder) and hold them to downloads.json's digests.

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

/** One kit as the index lists it: its file, its size and its SHA-256, which a download is held to. */
interface Listed { file: string; bytes: number; sha256: string; city: string; cut: string; commit: string }

const sha256 = async (path: string): Promise<string> => {
  const h = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) h.update(chunk);
  return h.digest("hex");
};

/** var/kits/index.json: every kit there, newest of each city, with its size and hash. Written by pack. */
async function writeIndex(): Promise<Listed[]> {
  const kits: Listed[] = [];
  for (const f of readdirSync(KITS).filter((f) => f.endsWith(".tar.gz")).sort()) {
    const about = JSON.parse(readFileSync(join(KITS, `${f.slice(0, -".tar.gz".length)}.json`), "utf8")) as Kit;
    kits.push({ file: f, bytes: Bun.file(join(KITS, f)).size, sha256: await sha256(join(KITS, f)), city: about.city, cut: about.cut, commit: about.commit });
  }
  writeFileSync(join(KITS, "index.json"), `${JSON.stringify({ made: new Date().toISOString(), kits }, null, 2)}\n`);
  return kits;
}

/**
 * Gives var/kits read-only over http on 127.0.0.1:`port`: index.json and the kits it lists, nothing else. A tunnel
 * puts it where other machines reach it (tools/maps/README.md, "kits"). Kits stay out of git: on a branch they would
 * come with every clone and fetch of the repository, 1.4 GB again each time they are made.
 */
function serve(port: number): void {
  Bun.serve({
    hostname: "127.0.0.1", port,
    fetch(req) {
      const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, "")) || "index.json";
      if (!/^[a-z0-9-]+(-[0-9a-f]{10}\.tar\.gz|\.json)$/.test(name) && name !== "index.json") return new Response("not found\n", { status: 404 });
      const file = Bun.file(join(KITS, name));
      return file.size > 0 ? new Response(file) : new Response("not found\n", { status: 404 });
    },
  });
  console.log(`kits on http://127.0.0.1:${port}/ from ${KITS}`);
}

/** Takes every kit an index at `url` lists into var/kits, held to its hash, and unpacks each. */
async function fetchKits(url: string): Promise<void> {
  const base = url.endsWith("/") ? url : `${url}/`;
  const index = (await (await fetch(`${base}index.json`)).json()) as { kits: Listed[] };
  mkdirSync(KITS, { recursive: true });
  for (const k of index.kits) {
    const path = join(KITS, k.file);
    if (!(existsSync(path) && Bun.file(path).size === k.bytes && (await sha256(path)) === k.sha256)) {
      console.log(`${k.file}: ${(k.bytes / 1e6).toFixed(0)} MB`);
      const res = await fetch(`${base}${k.file}`);
      if (!res.ok || !res.body) throw new Error(`${k.file}: the server answered ${res.status}`);
      await Bun.write(`${path}.part`, res);
      if ((await sha256(`${path}.part`)) !== k.sha256) throw new Error(`${k.file}: its bytes are not those the index names; fetch again`);
      renameSync(`${path}.part`, path);
    }
    writeFileSync(join(KITS, `${k.file.slice(0, -".tar.gz".length)}.json`), await (await fetch(`${base}${k.file.slice(0, -".tar.gz".length)}.json`)).text());
    console.log(unpack(path));
  }
}

if (import.meta.main) {
  const [verb, what] = process.argv.slice(2);
  if (verb === "pack" && what) {
    for (const city of what === "all" ? CITIES : [what]) {
      if (what === "all" && !builtThrough(city)) console.log(`${city}: not built through, or a run of it is going; not packed`);
      else console.log(pack(city));
    }
    await writeIndex();
  } else if (verb === "unpack" && what) console.log(unpack(what));
  else if (verb === "serve") serve(Number(what ?? 8455));
  else if (verb === "fetch" && (what ?? process.env.KIT_URL)) await fetchKits((what ?? process.env.KIT_URL)!);
  else { console.error("bun tools/maps/kit.ts pack <city | all> | unpack <file> | serve [port] | fetch [url]"); process.exit(2); }
}
