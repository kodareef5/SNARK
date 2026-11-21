// `bun run supply sites [--maps <folder>] [--only <city>] [--write]`: finds each city's starter sites on its built map
// by the site rule (shared/supply/sites.ts) and the server's own test of a place (server/supply/ground.ts), splits them
// into the starter bands by how far each is from where survivors rise (content/supply/sites.ts), prints what it found
// and, with --write, writes content/supply/city-sites.ts. A city is its own process: a built map is eight million
// statics, and five of them in one process is more than it need hold.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { BANDS } from "../../content/supply/sites.ts";
import { createMapWorld } from "../../server/world.ts";
import { siteFault } from "../../server/supply/ground.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { hashString } from "../../shared/hash.ts";
import { bandsOf, findSites } from "../../shared/supply/sites.ts";
import { parseMap } from "../../shared/world/mapfile.ts";

const ROOT = join(import.meta.dir, "../..");
export const CITIES = ["miami", "tampa", "san-francisco", "los-angeles", "las-vegas"] as const;
export const CITY_FILE = join(ROOT, "content/supply/city-sites.ts");

export interface CityFound {
  id: string;
  bands: Record<string, number[]>;
  faults: Record<string, number>;
  /** Metres from the nearest spawn of each band's nearest and farthest site. */
  far: Record<string, [number, number]>;
  seconds: number;
}

/** A built map's starter sites, in the starter bands. */
export function citySites(path: string): CityFound {
  const started = performance.now();
  const map = parseMap(new Uint8Array(readFileSync(path)) as Uint8Array<ArrayBuffer>);
  const reg = withContent(compileContent(CORE_CONTENT).registry!, map.content?.defs ?? []);
  const world = createMapWorld(reg, map);
  const fit = { onBuilt: false, baseExclusion: 0 };
  const { sites, faults } = findSites({ sizeX: world.hf.sizeX, sizeZ: world.hf.sizeZ, spawns: map.spawns, fault: (x, z) => siteFault(world, x, z, fit) }, hashString(map.id));
  const bands: Record<string, number[]> = {};
  const far: Record<string, [number, number]> = {};
  bandsOf(sites, BANDS.map((b) => b.share)).forEach((list, k) => {
    // Written west to east in rows from the south, so that a list made again reads as the same list where it is the same.
    const ordered = [...list].sort((a, b) => a.z - b.z || a.x - b.x);
    bands[BANDS[k]!.key] = ordered.flatMap((s) => [s.x, s.z]);
    far[BANDS[k]!.key] = list.length === 0 ? [0, 0] : [Math.round(list[0]!.far), Math.round(list[list.length - 1]!.far)];
  });
  return { id: map.id, bands, faults, far, seconds: (performance.now() - started) / 1000 };
}

/** The file content/supply/city-sites.ts for what was found, a line a band. */
export function cityFile(found: readonly CityFound[]): string {
  const lines = [
    "// Written by `bun run supply sites --write` from each city's built map: do not edit by hand, move a site on the",
    "// admin page's map instead. Each city's starter sites by band (content/supply/sites.ts), as x and z in turn, in metres.",
    "",
    "export const CITY_SITES: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>> = {",
  ];
  for (const c of found) {
    lines.push(`  "${c.id}": {`);
    for (const band of BANDS) lines.push(`    ${band.key}: [${(c.bands[band.key] ?? []).join(",")}],`);
    lines.push("  },");
  }
  lines.push("};", "");
  return lines.join("\n");
}

export async function sitesCommand(args: readonly string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const one = flag("one");
  if (one !== undefined) {
    // The child: one city, its findings as a line of JSON.
    console.log(JSON.stringify(citySites(one)));
    return;
  }
  const folder = flag("maps") ?? join(ROOT, "var/maps");
  const only = flag("only");
  const found: CityFound[] = [];
  for (const city of CITIES) {
    if (only !== undefined && only !== city) continue;
    const path = join(folder, `${city}.snmap`);
    if (!existsSync(path)) {
      console.log(`${city}: no built map at ${path} (deploy/linux/test.sh builds one; --maps names another folder)`);
      continue;
    }
    const child = Bun.spawnSync(["bun", "--smol", join(ROOT, "tools/supply.ts"), "sites", "--one", path], { stdout: "pipe", stderr: "inherit" });
    const text = child.stdout.toString().trim().split("\n").pop() ?? "";
    if (child.exitCode !== 0 || !text.startsWith("{")) {
      console.log(`${city}: failed (exit ${child.exitCode})`);
      continue;
    }
    const c = JSON.parse(text) as CityFound;
    found.push(c);
    const total = BANDS.reduce((n, b) => n + (c.bands[b.key]?.length ?? 0) / 2, 0);
    console.log(`${c.id}: ${total} sites in ${c.seconds.toFixed(0)} s; ${BANDS.map((b) => `${b.key} ${(c.bands[b.key]?.length ?? 0) / 2} (${c.far[b.key]![0]} to ${c.far[b.key]![1]} m from a spawn)`).join(", ")}`);
    console.log(`  places turned down: ${Object.entries(c.faults).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${why} ${n}`).join(", ")}`);
  }
  if (args.includes("--write") && found.length > 0) {
    // Cities not found this time keep the list they had.
    const had = (await import("../../content/supply/city-sites.ts")).CITY_SITES;
    const all: CityFound[] = [];
    for (const city of CITIES) {
      const id = `core:${city}`;
      const now = found.find((c) => c.id === id);
      if (now) all.push(now);
      else if (had[id]) all.push({ id, bands: Object.fromEntries(Object.entries(had[id]!).map(([k, v]) => [k, [...v]])), faults: {}, far: {}, seconds: 0 });
    }
    writeFileSync(CITY_FILE, cityFile(all));
    console.log(`content/supply/city-sites.ts: ${all.length} cities`);
  }
}
