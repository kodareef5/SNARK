// Runs a script of tools/blender in Blender, with no window, no user settings and no scripts from the files it opens.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPTS = resolve(import.meta.dir, "../blender");
export const RAW = resolve(import.meta.dir, "../../assets/raw");

/**
 * Throws with the end of what Blender printed unless it exits cleanly and prints `done`. Returns what it printed.
 * It is given the environment as it stands: a spawn given none takes the one the process started with, and the art
 * tool sets SNARK_LAYOUT after that.
 */
export function blender(script: string, args: readonly string[], done: string): string {
  const run = Bun.spawnSync([process.env.BLENDER ?? "blender", "--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1", "--python", join(SCRIPTS, script), "--", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const said = run.stdout.toString();
  if (run.exitCode !== 0 || !said.includes(done)) {
    throw new Error(`Blender did not finish ${script}. Is it installed (brew install --cask blender)?\n${said.slice(-1500)}${run.stderr.toString().slice(-600)}`);
  }
  return said;
}

/** Calls `work` with a folder for what Blender writes, and removes it after. */
export function withScratch<T>(work: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "snark-art-"));
  try {
    return work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
