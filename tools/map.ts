// Map files (shared/world/mapfile.ts), made outside the engine: from a folder of layers, and back into one.
//
//   bun tools/map.ts build <folder> <out.snmap>     a map from a folder of layers
//   bun tools/map.ts unpack <file.snmap> <folder>   the folder a map is built from
//   bun tools/map.ts proving <out.snmap>            the proving ground, as the server runs it with no --map
//   bun tools/map.ts info <file.snmap>              what a file holds
//   bun tools/map.ts pack <file.snmap>              its head's and parts' copies for the wire beside it
//                                                   (tools/map/pack.ts), which a build writes too
//
// build, proving and pack take --release for the tightest copies, as a map that ships has.
//
// A folder of layers. A chunk is 64 m and the ground has a sample every 2 m, so a map of 8 chunks a side is 257 samples
// a side. Pictures are north up, as the map screen shows them: the first pixel is the north-west corner, which is the
// highest x and the highest z. Places in the JSON files are metres from the map's south-east corner, x growing west and
// z growing north. A yaw is degrees from north, turning toward +x.
//
//   map.json      { "id": "core:miami", "chunks": [127, 127], "frame": [2048, 2048], "origin": [2176, 2304], "minY": -32,
//                   "stepY": 0.00390625, "seaLevel": 0 }
//                 The id is the map's name to the server, and that of its definition in the content, if it has one.
//                 `frame` is the lattice column and row of the map's south-east corner, and `origin` those of its display
//                 origin (shared/coords.ts); without them the corner is in the lattice's middle and the origin the nearest
//                 sector corner at or beyond the map's north-west corner.
//                 A height is minY + value * stepY metres. Without seaLevel the map has no sea.
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
//                 { "seed": 8, "perChunk": 160, "zones": [{ "kinds": { "core:mangrove": 4, "core:palm": 3 }, "bare": 6 }],
//                   "zone": "zones.png" }
//                   scatters as above, each slot a kind drawn by weight from those of the zone its place is in, or bare
//                   ground by the zone's `bare` weight: `zone` is an 8-bit greyscale picture as `allow` is, whose value is
//                   the number of the zone counting from 1, or 0 where nothing grows. This is how a map says what grows where.
//                 { "list": [{ "kind": "core:rock", "x": 12.5, "z": 40, "yaw": 0 }] }
//                   stands each node on the ground where it says.
//                 A scattered layer may name "out": a file of a bit per slot, chunk by chunk, lowest bit first, set where
//                 that slot's node is taken out, as a city's build leaves out what would stand in its ruins' way. With
//                 "other" as well, a file of the same bits set where a node stands as its footing's other kind, the layer
//                 says where each node stands and is written as it is (an unpacked map's are); without it, build decides
//                 that from the ground (resolveNodes), and a file always says it.
//                 A node's variant and size, and a scattered node's turn, come from its place, by the rule of nodes.ts.
//   spawns.json   [{ "name": "Plaza", "x": 256, "z": 240, "yaw": 0 }]
//                 Up to 16. The first is where a new survivor arrives, and a dead one chooses among them.
//   regions.json  [{ "spawns": "core:spawns_beach", "count": 12, "x": 180, "z": 300, "radius": 40 }]
//                 Where wild creatures live: the spawns definition a region is stocked from, how many it holds at a
//                 DinoCountMultiplier of 1, and a circle, or a box given as "half": [half width, half depth]. Optional.
//   vehicles.json [{ "kind": "core:compact", "x": 240, "z": 270, "yaw": 90 }]
//                 Vehicles parked on the ground, owned by nobody: set down once, in a new world, and kept by its save. Optional.
//   water.json    { "squares": "water.png", "bodies": [{ "name": "Stow Lake", "surface": 86 }] }
//                 Water standing on its own surface apart from the sea: lakes, ponds, reservoirs, a river's reaches. The
//                 picture is 16-bit greyscale of 1, 2, 4, 8, 16, 32 or 64 m a pixel, its value the number of the body
//                 counting from 1, or 0 for the sea's water. A body's water is wherever the ground of one of its squares is
//                 under its surface, which stands on the heights' lattice. Optional.
//   streets.json  [{ "col": 134, "row": 131, "file": "streets-134-131.bin" }]
//                 The streets as lines (shared/world/streets.ts), a sector's part a file of its bytes as the build wrote
//                 them, by the sector's square on the lattice. Optional.
//   road-across.png, road-along.png, road-half.png, road-lanes.png
//                 The roads' frame (shared/world/roadframe.ts), 8-bit greyscale, a pixel every 4 m: all four or none.
//   landmarks.json { "landmarks": [{ "name": "hut", "x": 300, "y": 10, "z": 300, "yaw": 0 }], "defs": [...] }
//                 The landmarks the map places and their pieces' own definitions. Optional.
//
// A city's build (tools/mapworld/build.ts) writes its folder of layers, these too, so `build` makes the same map from it.

