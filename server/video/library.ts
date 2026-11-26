// A cluster's clips, channels and screens, kept in video.sqlite beside its worlds and shared by them all. The starter clips
// come with the built client (<dist>/media/starter.json); uploaded clips and the manifests live in the media folder.
// Every change is a compare-and-swap on one revision, so two admin pages never overwrite each other unseen.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCREENS, channelType, defaultScreen, isImage, offeredOn, type Channel, type Clip, type Screen, type ScreenType } from "../../shared/video/clip.ts";
import type { Timed } from "../../shared/video/programme.ts";

/**
 * What the database keeps: uploaded items in the order they were added, the channels, the screens, the hidden starters,
 * and the types a starter is offered on where an admin changed them.
 */
export interface LibraryDoc {
  clips: Clip[];
  channels: Channel[];
  screens: Screen[];
  hidden: string[];
  types?: Record<string, ScreenType[]>;
  /** The curated release has already checked this library. */
  curatedStrip?: true;
  /** The types whose starter channels this library has taken; a doc without it took the ball's alone. */
  seeded?: ScreenType[];
}

/** An upload checked and in place but not yet published, with what its boxes said. */
export interface Pending {
  readonly id: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly seconds: number;
  readonly kbps: number;
  readonly bytes: number;
  readonly audio: boolean;
  readonly at: number;
  /** "image" for a still, whose seconds, rate and sound are 0. */
  readonly kind?: "image";
}

/** A default channel as the starter file lists it: its name, its clips' ids in order, and whether it shuffles. */
export interface StarterChannel {
  readonly name: string;
  readonly items: readonly string[];
  readonly shuffle?: boolean;
  /** The type of screen it plays on; the ball where it says none. */
  readonly type?: ScreenType;
  /** Seconds an image holds in it. */
  readonly still?: number;
}

/** What a starter file lists: the built clips, and the channels a fresh library starts with. */
export interface Starters {
  readonly clips: readonly Clip[];
  readonly channels: readonly StarterChannel[];
}

/** The library as a world reads it: the doc, the manifest the clients are sent, and lookups the programme needs. */
export interface LibraryView {
  readonly revision: number;
  readonly doc: LibraryDoc;
  readonly starters: readonly Clip[];
  /** Every clip by id, starters and uploads, hidden or not. */
  readonly all: ReadonlyMap<string, Clip>;
  /** The visible clips, in manifest order. */
  readonly manifest: readonly Clip[];
  /** The manifest's id: the first 16 hex digits of the SHA-256 of its JSON. */
  readonly manifestId: string;
  readonly channels: ReadonlyMap<string, Channel>;
  readonly screens: ReadonlyMap<ScreenType, Screen>;
  /** The visible clips by id, which is what a screen may play. */
  readonly timed: ReadonlyMap<string, Timed>;
}

export interface LibraryOptions {
  /** video.sqlite, or ":memory:". */
  readonly db: string;
  /** Where uploads, posters and manifests are kept. Without one a memory library makes a temporary folder. */
  readonly media?: string;
  /** Where uploads are written while they arrive; on the same disk as `media`. */
  readonly tmp?: string;
  /** The built client's starter.json. */
  readonly starters?: string;
  readonly now?: () => number;
}

/** How long an upload waits to be published, and an old manifest to be fetched by a page that has not reloaded. */
export const PENDING_MS = 60 * 60 * 1000;
export const MANIFEST_KEEP_MS = 60 * 60 * 1000;

/** A file name's part from a title: lower case, dashes between words, at most 40 letters. */
export function slugOf(title: string, none = "clip"): string {
  const s = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s || none;
}

/** An edit that failed: the status to answer and what to say. */
export interface Refusal {
  readonly status: number;
  readonly error: string;
}

/** The most channels a library holds, and the longest name one may have. */
export const CHANNELS_MAX = 32;
export const NAME_MAX = 40;

const sha16 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);
const STRIP = "strip";
const FORMER_STRIP_CLIP = "fb06d4910de294c6";

interface LibraryRow {
  revision: number;
  doc: string;
}

const SELECT_LIBRARY = "SELECT revision, doc FROM library WHERE id=1";

/** What a doc written before screen types had taken: the ball's channels. */
const OLD_SEEDED: readonly ScreenType[] = ["orb"];

/** The types the starters have channels for, in SCREENS order. */
const starterTypes = (starters: Starters): ScreenType[] => SCREENS.filter((t) => starters.channels.some((c) => (c.type ?? "orb") === t));

