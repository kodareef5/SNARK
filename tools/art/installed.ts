// Whether this checkout holds the art its manifest pins. It imports nothing of the project's, so the check can ask
// again after installing, and Node can run it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
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

const source = fileURLToPath(new URL("../../assets/source", import.meta.url));

/**
 * Of `folders` (asset folders as paths under assets/source), those no pinned archive carries. An archive is named for
 * its folder with dashes, or for a folder above it.
 */
export function unreleased(folders: readonly string[], pinned: readonly Pinned[]): string[] {
  const names = new Set(pinned.map((f) => f.name));
  return folders.filter((folder) => {
    const parts = folder.split("/");
    for (let n = parts.length; n > 0; n--) if (names.has(parts.slice(0, n).join("-"))) return false;
    return true;
  });
}

/** The asset folders here (those with an asset.ts) whose art is in no release: no other checkout can install it. */
export function unreleasedHere(): string[] {
  if (!existsSync(manifest) || !existsSync(source)) return [];
  const pinned: Pinned[] = JSON.parse(readFileSync(manifest, "utf8")).art?.files ?? [];
  if (pinned.length === 0) return [];
  const folders = (readdirSync(source, { recursive: true }) as string[]).map((f) => f.replaceAll("\\", "/")).filter((f) => f.endsWith("/asset.ts")).map((f) => f.slice(0, -"/asset.ts".length));
  return unreleased(folders.sort(), pinned);
}
