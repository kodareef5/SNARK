// A cluster is a folder, as in ARK: every server of it is started with the same -clusterid and -ClusterDirOverride, and the folder
// is the one thing they share. They never talk to each other. Each says in it who it is and how to reach it, and what travels
// between them lies in it as one sealed file that changes hands by renaming, so exactly one server can take it.
//
//   servers/<world>.json    a world id taken by a save, and while its server runs, how to reach it (Announcement)
//   servers/<world>.lock    held by the server running that world, so two cannot (server/persist/lock.ts)
//   servers/<world>.names   the survivors' names that world has given out, and to whom
//   parcels/<id>-<from>.sealed   a transfer from world <from> on its way (server/cluster/parcel.ts)
//   parcels/<id>-<from>.at-<world>-<key>   taken by that world, for the browser whose device key hashes to <key>
//   tmp/                    files being written, renamed into place once whole

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { holdSave, type SaveLock } from "../persist/lock.ts";

/** What a server says of itself in the folder. Rewritten every few seconds while it runs; `at` 0 says it has stopped. */
export interface Announcement {
  world: number;
  /** The save that took this world id, which no other may use (WorldStore.saveId), and its whole path. */
  saveId: string;
  save: string;
  /** SessionName, or the map's label where there is none. */
  name: string;
  /** Its map as a person reads it (mapLabel), and its id. */
  map: string;
  mapId: string;
  /** How a page reaches it: the port on this machine, and the address it was told it is reached at from elsewhere ("" for none). */
  port: number;
  url: string;
  players: number;
  max: number;
  /** The content hash of what it runs, as written (Registry.coreHash). A survivor carries only what both servers know. */
  content: number;
  /** It takes survivors from other servers: neither PreventDownloadSurvivors nor noTributeDownloads is set. */
  survivors: boolean;
  /** It takes things a survivor carries from another server: neither PreventDownloadItems nor noTributeDownloads is set. */
  items: boolean;
  /** Wall clock, milliseconds, of the last time it said so. */
  at: number;
}

/**
 * A transfer's file as the folder names it: `from` is the world it left, `by` the world that took it, 0 while sealed, and `key`
 * the hex of the device key hash it was taken for.
 */
export interface ParcelPlace {
  id: string;
  from: number;
  by: number;
  key: string;
  file: string;
}

/** An announcement older than this is a server that has stopped or died. */
export const LIVE_MS = 15_000;
const SEALED = /^([0-9a-f]{32})-(\d+)\.sealed$/;
const TAKEN = /^([0-9a-f]{32})-(\d+)\.at-(\d+)-([0-9a-f]{32})$/;

/** Makes sure what was renamed or written into a folder stays there through a crash of the machine. Not every system can. */
function syncFolder(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // A file system that cannot sync a folder has written it as well as it can.
  }
}

export class ClusterFolder {
  readonly root: string;
  private readonly servers: string;
  private readonly parcels: string;
  private readonly tmp: string;
  private written = 0;

  constructor(root: string) {
    this.root = root;
    this.servers = join(root, "servers");
    this.parcels = join(root, "parcels");
    this.tmp = join(root, "tmp");
    for (const dir of [this.servers, this.parcels, this.tmp]) mkdirSync(dir, { recursive: true });
  }

