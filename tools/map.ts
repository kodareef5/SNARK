// Map files (shared/world/mapfile.ts), made outside the engine: from a folder of layers, and back into one.
//
//   bun tools/map.ts build <folder> <out.snmap>     a map from a folder of layers
//   bun tools/map.ts unpack <file.snmap> <folder>   the folder a map is built from
//   bun tools/map.ts proving <out.snmap>            the proving ground, as the server runs it with no --map
//   bun tools/map.ts info <file.snmap>              what a file holds
//
// A folder of layers. A chunk is 64 m and the ground has a sample every 2 m, so a map of 8 chunks a side is 257 samples
// a side. Pictures are north up, as the map screen shows them: the first pixel is the north-west corner, which is the
// highest x and the highest z. Places in the JSON files are metres from the map's south-east corner, x growing west and
// z growing north. A yaw is degrees from north, turning toward +x.
//
//   map.json      { "id": "miami:city", "chunks": [125, 125], "minY": -32, "stepY": 0.00390625, "seaLevel": 0 }
//                 The id is the map's name to the server, and that of its definition in the content, if it has one.
//                 A height is minY + value * stepY metres. Without seaLevel the map has no water.
//   heights.png   16-bit greyscale, a pixel a sample. Or heights.u16: the same values, little-endian, with no header.
//   tint.png      8-bit greyscale or indexed, a pixel a sample: its palette index (shared/pack/palette.ts).
//                 Or tint.u8. Without either, index 0 everywhere.
//   statics.json  [{ "kind": "core:wall", "x": 240.5, "y": 1.8, "z": 270, "yaw": 90 }]
//                 Pieces set down with the world, by content id and centre. Optional.
//   nodes.json    Layers of resource nodes, which share a chunk's 256 slots. Optional. A layer is one of:
//                 { "seed": 7, "perChunk": 96, "kinds": { "core:tree": 5, "core:rock": 3 }, "allow": "woods.png" }
//                   scatters `perChunk` slots over every chunk, each a kind drawn by weight. A slot stays empty under
//                   water, on a steep slope, and where `allow` is darker than half: an 8-bit greyscale picture of
//                   1, 2, 4, 8, 16, 32 or 64 m a pixel. Without `allow`, anywhere.
//                 { "list": [{ "kind": "core:rock", "x": 12.5, "z": 40, "yaw": 0 }] }
//                   stands each node on the ground where it says.
//   spawns.json   [{ "name": "Plaza", "x": 256, "z": 240, "yaw": 0 }]
//                 Up to 16. The first is where a new survivor arrives, and a dead one chooses among them.

import { readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../content/core.ts";
import { provingFile } from "../server/world.ts";
import { compileContent } from "../shared/content/registry.ts";
import { CHUNK_SIZE } from "../shared/coords.ts";
import { parseMap, writeMap, type MapData } from "../shared/world/mapfile.ts";
import { readLayers, writeLayers } from "./map/layers.ts";

const registry = () => compileContent(CORE_CONTENT).registry!;

/** What a map holds, in lines, and the content ids it names that the core pack lacks. */
export function describe(file: Uint8Array): string[] {
  const map = parseMap(file);
  const { chunksX, chunksZ } = map.dims;
  let low = 65535;
  let high = 0;
  for (const h of map.heights) {
    if (h < low) low = h;
    if (h > high) high = h;
  }
  const at = (h: number): string => (map.minY + h * map.stepY).toFixed(1);
  const lines = [
    `${map.id}, hash ${map.hash.toString(16).padStart(8, "0")}, ${file.length} bytes (${Bun.gzipSync(file as Uint8Array<ArrayBuffer>).length} compressed)`,
    `${chunksX} by ${chunksZ} chunks, ${chunksX * CHUNK_SIZE} by ${chunksZ * CHUNK_SIZE} m, ground from ${at(low)} to ${at(high)} m, ${map.seaLevel === -Infinity ? "no water" : `sea at ${map.seaLevel} m`}`,
    `${map.statics.length} static pieces`,
    ...map.nodes.map((layer) => ("first" in layer ? `${layer.kind.length} listed nodes` : `${layer.perChunk} node slots a chunk, scattered${layer.allow ? ` where a picture of ${layer.allowCell} m a pixel allows` : ""}: ${layer.kinds.map(([id, weight]) => `${id} x${weight}`).join(", ")}`)),
    `spawn points: ${map.spawns.map((s) => `${s.name} (${s.x}, ${s.z})`).join(", ")}`,
  ];
  const known = registry().index;
  const named = new Set([...map.statics.map((s) => s.kind), ...map.nodes.flatMap((layer) => ("first" in layer ? layer.kinds : layer.kinds.map(([id]) => id)))]);
  const lacking = [...named].filter((id) => !known.has(id));
  if (lacking.length > 0) lines.push(`not in the core content: ${lacking.join(", ")}`);
  return lines;
}

function save(path: string, map: MapData | Uint8Array): void {
  const file = map instanceof Uint8Array ? map : writeMap(map);
  writeFileSync(path, file);
  for (const line of describe(file)) console.log(line);
}

/** `args` are the words after the command's name. Another tool adds its command here. */
export const COMMANDS: Record<string, { usage: string; run(args: string[]): void }> = {
  build: { usage: "<folder> <out.snmap>", run: ([folder, out]) => save(out!, readLayers(folder!)) },
  unpack: { usage: "<file.snmap> <folder>", run: ([file, folder]) => writeLayers(parseMap(new Uint8Array(readFileSync(file!))), folder!) },
  proving: { usage: "<out.snmap>", run: ([out]) => save(out!, provingFile(registry())) },
  info: { usage: "<file.snmap>", run: ([file]) => describe(new Uint8Array(readFileSync(file!))).forEach((line) => console.log(line)) },
};

if (import.meta.main) {
  const [name, ...args] = process.argv.slice(2);
  const command = COMMANDS[name ?? ""];
  if (!command || args.length !== command.usage.split(" ").length) {
    console.error(Object.entries(COMMANDS).map(([n, c]) => `bun tools/map.ts ${n} ${c.usage}`).join("\n"));
    process.exit(2);
  }
  try {
    command.run(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
