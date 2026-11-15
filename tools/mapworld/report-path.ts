import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { World } from "./ground.ts";

export function reportPaths(): { mapFile: string; source: string; folder: string; world: World } {
  const mapFile = process.argv.slice(2).find((a) => a.endsWith(".snmap"));
  if (!mapFile) throw new Error("A map .snmap argument is required");
  const source = join("assets/source/maps", basename(mapFile, ".snmap"));
  const world = JSON.parse(readFileSync(join(source, "world/world.json"), "utf8")) as World;
  return { mapFile, source, world, folder: join(source, "reports", world.ruins?.report ?? "ruins") };
}
