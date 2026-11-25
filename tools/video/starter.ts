// The default clips in a built client: each clip and poster at /media/<name>.<sha16>.<ext>, which the server caches as
// immutable, and media/starter.json listing them with those paths and the default channels. A clip whose art is not
// installed is left out, and so is a channel left with none.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Clip } from "../../shared/video/clip.ts";
import type { StarterChannel } from "../../server/video/library.ts";
import { clipNames, readChannels, readClip } from "./clips.ts";

/** What starter.json holds: the clips and the channels a fresh library starts with, by clip id. */
export interface StarterList {
  readonly clips: readonly Clip[];
  readonly channels: readonly StarterChannel[];
}

const sha16 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);

/** Copies the default clips in `from` (assets/source/core/video) to `<dist>/media`, and gives how many it copied. */
export function copyStarterClips(from: string, dist: string): number {
  const media = join(dist, "media");
  rmSync(media, { recursive: true, force: true });
  const ids = new Map<string, string>(), clips: Clip[] = [];
  for (const name of existsSync(from) ? clipNames(from) : []) {
    const c = readClip(name, from);
    if (!c || !existsSync(join(from, name, c.file)) || !existsSync(join(from, name, c.poster))) continue;
    mkdirSync(media, { recursive: true });
    const place = (file: string): string => {
      const at = join(from, name, file), named = `${name}.${sha16(readFileSync(at))}${file.slice(file.lastIndexOf("."))}`;
      copyFileSync(at, join(media, named));
      return `/media/${named}`;
    };
    clips.push({ ...c, file: place(c.file), poster: place(c.poster) });
    ids.set(name, c.id);
  }
  if (!clips.length) return 0;
  const channels = readChannels(from)
    .map((ch) => ({ name: ch.name, shuffle: ch.shuffle, items: ch.items.flatMap((n) => (ids.has(n) ? [ids.get(n)!] : [])) }))
    .filter((ch) => ch.items.length > 0);
  writeFileSync(join(media, "starter.json"), JSON.stringify({ clips, channels } satisfies StarterList));
  return clips.length;
}
