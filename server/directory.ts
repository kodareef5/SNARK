import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readEntryJson } from "./survivor-access.ts";
import { listing, tagsOf, type Listed } from "../shared/listing.ts";
export { plain } from "../shared/listing.ts";

// A server directory, as ARK's server list is one: worlds announce themselves, players search (D872). A world hosts one
// only when its operator starts it with --directory. What a listing says the directory reads from the world itself, at
// its public address, so an announcement carries nothing but that address: no one can list a name, a map or a count the
// world does not give, nor list a world that does not ask to be (its entry-world.json says `listed`).

/** What search gives for a world: what it says of itself (shared/listing.ts), its public HTTPS address on port 443, and when it last announced. */
export interface Listing extends Listed {
  address: string;
  seen: number;
}
/** Reads what a world at an address says of itself, or null if nothing there is a world that asks to be listed. */
export type ReadWorld = (address: string) => Promise<Listed | null>;
type Row = Omit<Listing, "password" | "pve" | "tags"> & { password: number; pve: number; tags: string; hidden: number };
const fromRow = ({ hidden: _, ...r }: Row): Listing => ({ ...r, password: !!r.password, pve: !!r.pve, tags: tagsOf(JSON.parse(r.tags || "{}")) });

/** A world announces every minute; a world unheard for this long is offline, and after a week it is gone. */
export const ONLINE_MS = 180_000;
const KEPT_MS = 7 * 86_400_000;
/** One read of a world per this, however often it or anyone else announces it. */
const REREAD_MS = 30_000;
const MOST_LISTINGS = 4096;
const MOST_READING = 16;
/** Announcements from one requester in a minute. */
const MOST_ASKED = 30;

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

/** A world's address as a directory takes it: HTTPS on the standard port, a domain name, a path ending in a slash, nothing else. */
export function listingAddress(raw: unknown): URL {
  const u = new URL(String(raw));
  if (u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(u.hostname) || u.href.length > 512)
    throw Error("A listed world needs its public HTTPS address on the standard port (443), by domain name.");
  u.pathname = u.pathname.replace(/\/?$/, "/");
  return u;
}

/** An address no directory reads from: this machine, a private network, link-local, multicast or unspecified. */
export function privateAddress(ip: string): boolean {
  const v4 = isIP(ip) === 4 ? ip : /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (v4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
  }
  const s = ip.toLowerCase();
  return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || isIP(s) !== 6;
}

/** Reads a world's entry-world.json over HTTPS: no redirect followed, nothing on a private address, at most 64 KB, five seconds. */
export const readWorld: ReadWorld = async (address) => {
  const u = new URL("entry-world.json", address);
  const ips = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!ips.length || ips.some((ip) => privateAddress(ip.address))) return null;
  const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } }).catch(() => null);
  if (!res || res.status !== 200 || !res.body || Number(res.headers.get("content-length") ?? 0) > 65536) return null;
  // Counted as it comes, so a world that never stops sending is cut off.
  const reader = res.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  let w: Record<string, unknown>;
  try {
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      if ((size += r.value.length) > 65536) return (void reader.cancel().catch(() => {}), null);
      parts.push(r.value);
    }
    w = JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    return null;
  }
  return w && typeof w === "object" && w.listed === true ? listing(w) : null;
};

