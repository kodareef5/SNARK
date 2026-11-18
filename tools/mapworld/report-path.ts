import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CHUNK_SIZE, FRAME_MIDDLE, type FramedDims } from "../../shared/coords.ts";
import type { World } from "./ground.ts";
import { workFolder } from "../maps/work.ts";

/** A map file named on the command line and its source: the city's work folder (tools/maps/work.ts), or the folder after --source. */
export function reportPaths(): { mapFile: string; source: string; folder: string; world: World } {
  const args = process.argv.slice(2);
  const mapFile = args.find((a) => a.endsWith(".snmap"));
  if (!mapFile) throw new Error("A map .snmap argument is required");
  const named = args.indexOf("--source");
  const source = named >= 0 && args[named + 1] ? resolve(args[named + 1]!) : workFolder(basename(mapFile, ".snmap"));
  const world = JSON.parse(readFileSync(join(source, "world/world.json"), "utf8")) as World;
  return { mapFile, source, world, folder: join(source, "reports", world.ruins?.report ?? "ruins") };
}

/**
 * A report the build wrote, its places turned from the lattice metres it writes them in (Grid, base.ts) into the map's
 * own: every object's x and z, and an entry's core.
 */
export function readReport<T>(folder: string, name: string, dims: Pick<FramedDims, "frameX" | "frameZ">): T {
  const [x0, z0] = [(dims.frameX - FRAME_MIDDLE) * CHUNK_SIZE, (dims.frameZ - FRAME_MIDDLE) * CHUNK_SIZE];
  return JSON.parse(readFileSync(join(folder, name), "utf8"), (_, v: Record<string, unknown> | null) => {
    if (v === null || typeof v !== "object" || Array.isArray(v) || typeof v.x !== "number" || typeof v.z !== "number") return v;
    v.x -= x0;
    v.z -= z0;
    if (typeof v.coreX === "number" && typeof v.coreZ === "number") [v.coreX, v.coreZ] = [v.coreX - x0, v.coreZ - z0];
    return v;
  }) as T;
}
