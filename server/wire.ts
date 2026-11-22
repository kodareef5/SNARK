// The wire version of this checkout (shared/net/wire.ts), read from its source, and the one a build left beside the
// client's files for a server that runs without its source.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { WIRE_FOLDERS, wireOf } from "../shared/net/wire.ts";

/** Every file under the wire folders of the checkout at `root`, as paths from it. Throws where a folder is not there. */
export function wireFiles(root: string): string[] {
  const names: string[] = [];
  for (const folder of WIRE_FOLDERS) for (const name of readdirSync(join(root, folder), { recursive: true }) as string[]) names.push(`${folder}/${name}`);
  return names;
}

/** The wire version of the checkout at `root`, or null where it lacks one of the wire folders. */
export function sourceWire(root: string = join(import.meta.dir, "..")): number | null {
  try {
    return wireOf(wireFiles(root), (name) => readFileSync(join(root, name), "utf8"));
  } catch {
    return null;
  }
}

/** The wire version the client in `clientDir` was built with (its build.json), or null where it does not say. */
export function builtWire(clientDir: string): number | null {
  try {
    const wire = (JSON.parse(readFileSync(join(clientDir, "build.json"), "utf8")) as { wire?: unknown }).wire;
    return typeof wire === "number" ? wire : null;
  } catch {
    return null;
  }
}

/**
 * The version a server serving `clientDir` speaks: its own source's, or without source the client's. `stale` says its
 * client was built from other source, so its page will be refused.
 */
export function serverWire(clientDir: string, root?: string): { wire: number; stale: boolean } {
  const own = sourceWire(root), built = builtWire(clientDir);
  if (own === null && built === null) throw new Error(`no source to read and no build.json in ${clientDir} to take the wire version from: bun run build`);
  return { wire: own ?? built!, stale: own !== null && built !== null && built !== own };
}