/** `name`, or the first of "name 2", "name 3"… that no channel in `taken` has, within NAME_MAX letters. */
function freeName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const tail = n === 1 ? "" : ` ${n}`, next = name.slice(0, NAME_MAX - tail.length).trimEnd() + tail;
    if (!taken.has(next)) return next;
  }
}

/**
 * Gives a doc the starter channels of each type it has not taken yet, once. A type the doc already has a channel of
 * only takes the mark. A name in use takes a number. Hidden items and items not offered on the type are left out, and
 * channels past CHANNELS_MAX are not added. A screen of the type that was dark shows the first channel added.
 */
function seedTypes(doc: LibraryDoc, starters: Starters, now: number): void {
  const seeded = [...(doc.seeded ?? OLD_SEEDED)], hidden = new Set(doc.hidden), byId = new Map(starters.clips.map((c) => [c.id, c]));
  const taken = new Set(doc.channels.map((c) => c.name));
  for (const type of starterTypes(starters)) {
    if (seeded.includes(type)) continue;
    seeded.push(type);
    if (doc.channels.some((c) => channelType(c) === type)) continue;
    let first = "";
    for (const c of starters.channels) {
      if ((c.type ?? "orb") !== type || doc.channels.length >= CHANNELS_MAX) continue;
      const items = c.items.filter((id) => !hidden.has(id) && byId.has(id) && offeredOn({ types: doc.types?.[id] ?? byId.get(id)!.types }, type));
      if (items.length === 0) continue;
      const name = freeName(c.name, taken);
      taken.add(name);
      doc.channels.push({ name, items, shuffle: c.shuffle === true, epoch: now, ...(type !== "orb" ? { type } : {}), ...(c.still ? { still: c.still } : {}) });
      first ||= name;
    }
    if (!first || type === "orb") continue;
    const at = doc.screens.findIndex((s) => s.screen === type);
    if (at < 0) doc.screens.push(defaultScreen(type, first));
    else if (doc.screens[at]!.show === "scenes") doc.screens[at] = { ...doc.screens[at]!, show: first };
  }
  doc.seeded = SCREENS.filter((t) => seeded.includes(t));
}

export class VideoLibrary {
  readonly media: string;
  readonly tmp: string;
  /** The temporary folder a library without a media folder made, removed at its close. */
  private readonly temp: string;
  private db: Database | null = null;
  private readonly path: string;
  private readonly startersFile: string;
  private readonly now: () => number;
  private starters: Starters = { clips: [], channels: [] };
  private startersAt = -1;
  /** Changes made through this object, so a memory library has a stamp. */
  private writes = 0;
  private cached: LibraryView | null = null;

  constructor(opts: LibraryOptions) {
    this.path = opts.db;
    this.now = opts.now ?? Date.now;
    this.startersFile = opts.starters ?? "";
    const temp = (this.temp = opts.media ? "" : mkdtempSync(join(tmpdir(), "snark-video-")));
    this.media = opts.media ?? join(temp, "media");
    this.tmp = opts.tmp ?? (temp ? join(temp, "tmp") : `${this.media}.tmp`);
    for (const dir of [this.media, this.tmp]) mkdirSync(dir, { recursive: true });
  }

  private open(): Database {
    if (this.db) return this.db;
    const db = new Database(this.path, { create: true });
    // The default journal, not WAL: each commit changes video.sqlite itself, whose time the worlds watch.
    db.exec(
      "PRAGMA busy_timeout=2500;" +
        "CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, doc TEXT NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, info TEXT NOT NULL, at INTEGER NOT NULL);",
    );
    this.db = db;
    this.readStarters();
    const strip = this.starters.channels.find((c) => c.name === STRIP);
    const fresh: LibraryDoc = {
      clips: [],
      channels: this.starters.channels.map((c) => ({ name: c.name, items: [...c.items], shuffle: c.shuffle === true, epoch: this.now(), ...(c.type && c.type !== "orb" ? { type: c.type } : {}), ...(c.still ? { still: c.still } : {}) })),
      // The ball starts on the curated Strip where the starters have it; any other type on its first channel.
      screens: SCREENS.map((id) => (id === "orb" ? (strip ? { ...defaultScreen(id), show: STRIP } : defaultScreen(id)) : defaultScreen(id, this.starters.channels.find((c) => (c.type ?? "orb") === id)?.name))),
      hidden: [],
      seeded: starterTypes(this.starters),
    };
    if (strip?.items.some((id) => id !== FORMER_STRIP_CLIP)) fresh.curatedStrip = true;
    if (db.query("INSERT OR IGNORE INTO library (id,revision,doc) VALUES (1,0,?)").run(JSON.stringify(fresh)).changes > 0) this.writes++;
    return db;
  }

