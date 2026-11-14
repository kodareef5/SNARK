// The manifest of a built pack, with each part hashed as the browser will hash what it fetches.

import { createHash } from "node:crypto";
import { describePack, type Manifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";

/** The first eight bytes of the SHA-256 of `bytes`, in hex. */
export const partHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

export function manifestOf(name: string, file: Uint8Array): Manifest {
  return describePack(parsePack(file), { name, bytes: file.length }, partHash);
}
