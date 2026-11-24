import { renameSync, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { readHead, type MapHead } from "../../shared/world/mapfile.ts";

export const WIKI_PHOTOS = resolve(import.meta.dir, "../../.cache/wiki/photographs");

export async function readPhotoMap(path: string, city: string): Promise<MapHead> {
  const file = Bun.file(path);
  const prefix = new DataView(await file.slice(0, 16).arrayBuffer());
  const head = readHead(new Uint8Array(await file.slice(0, prefix.getUint32(12, true)).arrayBuffer()));
  if (head.id !== `core:${city}`) throw new Error(`${path} contains ${head.id}. Use the built map for ${city}.`);
  return head;
}

export function encodePhoto(cwebp: string, input: string, destination: string, [w, h]: readonly [number, number], limit: number, qualities: readonly number[]): void {
  const temp = destination + `.${process.pid}.webp`;
  try {
    for (const quality of qualities) {
      const job = Bun.spawnSync([cwebp, "-quiet", "-q", String(quality), "-m", "6", "-resize", String(w), String(h), input, "-o", temp]);
      if (job.exitCode !== 0) throw new Error(job.stderr.toString());
      const size = statSync(temp).size;
      if (size > limit) continue;
      renameSync(temp, destination);
      console.log(`${basename(destination)} ${w}×${h} ${Math.round(size / 1024)} KiB`);
      return;
    }
    throw new Error(`${destination} exceeds ${limit / 1024} KiB`);
  } finally {
    rmSync(temp, { force: true });
  }
}