  private readStarters(): void {
    if (!this.startersFile) return;
    let at = -1;
    try {
      at = statSync(this.startersFile).mtimeMs;
    } catch {
      at = -1;
    }
    if (at === this.startersAt) return;
    this.startersAt = at;
    try {
      const read = JSON.parse(readFileSync(this.startersFile, "utf8")) as Starters;
      const ids = new Set(read.clips.map((c) => c.id));
      // A channel keeps the clips the file holds; one left with none is left out.
      const channels = (read.channels ?? [])
        .map((c) => ({ name: c.name, items: c.items.filter((id) => ids.has(id)), shuffle: c.shuffle === true, ...(c.type ? { type: c.type } : {}), ...(c.still ? { still: c.still } : {}) }))
        .filter((c) => c.items.length > 0);
      this.starters = { clips: read.clips.map((c) => ({ ...c, starter: true })), channels };
    } catch {
      this.starters = { clips: [], channels: [] };
    }
  }

  /** Changes when the starters or the database may have changed. */
  stamp(): string {
    this.readStarters();
    if (this.path === ":memory:") return `m${this.writes}:${this.startersAt}`;
    try {
      const s = statSync(this.path);
      return `${s.mtimeMs}:${s.size}:${this.startersAt}`;
    } catch {
      return `none:${this.startersAt}`;
    }
  }

  /** Whether a doc wants the curated Strip or a type's starter channels it has not taken yet. */
  private wantsUpgrade(doc: LibraryDoc): boolean {
    const strip = this.starters.channels.find((c) => c.name === STRIP);
    if (!doc.curatedStrip && strip?.items.some((id) => id !== FORMER_STRIP_CLIP)) return true;
    const seeded = doc.seeded ?? OLD_SEEDED;
    return starterTypes(this.starters).some((t) => !seeded.includes(t));
  }

  /** Brings an older doc up to the starters once, taking the same write lock as an admin edit. */
  private upgrade(db: Database): { revision: number; doc: LibraryDoc } {
    return db.transaction(() => {
      const row = db.query(SELECT_LIBRARY).get() as LibraryRow;
      const doc = JSON.parse(row.doc) as LibraryDoc;
      if (!this.wantsUpgrade(doc)) return { revision: row.revision, doc };
      const strip = this.starters.channels.find((c) => c.name === STRIP);
      if (!doc.curatedStrip && strip?.items.some((id) => id !== FORMER_STRIP_CLIP)) {
        const i = doc.channels.findIndex((c) => c.name === STRIP && !c.shuffle && c.items.length === 1 && c.items[0] === FORMER_STRIP_CLIP);
        if (i >= 0 && !doc.hidden.includes(FORMER_STRIP_CLIP)) {
          doc.channels[i] = { ...doc.channels[i]!, items: [...strip.items], shuffle: strip.shuffle === true };
        }
        doc.curatedStrip = true;
      }
      seedTypes(doc, this.starters, this.now());
      const revision = row.revision + 1;
      db.query("UPDATE library SET revision=?, doc=? WHERE id=1").run(revision, JSON.stringify(doc));
      this.writes++;
      return { revision, doc };
    }).immediate();
  }

  /** The library now, read again only when its revision or the starters changed. */
  view(): LibraryView {
    const db = this.open();
    this.readStarters();
    const row = db.query(SELECT_LIBRARY).get() as LibraryRow;
    if (this.cached && this.cached.revision === row.revision && this.cached.starters === this.starters.clips) return this.cached;
    let revision = row.revision, doc = JSON.parse(row.doc) as LibraryDoc;
    if (this.wantsUpgrade(doc)) ({ revision, doc } = this.upgrade(db));
    const kept = new Map(doc.screens.map((s) => [s.screen, s]));
    // A type the doc was written before has its screen as a new library's: on its first channel, if it has one.
    const screens = new Map(SCREENS.map((s) => [s, kept.get(s) ?? defaultScreen(s, doc.channels.find((c) => channelType(c) === s)?.name)]));
    doc.screens = [...screens.values()];
    const all = new Map<string, Clip>(), types = doc.types ?? {};
    for (const c of [...this.starters.clips, ...doc.clips]) if (!all.has(c.id)) all.set(c.id, c.starter && types[c.id] ? { ...c, types: types[c.id] } : c);
    const hidden = new Set(doc.hidden);
    const manifest = [...all.values()].filter((c) => !(c.starter && hidden.has(c.id)));
    const manifestId = this.writeManifest(manifest, doc.channels);
    this.cached = {
      revision, doc, starters: this.starters.clips, all, manifest, manifestId,
      channels: new Map(doc.channels.map((c) => [c.name, c])),
      screens,
      timed: new Map(manifest.map((c) => [c.id, isImage(c) ? { id: c.id, seconds: 0, image: true } : { id: c.id, seconds: c.seconds }])),
    };
    return this.cached;
  }

