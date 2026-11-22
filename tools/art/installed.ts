// Whether this checkout holds the art its manifest pins. It imports nothing of the project's, so the check can ask
// again after installing, and Node can run it.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifest = fileURLToPath(new URL("../../distribution/release.json", import.meta.url));
/** Written by the media command: the SHA-256 of the archive of each asset that is installed here. */
const installed = fileURLToPath(new URL("../../assets/.art-archives.json", import.meta.url));

export interface Pinned {
  name: string;
  sha256: string;
}

/** The names of the pinned archives that `state` does not record as installed. */
export function missingArt(pinned: readonly Pinned[], state: Record<string, string>): string[] {
  return pinned.filter((f) => state[f.name] !== f.sha256).map((f) => f.name);
}

/** How many archives the manifest pins, and which of them are not installed in this checkout. */
export function artState(): { pinned: number; missing: string[] } {
  const pinned: Pinned[] = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, "utf8")).art?.files ?? []) : [];
  return { pinned: pinned.length, missing: missingArt(pinned, existsSync(installed) ? JSON.parse(readFileSync(installed, "utf8")) : {}) };
}

/** A manifest that pins no art has none to install, and the tests that need art cannot run. */
export function artInstalled(): boolean {
  const { pinned, missing } = artState();
  return pinned > 0 && missing.length === 0;
}