import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../content/core.ts";
import { provingFile } from "../server/world.ts";
import { compileContent, withContent } from "../shared/content/registry.ts";
import { CHUNK_SIZE } from "../shared/coords.ts";
import { mapHeightfield, mapTops, parseMap, resolveNodes, writeMap, type MapData } from "../shared/world/mapfile.ts";
import { groundSize } from "../client/core/render/terrain.ts";
import { readLayers, writeLayers } from "./map/layers.ts";
import { partsTable, writeMapFile } from "./map/pack.ts";

const registry = () => compileContent(CORE_CONTENT).registry!;
const WEBGL2_TEXTURE = 2048;

/** What a map holds, in lines, and the content ids it names that the core pack lacks. */
export function describe(file: Uint8Array): string[] {
  const map = parseMap(file);
  const { chunksX, chunksZ, frameX, frameZ, originX, originZ } = map.dims;
  let low = 65535;
  let high = 0;
  for (const h of map.heights) {
    if (h < low) low = h;
    if (h > high) high = h;
  }
  const at = (h: number): string => (map.minY + h * map.stepY).toFixed(1);
  const ground = groundSize(mapHeightfield(map));
  const lines = [
    `${map.id}, hash ${map.hash.toString(16).padStart(8, "0")}, ${file.length} bytes`,
    `${chunksX} by ${chunksZ} chunks, ${chunksX * CHUNK_SIZE} by ${chunksZ * CHUNK_SIZE} m, ground from ${at(low)} to ${at(high)} m, ${map.seaLevel === -Infinity ? "no sea" : `sea at ${map.seaLevel} m`}`,
    `south-east corner at lattice column ${frameX}, row ${frameZ}; display origin at column ${originX}, row ${originZ}`,
    ...(Math.max(...ground.width, ...ground.height) > WEBGL2_TEXTURE ? [`its ground is ${ground.width[0]} by ${ground.height[0]} texels: a device whose textures go to ${WEBGL2_TEXTURE}, the least WebGL2 allows, refuses it`] : []),
    `${map.statics.length} static pieces`,
    ...map.nodes.map((layer) => {
      if ("first" in layer) return `${layer.kind.length} listed nodes`;
      const ones = (bits: Uint8Array | undefined): number => {
        let n = 0;
        for (const b of bits ?? []) for (let v = b; v; v &= v - 1) n++;
        return n;
      };
      const [out, other] = [ones(layer.out), ones(layer.other)];
      const taken = `${out > 0 ? `; ${out} slots taken out` : ""}${other > 0 ? `; ${other} stand as their footing's other kind` : ""}`;
      if ("zone" in layer) return `${layer.perChunk} node slots a chunk, by zones of ${layer.zoneCell} m: ${layer.zones.map((z, i) => `${i + 1} ${[...z.kinds.map(([id, weight]) => `${id} x${weight}`), ...(z.bare > 0 ? [`bare x${z.bare}`] : [])].join(", ")}`).join("; ")}${taken}`;
      return `${layer.perChunk} node slots a chunk, scattered${layer.allow ? ` where a picture of ${layer.allowCell} m a pixel allows` : ""}: ${layer.kinds.map(([id, weight]) => `${id} x${weight}`).join(", ")}${taken}`;
    }),
    `spawn points: ${map.spawns.map((s) => `${s.name} (${s.x}, ${s.z})`).join(", ")}`,
  ];
  if (map.regions) lines.push(`spawn regions: ${map.regions.map((r) => `${r.count} of ${r.spawns} at (${r.at[0]}, ${r.at[1]})`).join(", ")}`);
  if (map.vehicles) {
    const parked = new Map<string, number>();
    for (const v of map.vehicles) parked.set(v.kind, (parked.get(v.kind) ?? 0) + 1);
    lines.push(`parked vehicles: ${[...parked].map(([id, n]) => `${n} of ${id}`).join(", ")}`);
  }
  const w = map.water;
  if (w) {
    let squares = 0;
    for (const b of w.squares) if (b !== 0) squares++;
    const names = [...new Set(w.bodies.map((b) => b.name).filter((n) => n !== ""))];
    lines.push(`${w.bodies.length} bodies of water in ${squares} squares of ${w.cell} m over ${w.chunks().length} chunks, surfaces ${Math.min(...w.surface.subarray(1)).toFixed(2)} to ${Math.max(...w.surface.subarray(1)).toFixed(2)} m${names.length > 0 ? `: ${names.join(", ")}` : ""}`);
  }
  const built = map.buildings;
  if (built) {
    const named = [...built.handles()].filter((h) => built.name(h) !== null).length;
    lines.push(`${built.count} buildings in ${built.sectors.filter((t) => t).length} sectors, ${named} of them named: ${built.names.kinds.length} kinds, ${built.names.districts.length} districts; ${built.bytes} bytes held`);
  }
  if (map.content) lines.push(`landmarks ${map.content.landmarks.map((l) => `${l.name} at ${l.x.toFixed(1)}, ${l.y.toFixed(1)}, ${l.z.toFixed(1)} turned ${l.yaw}`).join(", ")}, ${map.content.defs.length} definitions of their own`);
  const known = withContent(registry(), map.content?.defs ?? []).index;
  const named = new Set([...map.statics.kinds, ...map.nodes.flatMap((layer) => ("first" in layer ? layer.kinds : "zone" in layer ? layer.zones.flatMap((z) => z.kinds.map(([id]) => id)) : layer.kinds.map(([id]) => id))), ...(map.regions ?? []).map((r) => r.spawns!), ...(map.vehicles ?? []).map((v) => v.kind)]);
  const lacking = [...named].filter((id) => !known.has(id));
  if (lacking.length > 0) lines.push(`not in the core content: ${lacking.join(", ")}`);
  return lines;
}

