// What travels between the servers of a cluster: one file, sealed. Its first line is the SHA-256 of the rest, which is JSON: a
// head that says what it is, whose, from where to where, and what it carries, then the records themselves in the form a save
// keeps them (server/persist/codec.ts), against a table of the content ids they name. It carries any record: a survivor and
// the eggs it holds now, a creature with its saddle and inventory or a loose stack later.

import type { Registry } from "../../shared/content/registry.ts";
import { RecordCodec, idMap } from "../persist/codec.ts";
import type { EntityRecord } from "../records.ts";

export const PARCEL_FORMAT = 1;

export interface ParcelHead {
  format: number;
  /** 32 hex digits, made at random. */
  id: string;
  /** "survivor". The first record is the one that travels; the rest go with it. */
  what: string;
  from: number;
  to: number;
  /** The first record's name and id. */
  name: string;
  pid: number;
  /** How many times the record has changed worlds, this time included. Orders what a world must do over again after a restore. */
  hop: number;
  /** The world tick it left at. The records' ticks are on that world's clock until the taker moves them to its own. */
  tick: number;
  /** Wall clock, milliseconds: when it was sealed, and when its ticket ends (0 for never). */
  made: number;
  expires: number;
  /** Hex of the SHA-256 of the ticket's secret. */
  ticket: string;
  /** Hex of the device key hash that owned the survivor where it left, so its owner can take it back there. */
  key: string;
  /** Registry.coreHash where it left. */
  content: number;
  /** The tribe of the first record where it left: its team, its name, and whether the record owned it. Null for none. */
  tribe: { team: number; name: string; owner: boolean } | null;
  /** Everything the records hold, by content id, as the ledger counts it (Items.held). */
  items: Record<string, number>;
  /** Every record's id, the first first. */
  pids: number[];
  /**
   * The world it left had made records and teams up to these (Records.nextSeq, nextTeam). A save of that world restored from
   * before it left numbers on from here, so it never gives out an id again that is travelling.
   */
  seq: number;
  teams: number;
}

interface ParcelBody extends ParcelHead {
  /** The table the records' content indices point into. */
  ids: string[];
  records: { pid: number; kind: number; x: number; y: number; z: number; yaw: number; data: string }[];
}

export interface Parcel {
  head: ParcelHead;
  body: ParcelBody;
}

/** Hex of a SHA-256. */
export function sha256(data: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function unhex(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "hex"));
}

/** The file for `records`, the first of which travels, written with this build's content table. */
export function sealParcel(reg: Registry, head: ParcelHead, records: readonly EntityRecord[]): Uint8Array {
  const identity = new Uint16Array(reg.ids.length);
  for (let i = 0; i < identity.length; i++) identity[i] = i;
  const codec = new RecordCodec(identity, idMap(reg, reg.ids.map((id, i) => [id, i]), reg.ids.length), false);
  const body: ParcelBody = {
    ...head,
    ids: [...reg.ids],
    records: records.map((rec) => ({ pid: rec.pid, kind: rec.kind, x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw, data: Buffer.from(codec.encode(rec)).toString("base64") })),
  };
  const text = JSON.stringify(body);
  return new TextEncoder().encode(`${sha256(text)}\n${text}`);
}

/** Throws if the file is not whole and as it was sealed. */
export function openParcel(bytes: Uint8Array): Parcel {
  const text = new TextDecoder().decode(bytes);
  const cut = text.indexOf("\n");
  const rest = cut < 0 ? "" : text.slice(cut + 1);
  if (cut !== 64 || sha256(rest) !== text.slice(0, 64)) throw new Error("its seal does not match what it holds");
  const body = JSON.parse(rest) as ParcelBody;
  if (body.format !== PARCEL_FORMAT) throw new Error(`it was written in form ${body.format}, and this build reads ${PARCEL_FORMAT}`);
  const { ids: _ids, records: _records, ...head } = body;
  return { head, body };
}

/** The records, as this build reads them. Throws, naming what is missing, if they name content this build lacks. */
export function parcelRecords(reg: Registry, parcel: Parcel): EntityRecord[] {
  const ids = parcel.body.ids;
  const map = idMap(reg, ids.map((id, i): [string, number] => [id, i]), ids.length);
  const codec = new RecordCodec(new Uint16Array(reg.ids.length), map, false, "the survivor", "this server's content lacks it");
  return parcel.body.records.map((r) => {
    const rec = codec.decode({ pid: r.pid, kind: r.kind, x: r.x, y: r.y, z: r.z, yaw: r.yaw, data: new Uint8Array(Buffer.from(r.data, "base64")) });
    if (!rec) throw new Error(`the survivor uses content this build does not have: ${ids[r.kind] ?? "a kind"}`);
    return rec;
  });
}