  /** Writes a whole file under `path` by renaming it into place, so a reader sees all of it or none. `durable` syncs it to disk first. */
  write(path: string, data: string | Uint8Array, durable: boolean): void {
    const tmp = join(this.tmp, `${process.pid}-${++this.written}`);
    const fd = openSync(tmp, "w");
    try {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      for (let off = 0; off < bytes.length; ) off += writeSync(fd, bytes, off);
      if (durable) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    if (durable) syncFolder(join(path, ".."));
  }

  /** Takes world `world` for this process. Throws if a running server holds it. */
  hold(world: number): SaveLock {
    try {
      return holdSave(join(this.servers, String(world)));
    } catch (err) {
      if (err instanceof Error && err.message.endsWith("is in use by another server")) throw new Error(`world ${world} of the cluster in ${this.root} is running in another server`);
      throw err;
    }
  }

  announcement(world: number): Announcement | null {
    const path = join(this.servers, `${world}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Announcement;
    } catch {
      return null;
    }
  }

  /** Every world id taken, lowest first. */
  announcements(): Announcement[] {
    const out: Announcement[] = [];
    for (const name of readdirSync(this.servers)) {
      const m = /^(\d+)\.json$/.exec(name);
      const a = m ? this.announcement(Number(m[1])) : null;
      if (a) out.push(a);
    }
    return out.sort((a, b) => a.world - b.world);
  }

  /** A world id is taken for good the first time it is written, so it is written to disk. Later writes are news and are not. */
  announce(a: Announcement, durable = false): void {
    this.write(join(this.servers, `${a.world}.json`), JSON.stringify(a), durable);
  }

  /** The names world `world` has given out, each to the survivor's record id, or null if it has said none. */
  names(world: number): Map<string, number> | null {
    const path = join(this.servers, `${world}.names`);
    if (!existsSync(path)) return null;
    try {
      return new Map(Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, number>));
    } catch {
      return null;
    }
  }

  writeNames(world: number, names: ReadonlyMap<string, number>): void {
    this.write(join(this.servers, `${world}.names`), JSON.stringify(Object.fromEntries(names)), false);
  }

  /** Every transfer file, sealed or taken. */
  places(): ParcelPlace[] {
    const out: ParcelPlace[] = [];
    for (const file of readdirSync(this.parcels)) {
      const sealed = SEALED.exec(file);
      if (sealed) out.push({ id: sealed[1]!, from: Number(sealed[2]), by: 0, key: "", file });
      const taken = TAKEN.exec(file);
      if (taken) out.push({ id: taken[1]!, from: Number(taken[2]), by: Number(taken[3]), key: taken[4]!, file });
    }
    return out;
  }

  /** Where transfer `id` is, or null if no file of it is in the folder. */
  place(id: string): ParcelPlace | null {
    return this.places().find((p) => p.id === id) ?? null;
  }

  /** The bytes of a transfer file. Null if it has moved since it was found. */
  read(place: ParcelPlace): Uint8Array | null {
    try {
      return new Uint8Array(readFileSync(join(this.parcels, place.file)));
    } catch {
      return null;
    }
  }

  /** Puts a new transfer from world `from` in the folder, whole and on disk, before anything depends on it. */
  seal(id: string, from: number, bytes: Uint8Array): void {
    this.write(join(this.parcels, `${id}-${from}.sealed`), bytes, true);
  }

  /**
   * World `world` takes sealed transfer `id`, which left world `from`, for the device key hash `key` (hex). One rename, so of
   * two takers exactly one succeeds. False, with nothing changed, if it was not sealed: another took it first.
   */
  take(id: string, from: number, world: number, key: string): boolean {
    try {
      renameSync(join(this.parcels, `${id}-${from}.sealed`), join(this.parcels, `${id}-${from}.at-${world}-${key}`));
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return false;
      throw err;
    }
    syncFolder(this.parcels);
    return true;
  }

  /** Seals again a transfer its taker could not keep, so that it goes back where it came from. */
  untake(place: ParcelPlace): boolean {
    try {
      renameSync(join(this.parcels, place.file), join(this.parcels, `${place.id}-${place.from}.sealed`));
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return false;
      throw err;
    }
    syncFolder(this.parcels);
    return true;
  }

  /** Deletes what a write left half done and never renamed, a minute after. */
  sweep(now: number): void {
    for (const name of readdirSync(this.tmp)) {
      const path = join(this.tmp, name);
      try {
        if (now - statSync(path).mtimeMs > 60_000) rmSync(path, { force: true });
      } catch {
        // Another server swept it first.
      }
    }
  }
}