/**
 * A folder's map as its maker writes it, with the core content: each node layer resolved where the folder does not say where
 * its nodes stand, and the far feed's cells of its chunks baked into its tops.
 */
export function made(map: MapData): MapData {
  // With its landmarks' own definitions, as a city's build has them (tools/mapworld/build.ts).
  const reg = withContent(registry(), map.content?.defs ?? []);
  return { ...resolveNodes(map, reg), tops: mapTops(map, reg) };
}

/** Writes the map and its parts' copies, a release build's if `release`, and says what it holds and what a client fetches of it. */
export async function save(path: string, map: MapData | Uint8Array, release = false): Promise<void> {
  const file = map instanceof Uint8Array ? map : writeMap(map);
  const packed = await writeMapFile(path, file, release);
  for (const line of [...describe(file), ...partsTable(packed)]) console.log(line);
}

/** `args` are the words after the command's name, less --release. Another tool adds its command here. */
export const COMMANDS: Record<string, { usage: string; run(args: string[], release: boolean): void | Promise<void> }> = {
  build: { usage: "<folder> <out.snmap>", run: ([folder, out], release) => save(out!, made(readLayers(folder!)), release) },
  // Read with what is drawn from it too (the roads' frame), which a server reads past.
  unpack: { usage: "<file.snmap> <folder>", run: ([file, folder]) => writeLayers(parseMap(new Uint8Array(readFileSync(file!)), true, true), folder!) },
  proving: { usage: "<out.snmap>", run: ([out], release) => save(out!, provingFile(registry()), release) },
  info: { usage: "<file.snmap>", run: ([file]) => describe(new Uint8Array(readFileSync(file!))).forEach((line) => console.log(line)) },
  pack: { usage: "<file.snmap>", run: ([file], release) => save(file!, new Uint8Array(readFileSync(file!)), release) },
};

if (import.meta.main) {
  const words = process.argv.slice(2);
  const [name, ...args] = words.filter((w) => w !== "--release");
  const command = COMMANDS[name ?? ""];
  if (!command || args.length !== command.usage.split(" ").length) {
    console.error(Object.entries(COMMANDS).map(([n, c]) => `bun tools/map.ts ${n} ${c.usage}`).join("\n"));
    process.exit(2);
  }
  try {
    await command.run(args, words.includes("--release"));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
