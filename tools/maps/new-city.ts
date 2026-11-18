// A new city's folder: bun tools/maps/new-city.ts <name> "<Label>" <lon>,<lat>
//
// Writes assets/source/maps/<name>/city.json with its centre, which fixes the city's projection for good, and a cut of
// 127 chunks a side round it to start from. Then survey.py proposes a better cut, and city.ts builds it (README.md).
// The elevation project and coastal model are the city's to name in city.json (README.md says where they are found).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [name, label, at] = process.argv.slice(2);
if (!name || !label || !at || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('bun tools/maps/new-city.ts <name, lower case with dashes> "<Label>" <lon>,<lat>');
  process.exit(2);
}
const [lon, lat] = at.split(",").map(Number);
if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon!) > 180 || Math.abs(lat!) > 90) throw new Error(`not a longitude and latitude: ${at}`);
const folder = resolve(import.meta.dir, "../../assets/source/maps", name);
if (existsSync(join(folder, "city.json"))) throw new Error(`${folder} already has a city.json`);
mkdirSync(folder, { recursive: true });
// A 127-chunk square puts the centre mid-chunk, so its edges, and every cut's after it, fall 32 m off a multiple of 64.
const city = { v: 2, name, label, centre: [lon, lat], bounds: [-4064, -4064, 4064, 4064] };
writeFileSync(join(folder, "city.json"), `${JSON.stringify(city, null, 2)}\n`);
console.log(`wrote ${join(folder, "city.json")}; next: tools/mapdata/.venv/bin/python -I tools/maps/survey.py ${folder}`);
