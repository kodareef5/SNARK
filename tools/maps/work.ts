// Where a city's made files are: the work folder tools/maps/city.ts built last, var/mapdata/<city>/current. Its
// base/, blocks/, world/, ruins/ and reports/ are what the build, the walks and the reports read. A city's folder under
// assets/source/maps holds only what people wrote (tools/maps/README.md), so a tool that wants a layer comes here.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

/** The work folder of the cut of `city` built last; throws, saying how to make it, where there is none. */
export function workFolder(city: string): string {
  const current = join(ROOT, "var/mapdata", city, "current");
  if (!existsSync(join(current, "map.json"))) throw new Error(`${city} has not been made on this machine: bun tools/maps/city.ts ${city}`);
  return current;
}

/** A city's authored folder, assets/source/maps/<city>. */
export function cityFolder(city: string): string {
  return join(ROOT, "assets/source/maps", city);
}
