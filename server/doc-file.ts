// Writing a document an admin edits (a drop book, a loadout book) to its file beside the save.

import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";

/** Writes a file whole beside its place and renames it there, so a kill leaves the old file or the new and never half of one. */
export function put(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, text);
    const fd = openSync(tmp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // What could not be written may not be there to take away.
    }
    throw err;
  }
}

/** Why a file could not be written: the system's code where it gave one. */
export const why = (err: unknown): string => (err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.message) : String(err));
