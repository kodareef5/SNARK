import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { KEY_BYTES } from "../shared/net/protocol.ts";
import { hashKey, type EntityRecord } from "./records.ts";
import type { Host } from "./host.ts";

// Extension components go through the normal save, cluster parcel and restore paths.
export const CREATE_REQUEST = 82;
const LINKED_KEYS = 80,
  RECOVERY = 81;
export function addBrowserHash(rec: EntityRecord, h: Uint8Array) {
  const old = rec.extra.get(LINKED_KEYS) ?? new Uint8Array(0);
  for (let i = 0; i + h.length <= old.length; i += h.length) if (equal(old.subarray(i, i + h.length), h)) return;
  const present = old.slice(-7 * h.length),
    next = new Uint8Array(present.length + h.length);
  next.set(present);
  next.set(h, present.length);
  rec.extra.set(LINKED_KEYS, next);
}
const bytes = (s: unknown): Uint8Array | null =>
  typeof s === "string" && new RegExp("^[0-9a-f]{" + KEY_BYTES * 2 + "}$", "i").test(s) ? Uint8Array.from(Buffer.from(s, "hex")) : null;
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && timingSafeEqual(a, b);
export function ownsSurvivor(rec: EntityRecord, key: Uint8Array): boolean {
  if (!rec.keyHash) return false;
  return hasBrowserHash(rec, hashKey(key));
}
export function hasBrowserHash(rec: EntityRecord, h: Uint8Array): boolean {
  if (!rec.keyHash) return false;
  if (equal(rec.keyHash, h)) return true;
  const slots = rec.extra.get(LINKED_KEYS);
  for (let i = 0; slots && i + h.length <= slots.length; i += h.length) if (equal(slots.subarray(i, i + h.length), h)) return true;
  return false;
}

/** Small browser requests only. Count actual bytes even when there is no Content-Length. */
export async function readEntryJson(req: Request, limit = 4096): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw Error("Expected JSON");
  const reader = req.body?.getReader();
  if (!reader) throw Error("Empty request");
  let size = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw Error("Request too large");
    }
    parts.push(value);
  }
  const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("Expected an object");
  return data;
}
export const entryReply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

interface Pair {
  key: Uint8Array;
  until: number;
  pid: number;
  name: string;
}
export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export class SurvivorAccess {
  private pairs = new Map<string, Pair>();
  private attempts = new Map<string, { time: number; n: number }>();
  private readonly host: Host;
  constructor(host: Host) {
    this.host = host;
  }

  private known(name: string): EntityRecord | undefined {
    return this.host.survivorRecord(name) ?? undefined;
  }
  private describe(rec: EntityRecord) {
    return {
      id: rec.pid,
      name: rec.name,
      xp: rec.xp,
      ...this.host.activity.summary(rec),
      level: this.host.progression.levelOf(rec.xp),
      dead: rec.dead,
      x: rec.x,
      z: rec.z,
      look: rec.look ? Array.from(rec.look) : null,
    };
  }
  private grant(rec: EntityRecord, key: Uint8Array): void {
    if (ownsSurvivor(rec, key)) return;
    addBrowserHash(rec, hashKey(key));
    this.host.records.dirty.add(rec.pid);
  }
  async answer(req: Request, address: string): Promise<Response> {
    if (req.method !== "POST") return entryReply({ error: "Use POST" }, 405);
    let data: Record<string, unknown>;
    try {
      data = await readEntryJson(req);
    } catch {
      return entryReply({ error: "Invalid request" }, 400);
    }
    const key = bytes(data.key);
    if (!key) return entryReply({ error: "Browser identity unavailable" }, 400);
    const now = Date.now();
    for (const [code, p] of this.pairs) if (p.until <= now) this.pairs.delete(code);
    for (const [ip, a] of this.attempts) if (a.time <= now) this.attempts.delete(ip);
    const name = typeof data.name === "string" ? data.name : "";
    const rec = this.known(name);
    const summary = (r: EntityRecord) => this.describe(r);
    const code = typeof data.code === "string" ? data.code.toUpperCase().replace(/[ -]/g, "") : "";
    if (data.action === "cancel") {
      const pending = this.pairs.get(code);
      if (pending && !pending.pid && equal(pending.key, key)) this.pairs.delete(code);
      return entryReply({ ok: true });
    }
    if (data.action === "poll") {
      const pair = this.pairs.get(code);
      if (!pair || !equal(pair.key, key)) return entryReply({ error: "This code expired. Request a new one." }, 410);
      const approved = pair.pid && this.known(pair.name);
      return entryReply({ survivor: approved && approved.pid === pair.pid && ownsSurvivor(approved, key) ? summary(approved) : null });
    }
    const attempts = this.attempts.get(address) ?? { time: now + 60000, n: 0 };
    if ((!this.attempts.has(address) && this.attempts.size >= 4096) || ++attempts.n > 30)
      return entryReply({ error: "Try again in a minute" }, 429);
    this.attempts.set(address, attempts);
    if (data.action === "roster") {
      const list = [];
      const hash = hashKey(key);
      for (const pid of this.host.survivorIds()) {
        const r = this.host.records.byPid.get(pid);
        if (r && hasBrowserHash(r, hash)) list.push(summary(r));
      }
      return entryReply({ survivors: list });
    }
    if (data.action === "available")
      return entryReply({
        available:
          /^[A-Za-z0-9 _-]{1,24}$/.test(name) && name.trim() !== "" && !rec && !this.host.game.sessions.nameAway?.(name) && !this.host.game.clients.some((c) => c?.active && c.name === name),
      });
    if (data.action === "pair") {
      if (this.pairs.size >= 2048) return entryReply({ error: "Try again shortly" }, 429);
      let id: string;
      do {
        id = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
      } while (this.pairs.has(id));
      this.pairs.set(id, { key, until: now + 300000, pid: 0, name: "" });
      return entryReply({ code: id, expiresIn: 300 });
    }
    if (data.action === "recover") {
      const secret = bytes(code.toLowerCase()),
        proof = rec?.extra.get(RECOVERY);
      if (!rec || !secret || !proof || !equal(hashKey(secret), proof)) return entryReply({ error: "Name or recovery code did not match" }, 403);
      this.grant(rec, key);
      rec.extra.delete(RECOVERY);
      this.host.records.dirty.add(rec.pid);
      return entryReply({ survivor: summary(rec) });
    }
    if (!rec || !ownsSurvivor(rec, key)) return entryReply({ error: "Select a survivor owned by this browser" }, 403);
    if (data.action === "backup") {
      const secret = randomBytes(KEY_BYTES);
      rec.extra.set(RECOVERY, hashKey(secret));
      this.host.records.dirty.add(rec.pid);
      return entryReply({ code: secret.toString("hex") });
    }
    if (data.action === "approve") {
      const pair = this.pairs.get(code);
      if (!pair || pair.pid) return entryReply({ error: "Code expired or already used" }, 410);
      this.grant(rec, pair.key);
      pair.pid = rec.pid;
      pair.name = rec.name;
      return entryReply({ approved: true });
    }
    return entryReply({ error: "Unknown action" }, 400);
  }
}
