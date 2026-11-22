// The wire version of this checkout (shared/net/wire.ts), read from its source, and the one a build left beside the
// client's files for a server that runs without its source.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { wireOf } from "../shared/net/wire.ts";

/** The wire version of the checkout at `root`, or null where it has no shared/ folder. */
export function sourceWire(root: string = join(import.meta.dir, "..")): number | null {
  const dir = join(root, "shared");
  try {
    return wireOf(readdirSync(dir, { recursive: true }) as string[], (name) => readFileSync(join(dir, name), "utf8"));
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
  if (own === null && built === null) throw new Error(`no source under shared/ and no build.json in ${clientDir} to take the wire version from: bun run build`);
  return { wire: own ?? built!, stale: own !== null && built !== null && built !== own };
}
