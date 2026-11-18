import { warmSurvivor } from "./model-preload.ts";
import { firstFrameParts } from "../core/mapload.ts";
import { readHead, partHash } from "../../shared/world/mapfile.ts";

export async function preloadWorld(base: string, x: number, z: number, signal: AbortSignal, say: (s: string) => void): Promise<void> {
  const url = (path: string) => new URL(path, base).href;
  async function response(path: string) {
    const res = await fetch(url(path), { signal });
    if (!res.ok) throw Error("Could not load " + path);
    return res;
  }
  const [media, map] = await Promise.all(["entry-media.json", "map.json"].map(async (p) => (await response(p)).json()));
  await Promise.all([
    (async () => warmSurvivor(base, await (await response("assets/manifest.json")).text(), signal))(),
    ...[media.boot, media.content, media.sky].map(async (p) => (await response(p)).arrayBuffer()),
    (async () => {
      const head = readHead(new Uint8Array(await (await response(map.head)).arrayBuffer()));
      const parts = firstFrameParts(head, x, z),
        folder = map.head.slice(0, map.head.lastIndexOf("/") + 1);
      let next = 0,
        done = 0;
      async function lane() {
        while (next < parts.length) {
          const part = parts[next++]!;
          const bytes = new Uint8Array(await (await response(folder + part.name)).arrayBuffer());
          if (bytes.length !== part.length || partHash(bytes) !== part.hash) throw Error("Terrain checksum failed");
          say("Terrain · " + ++done + " / " + parts.length);
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, parts.length) }, lane));
    })(),
  ]);
}
