// The map events as the client keeps them once the late code has come (mapevent-late.ts): the feed read once a message,
// each part of each event beside its event's row and its look, and what is worked out of a part once, not each frame: a
// craft's path made ready, kept from message to message while its points are the same.

import { BitReader } from "../../../shared/net/codec.ts";
import type { ColumnLook, CraftLook } from "../../../shared/mapevent/parts.ts";
import { MAPEVENT_BYTES, readMapEvents, type CraftRow, type MapEventFeed, type MapEventRow, type SiteRow } from "../../../shared/mapevent/wire.ts";
import { buildTrack, newCraftPose, type CraftPose, type CraftTrack, type PathPoint } from "../../../shared/sim/craft.ts";
import type { MapEventPass } from "../render/passes/map-events.ts";
import type { SoundProducer } from "../sound/sounds.ts";

/** Meshes a craft is drawn with, as the pass finds them in its pack: its pieces, its fallback, its wreck. -1 for none. */
export const CRAFT_MESHES = 6;
export const MESH_FALLBACK = 4;
export const MESH_WRECK = 5;

export interface ShownCraft {
  readonly type: "craft";
  /** Its event's id and its own, as one number: what is kept of it from frame to frame is kept by this. */
  readonly key: number;
  readonly event: MapEventRow;
  readonly row: CraftRow;
  readonly look: CraftLook;
  readonly track: CraftTrack;
  /** Filled by the pass (CRAFT_MESHES), each time a message comes. */
  readonly meshes: Int32Array;
  /** The way it was going when it was brought down, an angle from +Z; NaN until worked out, once a message. */
  way: number;
  /** Where it is at `atTick` and what it is doing then (mapevent/craft.ts CRAFT_), worked out once a frame. */
  readonly at: CraftPose;
  atTick: number;
  state: number;
}

export interface ShownSite {
  readonly type: "site";
  readonly key: number;
  readonly event: MapEventRow;
  readonly row: SiteRow;
  readonly look: ColumnLook;
}

export type ShownPart = ShownCraft | ShownSite;

export interface MapEventsShown {
  readonly feed: MapEventFeed;
  readonly parts: readonly ShownPart[];
  /** The tick they are drawn and heard at: the session's shown tick, set each frame (mapevent/part.ts). */
  tick: number;
}

/** What mapevent-late.ts gives the scene (Scene.mapEvents): the pass, the reader, and what hears them. */
export interface MapEventsCode {
  readonly Pass: typeof MapEventPass;
  read(bytes: Uint8Array, was: MapEventsShown | null): MapEventsShown | null;
  hearing(from: { readonly shown: MapEventsShown | null }): SoundProducer;
}

/** A part's key: its event's id over its own, which is a byte. */
export const partKey = (event: number, part: number): number => event * 256 + part;

const samePoints = (a: readonly PathPoint[], b: readonly PathPoint[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!, q = b[i]!;
    if (p.x !== q.x || p.y !== q.y || p.z !== q.z || p.speed !== q.speed || p.low !== q.low) return false;
  }
  return true;
};

const reader = new BitReader();

/** A feed's bytes read, or `was` again where they are not a feed. A craft whose points have not changed keeps its path. */
export function readShown(bytes: Uint8Array, was: MapEventsShown | null): MapEventsShown | null {
  if (bytes.length > MAPEVENT_BYTES) return was;
  reader.reset(bytes);
  const feed = readMapEvents(reader);
  if (!feed) return was;
  const tracks = new Map<number, CraftTrack>();
  for (const p of was?.parts ?? []) if (p.type === "craft") tracks.set(p.key, p.track);
  const parts: ShownPart[] = [];
  for (const event of feed.rows) {
    for (const row of event.parts) {
      const look = feed.looks[row.look]!;
      const key = partKey(event.id, row.id);
      if (row.type === "site") {
        if (look.type === "column") parts.push({ type: "site", key, event, row, look: look.column });
        continue;
      }
      if (look.type !== "craft") continue;
      const had = tracks.get(key);
      const track = had && samePoints(had.points, row.points) ? had : buildTrack(row.points);
      parts.push({ type: "craft", key, event, row, look: look.craft, track, meshes: new Int32Array(CRAFT_MESHES).fill(-1), way: NaN, at: newCraftPose(), atTick: NaN, state: 0 });
    }
  }
  return { feed, parts, tick: was?.tick ?? 0 };
}
