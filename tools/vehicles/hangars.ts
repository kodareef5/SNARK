// `bun tools/vehicles/hangars.ts [--maps <folder>] [--only <city>] [--write]`: finds each city's hidden hangar on its
// built map (planning/workstreams/jet.md): open, level ground with room for a jet, as far from where survivors rise as
// the map has, leaning each city's own way, and where the jet itself stands clear on its wheels. Prints what it found
// and, with --write, writes content/vehicles/hangars.ts. A city is its own process: a built map is millions of statics.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { HangarSite } from "../../content/vehicles/hangars.ts";
import { siteFault } from "../../server/supply/ground.ts";
import { createMapWorld } from "../../server/world.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { isJetVehicle } from "../../shared/sim/vehicle.ts";
import { jetPlacement, jetRestY } from "../../shared/world/jet.ts";
import { parseMap } from "../../shared/world/mapfile.ts";

const ROOT = join(import.meta.dir, "../..");
const CITIES = ["miami", "tampa", "san-francisco", "los-angeles", "las-vegas"] as const;
const FILE = join(ROOT, "content/vehicles/hangars.ts");
/** Metres between the places tried, and from the map's edge none is nearer than. */
const STEP = 64;
const EDGE = 500;
/** Metres round a site that must be open and level: room for a jet's span and its taxi out. */
const PAD = 28;
/** Metres the ground may rise or fall across the pad. */
const LEVEL = 2.5;
/** What each city's hangar is called, and the way its site leans, as a direction on the map. */
const NAMES: Record<string, { name: string; lean: [number, number] }> = {
  "core:las-vegas": { name: "Groom Annex", lean: [0.7, 0.7] },
  "core:miami": { name: "Homestead Annex", lean: [0, -1] },
  "core:tampa": { name: "MacDill Annex", lean: [0, -1] },
  "core:san-francisco": { name: "Moffett Annex", lean: [-0.7, -0.7] },
  "core:los-angeles": { name: "Edwards Annex", lean: [-0.7, 0.7] },
};

export function cityHangar(path: string): { id: string; site: HangarSite | null; tried: number; seconds: number } {
  const started = performance.now();
  const map = parseMap(new Uint8Array(readFileSync(path)) as Uint8Array<ArrayBuffer>);
  const reg = withContent(compileContent(CORE_CONTENT).registry!, map.content?.defs ?? []);
  const def = reg.vehicle[reg.index.get("core:jet")!];
  if (!def || !isJetVehicle(def)) throw new Error("the content has no jet");
  const world = createMapWorld(reg, map);
  const { sizeX, sizeZ } = world.hf;
  const meta = NAMES[map.id] ?? { name: "Annex", lean: [0, 0] as [number, number] };
  const cands: { x: number; z: number; score: number }[] = [];
  const reach = Math.hypot(sizeX, sizeZ);
  for (let z = EDGE; z <= sizeZ - EDGE; z += STEP) {
    for (let x = EDGE; x <= sizeX - EDGE; x += STEP) {
      let near = Infinity;
      for (const s of map.spawns) near = Math.min(near, Math.hypot(s.x - x, s.z - z));
      // As far from where survivors rise as may be, leaning the city's own way.
      const lean = ((x - sizeX / 2) * meta.lean[0] + (z - sizeZ / 2) * meta.lean[1]) / reach;
      cands.push({ x, z, score: near / reach + 0.35 * lean });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const fit = { onBuilt: false, baseExclusion: 0 };
  let tried = 0;
  for (const c of cands) {
    if (++tried > 4000) break;
    if (siteFault(world, c.x, c.z, fit) !== "") continue;
    const h0 = world.hf.heightAt(c.x, c.z);
    let ok = true;
    for (let k = 0; k < 12 && ok; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (const r of [PAD * 0.5, PAD]) {
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        if (siteFault(world, x, z, fit) !== "" || Math.abs(world.hf.heightAt(x, z) - h0) > LEVEL) { ok = false; break; }
      }
    }
    if (!ok) continue;
    // It faces the map's middle, the way out of its hiding, and stands there clear on its wheels.
    const yaw = Math.round(Math.atan2(sizeX / 2 - c.x, sizeZ / 2 - c.z) * 1000) / 1000;
    const y = jetRestY(world, c.x, c.z, yaw, h0 + 2, 8, def);
    if (!Number.isFinite(y) || !jetPlacement(world, c.x, y, c.z, yaw, def)) continue;
    return { id: map.id, site: { name: meta.name, x: c.x, z: c.z, yaw }, tried, seconds: (performance.now() - started) / 1000 };
  }
  return { id: map.id, site: null, tried, seconds: (performance.now() - started) / 1000 };
}

function fileOf(found: readonly { id: string; site: HangarSite | null }[]): string {
  const text = readFileSync(FILE, "utf8"), head = text.slice(0, text.indexOf("export const HANGARS"));
  const lines = [head + "export const HANGARS: Readonly<Record<string, HangarSite>> = {"];
  for (const f of found) if (f.site) lines.push(`  "${f.id}": { name: "${f.site.name}", x: ${f.site.x}, z: ${f.site.z}, yaw: ${f.site.yaw} },`);
  lines.push("};", "");
  return lines.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const one = flag("one");
  if (one !== undefined) console.log(JSON.stringify(cityHangar(one)));
  else {
    const folders = (flag("maps") ?? join(ROOT, "var/maps")).split(",");
    const only = flag("only");
    const found: { id: string; site: HangarSite | null }[] = [];
    for (const city of CITIES) {
      if (only && only !== city) continue;
      const path = folders.map((f) => join(f, `${city}.snmap`)).find(existsSync);
      if (!path) { console.log(`${city}: no built map in ${folders.join(" or ")}`); continue; }
      const child = Bun.spawnSync(["bun", import.meta.path, "--one", path], { stdout: "pipe", stderr: "inherit" });
      const line = child.stdout.toString().trim().split("\n").pop() ?? "";
      const got = JSON.parse(line) as { id: string; site: HangarSite | null; tried: number; seconds: number };
      found.push(got);
      console.log(`${city} (${path}): ${got.site ? `${got.site.name} at ${got.site.x} ${got.site.z}, facing ${got.site.yaw}` : "no site"} (${got.tried} tried, ${got.seconds.toFixed(1)} s)`);
    }
    if (args.includes("--write")) {
      writeFileSync(FILE, fileOf(found));
      console.log(`wrote ${FILE}`);
    }
  }
}
