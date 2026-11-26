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

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readyKit, withCityLock } from "./city-lock.ts";

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

/** Switch current only after the entire cut is available. */
function select(top: string, city: string, cut: string): void {
  const current = join(top, "current");
  if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink() && readlinkSync(current) === join(cut, city)) return;
  const dir = mkdtempSync(join(top, ".select-"));
  try {
    const next = join(dir, "next");
    symlinkSync(join(cut, city), next);
    renameSync(next, current);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Install a prepared cut, retaining the previous edition and any local changes to it. */
export async function unpack(file: string, mapdata = MAPDATA): Promise<string> {
  const name = basename(file);
  const match = /^([a-z0-9][a-z0-9-]*)-([0-9a-f]{10})(?:\.([0-9a-f]{12}))?\.tar\.gz$/.exec(name);
  if (!match) throw new Error(`${name} is not a city kit's name`);
  const city = match[1]!, cut = match[2]!;
  const digest = await sha256(file);
  if (match[3] && !digest.startsWith(match[3])) throw new Error(`${name} has a different checksum`);
  const top = join(mapdata, city);
  return withCityLock(top, cut, () => {
    const target = join(top, cut);
    const existing = lstatSync(target, { throwIfNoEntry: false });
    if (existing) {
      if (!existing.isDirectory()) throw new Error(`Move the existing cut aside first: ${target}`);
      const receipt = join(target, ".installed-sha256");
      const previous = existsSync(receipt) && readFileSync(receipt, "utf8").trim();
      if (previous === digest) {
        select(top, city, cut);
        return `${city} kit already installed.`;
      }
      const work = join(target, city);
      const info = join(work, "kit.json");
      const from = existsSync(info) ? JSON.parse(readFileSync(info, "utf8")) as Kit : null;
      const managed = (previous && /^[0-9a-f]{64}$/.test(previous)) || existsSync(join(work, "raw/KIT"));
      if (!managed || !from || from.city !== city || from.cut !== cut) {
        throw new Error(`Move the existing unmanaged cut aside first: ${target}`);
      }
    }
    const staging = mkdtempSync(join(top, ".unpack-"));
    try {
      run(["tar", "-xzf", resolve(file)], staging);
      const entries = readdirSync(staging, { recursive: true, withFileTypes: true });
      if (entries.some(entry => !entry.isDirectory() && !entry.isFile())) throw new Error(`${name} contains a link or special file`);
      const edition = join(staging, cut), work = join(edition, city);
      const kit = JSON.parse(readFileSync(join(work, "kit.json"), "utf8")) as Kit;
      if (kit.city !== city || kit.cut !== cut || !kit.stages.build) throw new Error(`${name} contains a different or unfinished cut`);
      const { build: _built, ...made } = kit.stages;
      writeFileSync(join(work, "stages.json"), `${JSON.stringify(made, null, 2)}\n`);
      mkdirSync(join(work, "raw"), { recursive: true });
      rmSync(join(work, "raw/downloads.kit.json"), { force: true });
      writeFileSync(join(work, "raw/KIT"), `${kit.commit}\n`);
      writeFileSync(join(edition, ".installed-sha256"), `${digest}\n`);
      let saved = "";
      if (existing) {
        const ready = readyKit(top, cut);
        mkdirSync(join(top, ".kit-install"), { recursive: true });
        // A ready cut beside the active one is from an install interrupted before it moved anything.
        rmSync(ready, { recursive: true, force: true });
        renameSync(edition, ready);
        mkdirSync(join(top, "previous-kits"), { recursive: true });
        saved = mkdtempSync(join(top, "previous-kits", `${cut}-`));
        renameSync(target, join(saved, cut));
        renameSync(ready, target);
      } else renameSync(edition, target);
      select(top, city, cut);
      return `${city}'s cut ${cut}, made at ${kit.commit.slice(0, 9)}.${saved ? ` Previous cut kept in ${saved}.` : ""} Build it with bun tools/maps/city.ts ${city}`;
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
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
    console.log(await unpack(path));
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
  } else if (verb === "unpack" && what) console.log(await unpack(what));
  else if (verb === "serve") serve(Number(what ?? 8455));
  else if (verb === "fetch" && (what ?? process.env.KIT_URL)) await fetchKits((what ?? process.env.KIT_URL)!);
  else { console.error("bun tools/maps/kit.ts pack <city | all> | unpack <file> | serve [port] | fetch [url]"); process.exit(2); }
}
