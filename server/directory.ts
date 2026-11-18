import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { readEntryJson } from "./survivor-access.ts";

interface Row {
  address: string;
  name: string;
  map: string;
  listed: number;
  password: number;
  players: number;
  max: number;
  seen: number;
  owner: string;
}
const secret = () => randomBytes(24).toString("hex");
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const respond = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    },
  });
function endpoint(raw: unknown) {
  const u = new URL(String(raw));
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(u.hostname) ||
    u.href.length > 512
  )
    throw Error("Use your server’s public domain and world path.");
  u.pathname = u.pathname.replace(/\/?$/, "/");
  return u;
}
const publicListing = (u: URL) => u.protocol === "https:" && !u.port;
/** Independent directory. DNS proves control of the world hostname. Management credentials never appear in search. */
export class ServerDirectory {
  private catalog: Database | null = null;
  private challenges = new Map<string, { address: string; txt: string; until: number; requester: string }>();
  private readonly file: string;
  private readonly lookup: typeof resolveTxt;
  constructor(file: string, lookup = resolveTxt) {
    this.file = file;
    this.lookup = lookup;
  }
  close() {
    this.catalog?.close();
  }
  private store() {
    if (!this.catalog) {
      this.catalog = new Database(this.file, { create: true });
      this.catalog.exec(
        "CREATE TABLE IF NOT EXISTS listings (address TEXT PRIMARY KEY, name TEXT, map TEXT, listed INTEGER, password INTEGER, players INTEGER, max INTEGER, seen INTEGER, owner TEXT)",
      );
    }
    return this.catalog;
  }
  async answer(req: Request, requester: string): Promise<Response> {
    try {
      if (req.method === "OPTIONS") return respond({});
      const db = this.store(),
        now = Date.now();
      if (req.method === "GET") {
        const rows = db
          .query("SELECT name,map,address,password,players,max,seen FROM listings WHERE listed=1 ORDER BY name,address")
          .all() as Row[];
        return respond(rows.filter((r) => publicListing(new URL(r.address))).map((r) => ({ ...r, mapId: "", password: !!r.password, online: r.seen > now - 180000 })));
      }
      if (req.method !== "POST") return respond({ error: "Use GET or POST." }, 405);
      const d = await readEntryJson(req),
        u = endpoint(d.address),
        address = u.href;
      if ((d.action === "claim" || d.action === "verify" || (d.action === "update" && d.listed)) && !publicListing(u))
        return respond({ error: "Public listings need an HTTPS domain on the standard port (443)." }, 400);
      if (d.action === "claim") {
        let pending = 0;
        for (const [k, v] of this.challenges) {
          if (v.until <= now) this.challenges.delete(k);
          else if (v.requester === requester) pending++;
        }
        if (pending >= 8) return respond({ error: "Finish a pending DNS verification or try again in an hour." }, 429);
        if (this.challenges.size >= 1024) return respond({ error: "Directory busy. Try again later." }, 429);
        const ticket = secret(),
          txt = "snark=" + secret();
        this.challenges.set(digest(ticket), { address, txt, requester, until: now + 3600000 });
        return respond({ ticket, txt, record: "_snark." + u.hostname });
      }
      if (d.action === "verify") {
        const id = digest(String(d.ticket)),
          c = this.challenges.get(id);
        if (!c || c.until < now || c.address !== address) return respond({ error: "Request a fresh verification." }, 403);
        const records = await this.lookup("_snark." + u.hostname).catch(() => [] as string[][]);
        if (!records.some((r) => r.join("") === c.txt))
          return respond({ error: "The DNS record is not visible yet. Check the record and try again." }, 409);
        if (!this.challenges.delete(id)) return respond({ error: "Verification already used." }, 409);
        const token = secret();
        db.query("INSERT INTO listings VALUES (?,?,?,0,0,0,0,0,?) ON CONFLICT(address) DO UPDATE SET owner=excluded.owner").run(
          address,
          u.hostname,
          "",
          digest(token),
        );
        return respond({ token });
      }
      const row = db.query("SELECT * FROM listings WHERE address=?").get(address) as Row | null;
      if (!row || typeof d.token !== "string" || row.owner !== digest(d.token))
        return respond({ error: "Management token did not match." }, 403);
      if (d.action === "manage")
        return respond({ name: row.name, map: row.map, listed: !!row.listed, password: !!row.password, address: row.address });
      if (d.action === "update") {
        const name = String(d.name ?? "").trim(),
          map = String(d.map ?? "").trim();
        if (!name || !map || name.length > 80 || map.length > 80)
          return respond({ error: "Enter a server name and map of up to 80 characters." }, 400);
        db.query("UPDATE listings SET name=?,map=?,listed=?,password=? WHERE address=?").run(
          name,
          map,
          Number(d.listed === true),
          Number(d.password === true),
          address,
        );
      } else if (d.action === "heartbeat") {
        if (
          !Number.isInteger(d.players) ||
          !Number.isInteger(d.max) ||
          Number(d.players) < 0 ||
          Number(d.max) < 1 ||
          Number(d.players) > Number(d.max)
        )
          return respond({ error: "Invalid player counts." }, 400);
        db.query("UPDATE listings SET players=?,max=?,seen=? WHERE address=?").run(Number(d.players), Number(d.max), now, address);
      } else if (d.action === "remove") db.query("DELETE FROM listings WHERE address=?").run(address);
      else return respond({ error: "Unknown directory action." }, 400);
      return respond({ ok: true });
    } catch (e) {
      return respond({ error: e instanceof Error ? e.message : "Invalid directory request." }, 400);
    }
  }
}
