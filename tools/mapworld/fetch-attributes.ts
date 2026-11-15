// Fetches what FEMA/ORNL USA Structures says of each building of a map's footprints, by the object id the footprints
// keep: its height, its occupancy and the source of its outline. No address, place or population field is asked for.
// bun tools/mapworld/fetch-attributes.ts [name]   writes assets/source/maps/<name>/base/buildings_attributes.json

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SERVICE = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query";
const FIELDS = ["OBJECTID", "HEIGHT", "OCC_CLS", "PRIM_OCC", "SEC_OCC", "OUTBLDG", "SQMETERS", "SOURCE", "VAL_METHOD", "IMAGE_DATE"];

const name = process.argv[2] ?? (() => { throw new Error("Map name required"); })();
const base = resolve(import.meta.dir, "../../assets/source/maps", name, "base");
const geo = JSON.parse(readFileSync(join(base, "buildings.geojson"), "utf8")) as { features: { properties: { id: number } }[] };
const ids = [...new Set(geo.features.map((f) => f.properties.id))].sort((a, b) => a - b);
const rows: Record<string, unknown>[] = [];
for (let at = 0; at < ids.length; at += 500) {
  const body = new URLSearchParams({ where: `OBJECTID IN (${ids.slice(at, at + 500).join(",")})`, outFields: FIELDS.join(","), returnGeometry: "false", f: "json" });
  const res = await fetch(SERVICE, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  const page = (await res.json()) as { features?: { attributes: Record<string, unknown> }[]; error?: unknown };
  if (!page.features) throw new Error(`the service answered ${JSON.stringify(page.error ?? page).slice(0, 300)}`);
  rows.push(...page.features.map((f) => f.attributes));
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
