import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { OPENING_SHOT, validShot, type TitleShot } from "../../shared/title-scene.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";

interface Catalog {
  revision: number;
  active: string;
  published: TitleShot;
  shots: TitleShot[];
}
const initial = (): Catalog => ({ revision: 0, active: OPENING_SHOT.id, published: OPENING_SHOT, shots: [OPENING_SHOT] });

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
  constructor(path: string) {
    this.path = path;
  }
  private open(): Database {
    if (!this.db) {
      const db = new Database(this.path, { create: true });
      db.exec(
        "PRAGMA busy_timeout=2500; CREATE TABLE IF NOT EXISTS title (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, catalog TEXT NOT NULL, poster BLOB, portrait BLOB)",
      );
      db.query("INSERT OR IGNORE INTO title (id,revision,catalog) VALUES (1,0,?)").run(JSON.stringify(initial()));
      this.db = db;
    }
    return this.db;
  }
  private catalog(): Catalog {
    if (!this.db && (this.path === ":memory:" || !existsSync(this.path))) return initial();
    const row = this.open().query("SELECT catalog FROM title WHERE id=1").get() as { catalog: string };
    return JSON.parse(row.catalog);
  }
  active(): Response {
    const c = this.catalog();
    return entryReply(c.published);
  }
  poster(portrait: boolean): Response {
    if (this.db || (this.path !== ":memory:" && existsSync(this.path))) {
      const row = this.open()
        .query(portrait ? "SELECT portrait AS poster FROM title WHERE id=1" : "SELECT poster FROM title WHERE id=1")
        .get() as { poster: Uint8Array | null };
      if (row.poster)
        return new Response(new Uint8Array(row.poster), {
          headers: {
            "content-type": row.poster[0] === 255 ? "image/jpeg" : "image/webp",
            "cache-control": "no-cache",
            "x-content-type-options": "nosniff",
          },
        });
    }
    return new Response(null, {
      status: 307,
      headers: { location: portrait ? "/title/red-tide-portrait.webp" : "/title/red-tide.webp", "cache-control": "no-store" },
    });
  }
  async admin(req: Request): Promise<Response> {
    if (req.method === "GET") return entryReply(this.catalog());
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
    let body;
    try {
      body = await readEntryJson(req, 490 * 1024);
    } catch {
      return entryReply({ error: "Expected a small JSON shot." }, 400);
    }
    const c = this.catalog(),
      input = body.shot;
    if (!validShot(input) || typeof body.publish !== "boolean" || !Number.isSafeInteger(body.revision))
      return entryReply({ error: "Check the camera fields and shot name." }, 400);
    const shot: TitleShot = { id: input.id, name: input.name.trim(), set: input.set, camera: { ...OPENING_SHOT.camera } };
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
    const result = this.open()
      .query("UPDATE title SET revision=?,catalog=?,poster=coalesce(?,poster),portrait=coalesce(?,portrait) WHERE id=1 AND revision=?")
      .run(c.revision, JSON.stringify(c), poster, portrait, revision);
    return result.changes === 1 ? entryReply(c) : entryReply({ error: "Another editor saved first. Reload to see their work." }, 409);
  }
  close() {
    this.db?.close();
  }
}
