import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initialShots, loaderScene, type EditableSceneCategory, type ShotCatalog, type WikiSceneCatalog } from "../../shared/player-scenes.ts";
import { OPENING_SHOT, validShot, type TitleShot } from "../../shared/title-scene.ts";
import type { Acts } from "../acts.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { actorOf } from "./gate.ts";

const rowOf = (category: EditableSceneCategory): number => category === "title" ? 1 : 2;

function readPoster(data: unknown): Buffer | null {
  if (typeof data !== "string") return null;
  const prefix = /^data:image\/(webp|jpeg);base64,/.exec(data);
  if (!prefix) return null;
  const bytes = Buffer.from(data.slice(prefix[0].length), "base64");
  if (bytes.length < 20 || bytes.length > 176 * 1024) return null;
  if (prefix[1] === "jpeg") return bytes.readUInt16BE(0) === 0xffd8 && bytes.readUInt16BE(bytes.length - 2) === 0xffd9 ? bytes : null;
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length
    ? bytes
    : null;
}

/** One small compare-and-swap document shared by every world of this cluster. Reads on a fresh installation are free of writes. */
export class TitleScenes {
  private db: Database | null = null;
  private readonly path: string;
  private readonly clientDir?: string;
  constructor(path: string, clientDir?: string) {
    this.path = path;
    this.clientDir = clientDir;
  }
  private open(): Database {
    if (!this.db) {
      const db = new Database(this.path, { create: true });
      db.exec(
        "PRAGMA busy_timeout=2500; CREATE TABLE IF NOT EXISTS title (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, catalog TEXT NOT NULL, poster BLOB, portrait BLOB)",
      );
      this.db = db;
    }
    return this.db;
  }
  private onDisk(): boolean {
    return !!this.db || (this.path !== ":memory:" && existsSync(this.path));
  }
  private catalog(category: EditableSceneCategory): ShotCatalog {
    if (!this.onDisk()) return initialShots(category);
    const row = this.open().query("SELECT catalog FROM title WHERE id=?").get(rowOf(category)) as { catalog: string } | null;
    const defaults = initialShots(category);
    if (!row) return defaults;
    const stored = JSON.parse(row.catalog) as ShotCatalog;
    const present = new Set(stored.shots.map(({ id }) => id));
    stored.shots.push(...defaults.shots.filter(({ id }) => !present.has(id)));
    return stored;
  }
  active(): Response {
    return entryReply(this.catalog("title").published);
  }
  loader(): Response {
    return entryReply(loaderScene(this.catalog("loaders").published));
  }
  poster(portrait: boolean): Response {
    return this.picture("title", portrait, portrait ? "red-tide-portrait.webp" : "red-tide.webp");
  }
  loaderPoster(portrait: boolean): Response {
    const built = portrait ? "loader-wynwood-portrait.webp" : "loader-wynwood.webp";
    const fallback = this.clientDir && !existsSync(join(this.clientDir, "title", built)) ? "miami-flight.webp" : built;
    return this.picture("loaders", portrait, fallback);
  }
  private picture(category: EditableSceneCategory, portrait: boolean, fallback: string): Response {
    if (this.onDisk()) {
      const row = this.open()
        .query(portrait ? "SELECT portrait AS poster FROM title WHERE id=?" : "SELECT poster FROM title WHERE id=?")
        .get(rowOf(category)) as { poster: Uint8Array | null } | null;
      if (row?.poster)
        return new Response(new Uint8Array(row.poster), {
          headers: {
            "content-type": row.poster[0] === 255 ? "image/jpeg" : "image/webp",
            "cache-control": "no-cache",
            "x-content-type-options": "nosniff",
          },
        });
    }
    return new Response(null, { status: 307, headers: { location: `/title/${fallback}`, "cache-control": "no-store" } });
  }
  private built<T>(name: string, fallback: T): T {
    if (!this.clientDir) return fallback;
    try {
      return JSON.parse(readFileSync(join(this.clientDir, name), "utf8")) as T;
    } catch {
      return fallback;
    }
  }
  private wiki(): WikiSceneCatalog {
    return { recipes: this.built("scene-catalog.json", []), media: this.built("wiki/scene-media.json", {}) };
  }
  /** The studio's API. A save is written in `acts` as the request's actor's. */
  async admin(req: Request, acts?: Pick<Acts, "write">): Promise<Response> {
    const category = new URL(req.url).searchParams.get("category") ?? "title";
    if (category === "wiki") {
      return req.method === "GET" ? entryReply(this.wiki()) : new Response(null, { status: 405, headers: { Allow: "GET" } });
    }
    if (category !== "title" && category !== "loaders") return entryReply({ error: "Unknown scene category." }, 400);
    if (req.method === "GET") return entryReply(this.catalog(category));
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
    let body;
    try {
      body = await readEntryJson(req, 490 * 1024);
    } catch {
      return entryReply({ error: "Expected a small JSON shot." }, 400);
    }
    if (body.category !== undefined && body.category !== category) return entryReply({ error: "The shot belongs to another category." }, 400);
    const c = this.catalog(category),
      input = body.shot;
    if (!validShot(input) || typeof body.publish !== "boolean" || !Number.isSafeInteger(body.revision))
      return entryReply({ error: "Check the camera fields and shot name." }, 400);
    const shot: TitleShot = {
      id: input.id, name: input.name.trim(), set: input.set, camera: { ...OPENING_SHOT.camera },
      ...(input.subject ? { subject: input.subject } : {}),
    };
    for (const field of Object.keys(shot.camera) as (keyof TitleShot["camera"])[]) shot.camera[field] = input.camera[field];
    const poster = body.publish ? readPoster(body.picture) : null,
      portrait = body.publish ? readPoster(body.portrait) : null;
    if (body.publish && (!poster || !portrait)) return entryReply({ error: "Publish with a live preview in both frames." }, 400);
    if (body.revision !== c.revision) return entryReply({ error: "The shots changed in another editor. Reload to see them." }, 409);
    const at = c.shots.findIndex((s) => s.id === shot.id);
    if (at < 0 && c.shots.length >= 32) return entryReply({ error: "All 32 shot slots are in use." }, 409);
    if (at < 0) c.shots.push(shot);
    else c.shots[at] = shot;
    if (body.publish) {
      c.active = shot.id;
      c.published = shot;
    }
    const revision = c.revision++;
    const db = this.open(), row = rowOf(category);
    db.query("INSERT OR IGNORE INTO title (id,revision,catalog) VALUES (?,0,?)").run(row, JSON.stringify(initialShots(category)));
    const result = db.query("UPDATE title SET revision=?,catalog=?,poster=coalesce(?,poster),portrait=coalesce(?,portrait) WHERE id=? AND revision=?")
      .run(c.revision, JSON.stringify(c), poster, portrait, row, revision);
    if (result.changes !== 1) return entryReply({ error: "Another editor saved first. Reload to see their work." }, 409);
    const named = `the shot "${shot.name.replace(/\s+/g, " ")}" for ${category === "title" ? "the title screen" : "the loading screen"}`;
    acts?.write(actorOf(req), body.publish ? `published ${named}` : `saved ${named} as a draft`);
    return entryReply(c);
  }
  close() {
    this.db?.close();
  }
}
