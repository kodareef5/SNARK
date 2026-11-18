import { parseManifest } from "../../shared/pack/manifest.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { warmSurvivor, warmWildlife } from "./model-preload.ts";
import { readHead, partHash } from "../../shared/world/mapfile.ts";

export async function preloadWorld(base: string, x: number, z: number, signal: AbortSignal, say: (s: string) => void): Promise<void> {
  const url = (path: string) => new URL(path, base).href;
  async function response(path: string) {
    const res = await fetch(url(path), { signal });
    if (!res.ok) throw Error("Could not load " + path);
    return res;
  }
  const [media, map] = await Promise.all(["entry-media.json", "map.json"].map(async (p) => (await response(p)).json()));
  const manifest = response("assets/manifest.json").then(r => r.text()).then(parseManifest);
  await Promise.all([
    manifest.then(m => warmSurvivor(base, m, signal)),
    ...[media.boot, media.content, media.sky].map(async (p) => (await response(p)).arrayBuffer()),
    (async () => {
      const head = readHead(new Uint8Array(await (await response(map.head)).arrayBuffer()));
      const col = Math.floor((head.dims.frameX + x / CHUNK_SIZE) / SECTOR_CHUNKS);
      const row = Math.floor((head.dims.frameZ + z / CHUNK_SIZE) / SECTOR_CHUNKS);
      const part = head.parts.find(p => p.kind === "ground" && p.col === col && p.row === row);
      if (!part || part.length > 2 * 1024 * 1024) return;
      const folder = map.head.slice(0, map.head.lastIndexOf("/") + 1);
      const bytes = new Uint8Array(await (await response(folder + part.name)).arrayBuffer());
      if (bytes.length !== part.length || partHash(bytes) !== part.hash) throw Error("Terrain checksum failed");
      say("Spawn terrain ready");
    })(),
  ]);
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (signal.aborted || connection?.saveData || ["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "")) return;
  void manifest.then(m => warmWildlife(base, m, signal)).catch(() => {});
  if (media.music) void fetch(url(media.music), { signal, cache: "force-cache" }).then(r => r.arrayBuffer()).catch(() => {});
}
