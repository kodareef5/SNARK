// Package the native photos saved by tools/wiki/photos.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { partHash } from "../pack/manifest.ts";
import type { Image } from "./html.ts";
import { CARD_SIZE, PORTRAIT_SIZE, WIKI_SCENE_BRIEFS, photoName, photoSize } from "./photo-recipes.ts";

export { WIKI_SCENE_BRIEFS };

export interface WikiScene {
  picture: Image;
  card?: Image;
  portrait?: Image;
  caption: string;
  alt: string;
}

export function buildWikiScenes(source: string, out: string, prefix: string, withMiami: boolean): ReadonlyMap<string, WikiScene> {
  mkdirSync(out, { recursive: true });
  function copy(name: string, [width, height]: readonly [number, number], limit: number, variant = ""): Image {
    const path = join(source, name + variant + ".webp");
    const bytes = readFileSync(path);
    if (bytes.length > limit) throw Error(`Wiki photo ${path} exceeds ${limit / 1024} KiB`);
    const file = `scene-${name}.${partHash(bytes)}${variant}.webp`;
    writeFileSync(join(out, file), bytes);
    return { file: prefix + file, width, height };
  }

  const scenes = new Map<string, WikiScene>();
  for (const { route, caption, alt } of WIKI_SCENE_BRIEFS) {
    if (!withMiami && route && route !== "footer") continue;
    const name = photoName(route);
    const picture = copy(name, photoSize(route), 320 * 1024);
    const card = route !== "footer" ? copy(name, CARD_SIZE, 64 * 1024, ".card") : undefined;
    const portrait = route === "" ? copy(name, PORTRAIT_SIZE, 320 * 1024, ".portrait") : undefined;
    scenes.set(route, { picture: { ...picture, small: card }, card, portrait, caption, alt });
  }
  return scenes;
}
