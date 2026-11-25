// The starter clips in a built client: each clip and poster at /media/<name>.<sha16>.<ext>, which the server caches as
// immutable, and media/starter.json listing them with those paths. Without the art there is no starter.json.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Clip } from "../../shared/video/clip.ts";

/** What clips.json and starter.json hold: the clips and the ids of those in the default strip. */
export interface StarterList {
  readonly clips: readonly Clip[];
  readonly strip: readonly string[];
}

const sha16 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);

/** Copies the clips in `from` (a folder holding clips.json) to `<dist>/media`, and gives how many it copied. */
export function copyStarterClips(from: string, dist: string): number {
  const media = join(dist, "media");
  rmSync(media, { recursive: true, force: true });
  const listFile = join(from, "clips.json");
  if (!existsSync(listFile)) return 0;
  const list = JSON.parse(readFileSync(listFile, "utf8")) as StarterList;
  if (!list.clips.every((c) => existsSync(join(from, c.file)) && existsSync(join(from, c.poster)))) return 0;
  mkdirSync(media, { recursive: true });
  const place = (file: string): string => {
    const bytes = readFileSync(join(from, file));
    const named = file.replace(/\.(\w+)$/, `.${sha16(bytes)}.$1`);
    copyFileSync(join(from, file), join(media, named));
    return `/media/${named}`;
  };
  const clips = list.clips.map((c) => ({ ...c, file: place(c.file), poster: place(c.poster) }));
  writeFileSync(join(media, "starter.json"), JSON.stringify({ clips, strip: list.strip }));
  return clips.length;
}
