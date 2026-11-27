// The Decide settings one world copies to its whole cluster. Worlds share only the cluster's folder, so the copy is a file
// there, decide.json, written whole by a rename. Every world of the cluster, the writer too, reads it every five seconds,
// off the tick's thread, and takes a copy newer than the last it took through the admin page's own setting path, so the
// settings are live, kept beside its save and in its admin log. The save keeps which copy it took, so a restart does not
// take an old copy again over what was set by hand since.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DECIDE_SETTINGS, type DecideSettingName } from "../../shared/admin-decide.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { OPERATOR, type Actor } from "../acts.ts";
import type { Sidecar } from "../persist/persistence.ts";
import type { Decide } from "./decide.ts";

export const COPY_FILE = "decide.json";
/** Ticks between two reads of the copy. */
export const LOOK_TICKS = 5 * TICK_RATE;

export interface CopyFile {
  /** Counts up across the cluster: a world takes a copy only above the last it took. */
  rev: number;
  /** The world that wrote it, and when, wall ms. */
  from: number;
  at: number;
  settings: Record<DecideSettingName, string>;
}

export interface CopyCtx {
  /** The cluster's folder. */
  root: string;
  world: number;
  /** Wall ms. */
  now: () => number;
  /** The Decide settings' words as they stand. */
  settings: () => Record<DecideSettingName, string>;
  /** Sets one as the admin page does, as `by`: "" when done, else why not. */
  set: (name: DecideSettingName, words: string, by: Actor) => string;
  /** Writes the save's note of the copy taken now, so a crash after taking it does not take it again. */
  keep?: () => void;
  say?: (line: string) => void;
}

/** The Decide settings of `rules` as words. */
export function settingsOf(rules: { text(name: string): string; num(name: string): number }): Record<DecideSettingName, string> {
  return { DecidePolicy: rules.text("DecidePolicy"), DecideSample: String(rules.num("DecideSample")), DecideLogMegabytes: String(rules.num("DecideLogMegabytes")) };
}

/** The copy in `text`, or null where it is not a whole one. */
export function readCopy(text: string): CopyFile | null {
  let f: Partial<CopyFile> | null;
  try {
    f = JSON.parse(text) as Partial<CopyFile> | null;
  } catch {
    return null;
  }
  if (!f || typeof f !== "object" || !Number.isSafeInteger(f.rev) || f.rev! <= 0 || typeof f.settings !== "object" || f.settings === null) return null;
  const settings = {} as Record<DecideSettingName, string>;
  for (const name of DECIDE_SETTINGS) {
    const v = (f.settings as Record<string, unknown>)[name];
    if (typeof v !== "string" && typeof v !== "number") return null;
    settings[name] = String(v);
  }
  return { rev: f.rev!, from: Number(f.from) || 0, at: Number(f.at) || 0, settings };
}

export class DecideCopy {
  /** The newest copy this world took. */
  rev = 0;
  readonly saved: Sidecar = { dirty: false, serialize: () => JSON.stringify({ rev: this.rev }) };
  private readonly ctx: CopyCtx;
  private readonly path: string;
  private reading: Promise<void> | null = null;
  private got: string | null = null;
  private written = 0;

  constructor(ctx: CopyCtx) {
    this.ctx = ctx;
    this.path = join(ctx.root, COPY_FILE);
  }

  /** What the save kept of the copy taken. */
  restore(text: string | null): void {
    try {
      const rev = (JSON.parse(text ?? "{}") as { rev?: unknown }).rev;
      if (typeof rev === "number" && Number.isSafeInteger(rev)) this.rev = rev;
    } catch {
      // A note that cannot be read is no copy taken: the next copy is taken whatever its number.
    }
  }

  /** Every tick: takes what the last read found, and starts the next read every five seconds. */
  step(tick: number): void {
    if (this.got !== null) {
      const text = this.got;
      this.got = null;
      this.take(text);
    }
    if (tick % LOOK_TICKS === 0 && this.reading === null) this.reading = this.read();
  }

  /** Settles once the read under way has, if one is. */
  idle(): Promise<void> {
    return this.reading ?? Promise.resolve();
  }

  /** Writes this world's settings as the cluster's newest copy. Answers "" when written, else why not. */
  async clone(): Promise<{ why: string; rev: number }> {
    let rev = this.rev;
    try {
      rev = Math.max(rev, readCopy(await readFile(this.path, "utf8"))?.rev ?? 0);
    } catch {
      // No copy yet.
    }
    const file: CopyFile = { rev: rev + 1, from: this.ctx.world, at: this.ctx.now(), settings: this.ctx.settings() };
    const dir = join(this.ctx.root, "tmp"), tmp = join(dir, `decide-${process.pid}-${++this.written}`);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(tmp, JSON.stringify(file));
      await rename(tmp, this.path);
    } catch (err) {
      return { why: `the cluster's folder could not be written: ${err instanceof Error ? err.message : String(err)}`, rev: 0 };
    }
    return { why: "", rev: file.rev };
  }

  private async read(): Promise<void> {
    try {
      this.got = await readFile(this.path, "utf8");
    } catch {
      // No copy yet, or the folder is away for now: read again in five seconds.
    } finally {
      this.reading = null;
    }
  }

  private take(text: string): void {
    const f = readCopy(text);
    // A file half written or broken is left, and read again in five seconds.
    if (!f || f.rev <= this.rev) return;
    const now = this.ctx.settings(), by: Actor = { ...OPERATOR, name: `(world ${f.from}'s copy)` };
    for (const name of DECIDE_SETTINGS) {
      if (now[name] === f.settings[name]) continue;
      const why = this.ctx.set(name, f.settings[name], by);
      if (why !== "") this.ctx.say?.(`decide: the cluster's copy ${f.rev} from world ${f.from} could not set ${name}: ${why}`);
    }
    this.rev = f.rev;
    this.saved.dirty = true;
    this.ctx.keep?.();
  }
}

const copies = new WeakMap<Decide, DecideCopy>();

/** The cluster's copy that `decide`'s world takes part in, or null for a world alone. */
export function copyOf(decide: Decide): DecideCopy | null {
  return copies.get(decide) ?? null;
}

/** Makes `decide`'s world take part in its cluster's copy, stepped right after the decider's own row. */
export function shareDecide(decide: Decide, ctx: CopyCtx): DecideCopy {
  const copy = new DecideCopy(ctx);
  copies.set(decide, copy);
  const own = decide.step.bind(decide);
  decide.step = (tick: number): void => {
    own(tick);
    copy.step(tick);
  };
  return copy;
}
