import { closeSync, existsSync, fstatSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A complete kit waits here while its predecessor moves to the backups. */
export const readyKit = (top: string, cut: string): string => join(top, ".kit-install", cut);

/** Hard-link the complete PID file. One contender at a time can reclaim a dead holder's inode. */
function take(lock: string, owner: string): void {
  try {
    linkSync(owner, lock);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const fd = openSync(lock, "r");
  try {
    const held = Number(readFileSync(fd, "utf8"));
    if (!Number.isSafeInteger(held) || held <= 0) throw new Error(`Unreadable city lock at ${lock}`);
    try {
      process.kill(held, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      const before = fstatSync(fd);
      const reclaim = `${lock}.reclaim-${before.ino}`;
      take(reclaim, owner);
      try {
        if (statSync(lock, { throwIfNoEntry: false })?.ino === before.ino) unlinkSync(lock);
        linkSync(owner, lock);
      } finally {
        unlinkSync(reclaim);
      }
      return;
    }
    throw new Error(`Another run of this city is going, process ${held} (${lock})`);
  } finally {
    closeSync(fd);
  }
}

/** A city build and a kit install share the lock. Either can finish an interrupted directory switch. */
export function withCityLock<T>(top: string, cut: string, run: () => T): T {
  mkdirSync(top, { recursive: true });
  const lock = join(top, "run.lock");
  const claim = mkdtempSync(join(top, ".claim-"));
  try {
    const owner = join(claim, "pid");
    writeFileSync(owner, String(process.pid));
    take(lock, owner);
  } finally {
    rmSync(claim, { recursive: true, force: true });
  }
  const release = (): void => { unlinkSync(lock); };
  process.on("exit", release);
  try {
    const ready = readyKit(top, cut);
    if (existsSync(ready) && !existsSync(join(top, cut))) renameSync(ready, join(top, cut));
    return run();
  } finally {
    process.off("exit", release);
    release();
  }
}