  /** Writes the manifest, its items and channels, as media/video.<id>.json unless it is there, and returns its id. */
  private writeManifest(clips: readonly Clip[], channels: readonly Channel[]): string {
    const json = JSON.stringify({ clips, channels });
    const id = sha16(json), file = join(this.media, `video.${id}.json`);
    if (!existsSync(file)) {
      const part = join(this.tmp, `video.${id}.${process.pid}.json`);
      writeFileSync(part, json);
      renameSync(part, file);
    }
    return id;
  }

  /**
   * Changes the doc if `revision` is still the library's: `change` edits it in place, or says why not. A null revision
   * takes whatever the library holds, for a change no page could have seen to conflict.
   */
  edit(revision: number | null, change: (doc: LibraryDoc, view: LibraryView) => Refusal | null): LibraryView | Refusal {
    for (let tries = 0; tries < 8; tries++) {
      const view = this.view();
      if (revision !== null && revision !== view.revision) return { status: 409, error: "The library changed in another page. Reload to see it." };
      const doc = structuredClone(view.doc);
      const no = change(doc, view);
      if (no) return no;
      const done = this.open().query("UPDATE library SET revision=?, doc=? WHERE id=1 AND revision=?").run(view.revision + 1, JSON.stringify(doc), view.revision);
      if (done.changes === 1) {
        this.writes++;
        return this.view();
      }
      if (revision !== null) return { status: 409, error: "Another page saved first. Reload to see its change." };
    }
    return { status: 503, error: "The library is busy. Try again." };
  }

  addPending(p: Pending): void {
    this.open().query("INSERT OR REPLACE INTO pending (id,info,at) VALUES (?,?,?)").run(p.id, JSON.stringify(p), p.at);
    this.writes++;
  }

  pending(id: string): Pending | null {
    const row = this.open().query("SELECT info FROM pending WHERE id=?").get(id) as { info: string } | null;
    return row ? (JSON.parse(row.info) as Pending) : null;
  }

  allPending(): Pending[] {
    return (this.open().query("SELECT info FROM pending ORDER BY at").all() as { info: string }[]).map((r) => JSON.parse(r.info) as Pending);
  }

  dropPending(id: string): void {
    this.open().query("DELETE FROM pending WHERE id=?").run(id);
    this.writes++;
  }

  /** A media file's place on disk from its served path, or "" for a path that is not one of ours. */
  fileOf(served: string): string {
    const name = /^\/media\/([a-z0-9-]+\.[0-9a-f]{16}\.(?:mp4|jpg|png|webp))$/.exec(served)?.[1];
    return name ? join(this.media, name) : "";
  }

  /** Removes uploads never published, and manifests no world has sent for an hour. */
  sweep(): void {
    const now = this.now();
    const view = this.view();
    for (const p of this.allPending()) {
      if (now - p.at < PENDING_MS) continue;
      this.dropPending(p.id);
      const file = this.fileOf(p.file);
      if (file && !view.all.has(p.id)) rmSync(file, { force: true });
    }
    // Each world touches its own manifest as it sweeps, so one no world sends goes stale and goes.
    const current = `video.${view.manifestId}.json`;
    for (const name of readdirSync(this.media)) {
      if (!/^video\.[0-9a-f]{16}\.json$/.test(name)) continue;
      const file = join(this.media, name);
      try {
        if (name === current) utimesSync(file, now / 1000, now / 1000);
        else if (now - statSync(file).mtimeMs >= MANIFEST_KEEP_MS) rmSync(file, { force: true });
      } catch {
        // Another world swept it first.
      }
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
    if (this.temp) rmSync(this.temp, { recursive: true, force: true });
  }
}
