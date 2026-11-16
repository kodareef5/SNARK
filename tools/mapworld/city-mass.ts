import { readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkCount } from "../../shared/coords.ts";
import { CityStatics, cellPart } from "../../shared/world/city.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";

const map = parseMap(new Uint8Array(readFileSync(process.argv[2]!)));
const reg = compileContent(CORE_CONTENT).registry!;
const city = new CityStatics(map.dims, map.statics, reg); const hf = mapHeightfield(map);
const start = performance.now(); let faces = 0;
for (let c = 0; c < chunkCount(map.dims); c++) faces += cellPart(city, c, hf, null, 4, 4).faces;
const result = { mapHash: map.hash, cellMetres: 4, faces, seconds: (performance.now() - start) / 1000 };
console.log(JSON.stringify(result));
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + "\n");
