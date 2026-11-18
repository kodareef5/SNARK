// Build a new, explicit map release beside existing worlds; never replace a running world's files or save.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { partsFolder, partsOf, readHead } from "../../shared/world/mapfile.ts";
import { buildMap } from "./build.ts";
import type { EntranceReport } from "./bridge-entrances.ts";

export const MAP_PRODUCER_REVISION = "road-deck-4";

/** Verify the exact raw and compressed bytes that normal /map routes serve beside the map. */
export function verifyMapPackage(file: string) {
  const bytes = readFileSync(file), head = readHead(bytes);
  const folder = partsFolder(file), parts = partsOf(bytes);
  for (const part of parts) {
    const raw = readFileSync(join(folder, part.name));
    if (!raw.equals(part.bytes)) throw new Error(`Map part mismatch: ${part.name}`);
    for (const encoding of ["br", "gz"] as const) {
      const packed = readFileSync(join(folder, `${part.name}.${encoding}`));
      const decoded = encoding === "br" ? brotliDecompressSync(packed) : gunzipSync(packed);
      if (!decoded.equals(raw)) throw new Error(`Map ${encoding} mismatch: ${part.name}`);
    }
  }
  const entranceFile = file.replace(/\.snmap$/, ".entrances.json");
  let entrances: { file: string; count: number; sha256: string } | undefined;
  if (existsSync(entranceFile)) {
    const data = readFileSync(entranceFile), report = JSON.parse(data.toString()) as EntranceReport;
    if (report.mapHash !== head.hash) throw new Error(`Entrance metadata belongs to another map: ${entranceFile}`);
    entrances = { file: basename(entranceFile), count: report.entrances.length, sha256: new Bun.CryptoHasher("sha256").update(data).digest("hex") };
  }
  return { file: basename(file), id: head.id, hash: head.hash, bytes: bytes.length,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), parts: parts.length, ...(entrances ? { entrances } : {}) };
}

export function mapReleaseManifest(maps: readonly ReturnType<typeof verifyMapPackage>[], release: boolean) {
  return { producer: MAP_PRODUCER_REVISION, release, maps };
}

export async function buildMapSet(directory: string, names: readonly string[], release = false): Promise<void> {
  if (!names.length || new Set(names).size !== names.length || names.some(name => !/^[a-z0-9][a-z0-9-]*$/.test(name))) {
    throw new Error("Supply distinct map source names (letters, digits and hyphens)");
  }
  const output = resolve(directory);
  if (existsSync(output)) throw new Error(`Refusing to replace existing map release: ${output}`);
  mkdirSync(output, { recursive: true });
  const maps: ReturnType<typeof verifyMapPackage>[] = [];
  for (const name of names) {
    const { file } = await buildMap(name, release, output);
    maps.push(verifyMapPackage(file));
    Bun.gc(true);
  }
  writeFileSync(join(output, "release.json"), JSON.stringify(mapReleaseManifest(maps, release), null, 2) + "\n");
  console.log(`Verified ${maps.length} map packages in ${output}. Start a fresh world with --map <file> and a new --db path.`);
}

if (import.meta.main) {
  const args = process.argv.slice(2), directory = args.shift();
  if (!directory) throw new Error("Usage: bun tools/mapworld/build-set.ts <new-directory> <map-name>... [--release]");
  await buildMapSet(directory, args.filter(arg => arg !== "--release"), args.includes("--release"));
}
