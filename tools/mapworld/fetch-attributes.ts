// What FEMA/ORNL USA Structures says of each building of a map's footprints, by the object id the footprints keep: its
// height, its occupancy and the source of its outline. No address, place or population field is kept. The fetch stage
// asked for these fields with each footprint's outline (tools/mapdata/fetch.py fema), so they are read from those pages
// and belong to the same publication as the outlines.
// bun tools/mapworld/fetch-attributes.ts <work folder>   writes <folder>/base/buildings_attributes.json

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The fields kept, as fetch.py FEMA_FIELDS asks for them. */
export const FIELDS = ["OBJECTID", "HEIGHT", "OCC_CLS", "PRIM_OCC", "SEC_OCC", "OUTBLDG", "SQMETERS", "SOURCE", "VAL_METHOD", "IMAGE_DATE"];
/** Where split.py numbers the pieces it cuts (tools/mapdata/split.py SPLIT_BASE): ids the service has not. */
const SPLIT_BASE = 500_000_000;

/** The attributes of each of `ids` from the fetched pages in `fema`, in the order of `FIELDS`; throws naming ids no page holds. */
export function attributesOf(fema: string, ids: readonly number[]): { rows: unknown[][]; fetched: string } {
  const pages = readdirSync(fema).filter((f) => /^page_\d+\.json$/.test(f)).sort();
  if (pages.length === 0) throw new Error(`attributes: no footprint pages in ${fema}: run the fetch stage`);
  const byId = new Map<number, Record<string, unknown>>();
  for (const f of pages) {
    const page = JSON.parse(readFileSync(join(fema, f), "utf8")) as { features?: { attributes: Record<string, unknown> }[] };
    for (const { attributes } of page.features ?? []) byId.set(attributes.OBJECTID as number, attributes);
  }
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`attributes: ${missing.length} of ${ids.length} footprints are in no fetched page (the first ${missing.slice(0, 5).join(", ")}): fetch again`);
  const lacking = FIELDS.filter((k) => !(k in byId.get(ids[0]!)!));
  if (ids.length > 0 && lacking.length > 0) throw new Error(`attributes: the fetched pages lack ${lacking.join(", ")}: they were fetched before the fields were asked for; fetch again`);
  const manifest = join(fema, "..", "..", "downloads.json");
  const times = existsSync(manifest) ? Object.entries(JSON.parse(readFileSync(manifest, "utf8")) as Record<string, { retrieved_utc?: string }>).filter(([k]) => k.startsWith("fema/page_")).map(([, r]) => r.retrieved_utc ?? "") : [];
  return { rows: ids.map((id) => FIELDS.map((k) => byId.get(id)![k] ?? null)), fetched: times.sort().at(-1)?.slice(0, 10) ?? "" };
}

if (import.meta.main) {
  const work = resolve(process.argv[2] ?? (() => { throw new Error("Work folder required"); })());
  const base = join(work, "base");
  const city = JSON.parse(readFileSync(join(work, "city.json"), "utf8")) as { footprints: { service: string; licence: string } };
  const geo = JSON.parse(readFileSync(join(base, "buildings.geojson"), "utf8")) as { features: { properties: { id: number; parent?: number | null } }[] };
  // Each footprint's own id, and where split.py has already cut them (this stage run again alone) each piece's parent's.
  const ids = [...new Set(geo.features.flatMap((f) => [f.properties.id, f.properties.parent ?? -1]))].filter((id) => id >= 0 && id < SPLIT_BASE).sort((a, b) => a - b);
  const { rows, fetched } = attributesOf(join(work, "raw", "fema"), ids);
  const out = { source: city.footprints.service, fetched, licence: city.footprints.licence, fields: FIELDS, rows };
  writeFileSync(join(base, "buildings_attributes.json"), `${JSON.stringify(out)}\n`);
  console.log(`${rows.length} rows of ${ids.length} ids in ${join(base, "buildings_attributes.json")}`);
}
