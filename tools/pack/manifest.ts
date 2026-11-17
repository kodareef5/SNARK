// The manifest of a built pack, with each part hashed as the browser will hash what it fetches.

import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { describePack, type Manifest, type ManifestPart } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";

/** The first eight bytes of the SHA-256 of `bytes`, in hex. */
export const partHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** partHash of a file's bytes, read 16 MB at a time. */
export function fileHash(path: string): string {
  const hash = createHash("sha256");
  const piece = new Uint8Array(1 << 24);
  const fd = openSync(path, "r");
  try {
    for (let n = readSync(fd, piece); n > 0; n = readSync(fd, piece)) hash.update(piece.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex").slice(0, 16);
}

/** Parts of these sizes that follow one another from `at` in `file`, each with its hash. */
export function partsAt(file: Uint8Array, at: number, sizes: readonly number[]): ManifestPart[] {
  return sizes.map((bytes) => ({ bytes, hash: partHash(file.subarray(at, (at += bytes))) }));
}

export function manifestOf(name: string, file: Uint8Array): Manifest {
  return describePack(parsePack(file), { name, bytes: file.length }, partHash);
}
