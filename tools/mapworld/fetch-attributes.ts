// Fetches what FEMA/ORNL USA Structures says of each building of a map's footprints, by the object id the footprints
// keep: its height, its occupancy and the source of its outline. No address, place or population field is asked for.
// bun tools/mapworld/fetch-attributes.ts <name or folder>   writes <folder>/base/buildings_attributes.json, the folder
// assets/source/maps/<name> or one named by a path (tools/maps/city.ts's work folder), as build.ts takes them

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SERVICE = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query";
const FIELDS = ["OBJECTID", "HEIGHT", "OCC_CLS", "PRIM_OCC", "SEC_OCC", "OUTBLDG", "SQMETERS", "SOURCE", "VAL_METHOD", "IMAGE_DATE"];

const name = process.argv[2] ?? (() => { throw new Error("Map name required"); })();
const base = join(name.includes("/") ? resolve(name) : resolve(import.meta.dir, "../../assets/source/maps", name), "base");
const geo = JSON.parse(readFileSync(join(base, "buildings.geojson"), "utf8")) as { features: { properties: { id: number; parent?: number | null } }[] };
// USA Structures' own ids: each footprint's, and where split.py has already cut the footprints (this stage run again
// alone) each piece's parent's, its own id being split's (from SPLIT_BASE, tools/mapdata/split.py), which the service
// has not. Asked for the pieces' ids alone it lost the parents, and split gave their pieces nothing.
const SPLIT_BASE = 500_000_000;
const ids = [...new Set(geo.features.flatMap((f) => [f.properties.id, f.properties.parent ?? -1]))].filter((id) => id >= 0 && id < SPLIT_BASE).sort((a, b) => a - b);
const rows: Record<string, unknown>[] = [];

/**
 * One page of the service's answer, asked again up to six times a few seconds apart: a busy service answers a bare
 * null, an error object or a dropped connection now and then, and one such page cost Los Angeles its 25-minute prepare.
 */
async function page(body: URLSearchParams): Promise<{ attributes: Record<string, unknown> }[]> {
  let why = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(SERVICE, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
      const got = (await res.json()) as { features?: { attributes: Record<string, unknown> }[]; error?: unknown } | null;
      if (got?.features) return got.features;
      why = `the service answered ${JSON.stringify(got?.error ?? got).slice(0, 300)}`;
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    console.log(`attributes: ${why}; asking again (${attempt} of 6)`);
    await Bun.sleep(4000 * attempt);
  }
  throw new Error(why);
}
for (let at = 0; at < ids.length; at += 500) {
  const body = new URLSearchParams({ where: `OBJECTID IN (${ids.slice(at, at + 500).join(",")})`, outFields: FIELDS.join(","), returnGeometry: "false", f: "json" });
  rows.push(...(await page(body)).map((f) => f.attributes));
  console.log(`${Math.min(at + 500, ids.length)} of ${ids.length}`);
}
rows.sort((a, b) => (a.OBJECTID as number) - (b.OBJECTID as number));
const out = {
  source: SERVICE.replace("/query", ""),
  fetched: new Date().toISOString().slice(0, 10),
  licence: "CC BY 4.0, as SOURCES.md says of USA Structures",
  fields: FIELDS,
  rows: rows.map((r) => FIELDS.map((f) => r[f] ?? null)),
};
writeFileSync(join(base, "buildings_attributes.json"), `${JSON.stringify(out)}\n`);
console.log(`${rows.length} rows of ${ids.length} ids in ${join(base, "buildings_attributes.json")}`);
