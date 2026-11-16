// Writing the guide's files: media linked in from the caches rather than copied, and a Brotli copy of each text file.

import { copyFileSync, existsSync, linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { brotli } from "../build-client.ts";

/** Puts `from` at `to` as a hard link, or a copy where the two are on different disks. */
export function place(from: string, to: string): void {
  if (existsSync(to)) unlinkSync(to);
  try {
    linkSync(from, to);
  } catch {
    copyFileSync(from, to);
  }
}

/** Writes a text file and its Brotli copy beside it, which server/files.ts sends to a browser that takes it. */
export function writeText(file: string, text: string): number {
  const bytes = new TextEncoder().encode(text);
  writeFileSync(file, bytes);
  const packed = brotli(bytes, false);
  writeFileSync(`${file}.br`, packed);
  return packed.length;
}

export const brotliSize = (file: string): number => brotli(readFileSync(file), false).length;