export class ServerDirectory {
  private catalog: Database | null = null;
  private readonly reading = new Set<string>();
  private readonly read = new Map<string, number>();
  private readonly asked = new Map<string, { since: number; count: number }>();
  private readonly file: string;
  private readonly readFrom: ReadWorld;
  constructor(file: string, readFrom: ReadWorld = readWorld) {
    this.file = file;
    this.readFrom = readFrom;
  }
  close() {
    this.catalog?.close();
  }
  private store() {
    if (!this.catalog) {
      this.catalog = new Database(this.file, { create: true });
      this.catalog.exec(
        "CREATE TABLE IF NOT EXISTS worlds (address TEXT PRIMARY KEY, name TEXT, map TEXT, password INTEGER, players INTEGER, max INTEGER, seen INTEGER, hidden INTEGER NOT NULL DEFAULT 0, pve INTEGER NOT NULL DEFAULT 0, about TEXT NOT NULL DEFAULT '', discord TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '{}')",
      );
    }
    return this.catalog;
  }
  /** The store if it is there: a read never makes one. */
  private existing() {
    return this.catalog || this.file === ":memory:" || existsSync(this.file) ? this.store() : null;
  }
  /** Every world, hidden ones too, for `bun server/directory.ts`. */
  worlds() {
    return ((this.existing()?.query("SELECT * FROM worlds ORDER BY address").all() ?? []) as Row[]).map((r) => ({ ...fromRow(r), hidden: !!r.hidden }));
  }
  /** Keep a world out of search, however often it announces, or let it back; false if the directory has never heard of it. */
  hide(address: string, yes = true) {
    return (this.existing()?.query("UPDATE worlds SET hidden=? WHERE address=?").run(Number(yes), address).changes ?? 0) > 0;
  }
  /** Forget a world until it next announces. */
  remove(address: string) {
    return (this.existing()?.query("DELETE FROM worlds WHERE address=? AND hidden=0").run(address).changes ?? 0) > 0;
  }
  /** Search: every world heard from in the last week and not hidden, with whether it is online. */
  search(now = Date.now()) {
    const rows = (this.existing()?.query("SELECT * FROM worlds WHERE hidden=0 AND seen>? ORDER BY name,address").all(now - KEPT_MS) ?? []) as Row[];
    return rows.map((r) => ({ ...fromRow(r), mapId: "", online: r.seen > now - ONLINE_MS }));
  }
  /** A world at `raw` asks to be listed: read it, and list what it says. */
  async announce(raw: unknown, requester: string, now = Date.now()): Promise<{ status: number; error?: string; listed?: boolean }> {
    const address = listingAddress(raw).href;
    const mine = this.asked.get(requester);
    if (!mine || mine.since < now - 60_000) {
      if (this.asked.size >= 4096) this.asked.clear();
      this.asked.set(requester, { since: now, count: 1 });
    } else if (++mine.count > MOST_ASKED) return { status: 429, error: "Too many announcements. Announce once a minute." };
    // A world read lately is not read again; one being read is not read twice.
    if ((this.read.get(address) ?? -Infinity) > now - REREAD_MS || this.reading.has(address)) return { status: 202 };
    if (this.reading.size >= MOST_READING) return { status: 429, error: "Directory busy. Try again in a minute." };
    const db = this.existing();
    const known = db?.query("SELECT 1 FROM worlds WHERE address=?").get(address);
    if (db && !known && (db.query("SELECT count(*) AS n FROM worlds").get() as { n: number }).n >= MOST_LISTINGS) {
      db.query("DELETE FROM worlds WHERE seen<? AND hidden=0").run(now - KEPT_MS);
      if ((db.query("SELECT count(*) AS n FROM worlds").get() as { n: number }).n >= MOST_LISTINGS) return { status: 507, error: "Directory full." };
    }
    if (this.read.size >= 4096) for (const [a, at] of this.read) if (at <= now - REREAD_MS) this.read.delete(a);
    this.reading.add(address);
    this.read.set(address, now);
    try {
      const w = await this.readFrom(address).catch(() => null);
      if (!w) return { status: 422, error: "No world that asks to be listed answers at that address." };
      this.store().query(
        "INSERT INTO worlds (address,name,map,password,players,max,seen,pve,about,discord,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET name=excluded.name,map=excluded.map,password=excluded.password,players=excluded.players,max=excluded.max,seen=excluded.seen,pve=excluded.pve,about=excluded.about,discord=excluded.discord,tags=excluded.tags",
      ).run(address, w.name, w.map, Number(w.password), w.players, w.max, now, Number(w.pve), w.about, w.discord, JSON.stringify(w.tags));
      return { status: 200, listed: true };
    } finally {
      this.reading.delete(address);
    }
  }
  async answer(req: Request, requester: string): Promise<Response> {
    try {
      if (req.method === "OPTIONS") return respond({});
      if (req.method === "GET") return respond(this.search());
      if (req.method !== "POST") return respond({ error: "Use GET or POST." }, 405);
      const d = await readEntryJson(req);
      if (d.action !== "announce") return respond({ error: "Unknown directory action." }, 400);
      const { status, ...rest } = await this.announce(d.address, requester);
      return respond(status < 300 ? { ok: true, ...rest } : rest, status);
    } catch (e) {
      return respond({ error: e instanceof Error ? e.message : "Invalid directory request." }, 400);
    }
  }
}

// The operator's say: bun server/directory.ts <directory file> [hide|show|remove <address>]
if (import.meta.main) {
  const [file, verb, address] = process.argv.slice(2);
  const stop = (why: string) => (console.error(why), process.exit(1));
  if (!file || !existsSync(file)) stop("Name a directory file: <save>.directory.sqlite, or directory.sqlite in a cluster's folder.");
  const directory = new ServerDirectory(file!);
  if (!verb) {
    const rows = directory.worlds();
    if (!rows.length) console.log("No worlds.");
    const now = Date.now();
    for (const r of rows)
      console.log(`${r.hidden ? "hidden" : r.seen > now - ONLINE_MS ? "online" : "away  "}  ${r.address}  ${JSON.stringify(r.name)}  ${JSON.stringify(r.map)}  ${r.players}/${r.max}`);
  } else {
    const act = new Map([
      ["hide", (a: string) => directory.hide(a)],
      ["show", (a: string) => directory.hide(a, false)],
      ["remove", (a: string) => directory.remove(a)],
    ]).get(verb);
    if (!act || !address) stop("Use hide, show or remove, and a world's address as the list shows it.");
    console.log(act!(address!) ? `${verb}: ${address}` : `no world at ${address}${verb === "remove" ? " that is not hidden" : ""}`);
  }
  directory.close();
}
