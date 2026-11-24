// A flat map whose statics are city pieces, and a server on it: the smallest city a break can be tried in.

import { ruinKind, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import type { Source } from "../../server/combat.ts";
import type { GameOptions } from "../../server/game.ts";
import type { HostOptions } from "../../server/host.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { DMG_BULLET, DMG_EXPLOSIVE } from "../../shared/sim/damage.ts";
import { formOf } from "../../shared/world/breaking.ts";
import { writeMap, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { flatMap } from "./map.ts";
import { Harness } from "./net.ts";
import { coreRegistry } from "./world.ts";

/** A piece of the ruin kit standing with its foot `up` metres over the ground (0 unless given) at (x, z). */
export interface CityPiece {
  readonly shape: RuinShape;
  readonly finish: RuinFinish;
  readonly x: number;
  readonly z: number;
  readonly up?: number;
  readonly yaw?: number;
}

/** Anything else a map sets down, by its kind's id, its place on the ground at (x, z): a street's wreck. */
export interface CityThing {
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  readonly yaw?: number;
}

export interface City {
  readonly h: Harness;
  /** The map's file, for another server started on it. */
  readonly map: Uint8Array<ArrayBuffer>;
  /** The ref of each piece, in the order given. */
  readonly refs: number[];
  /** The id of the kind `ref` now holds, "" for an emptied slot. */
  id(ref: number): string;
  /** The form `ref` now holds (BREAK_FORMS' number), or -1 for an emptied slot. */
  form(ref: number): number;
  hp(ref: number): number;
  /** Full health of the kind the map placed at `ref`. */
  full(ref: number): number;
  /** Where the piece's place is: its origin. */
  at(ref: number): { x: number; y: number; z: number };
}

/** The ground of a flat map is at 0. `chunks` is the map's side; the spawn is in its middle. `more` is what else the map holds. */
export function city(pieces: readonly (CityPiece | CityThing)[], chunks = 4, host: HostOptions = {}, game: Partial<GameOptions> = {}, more: Partial<MapData> = {}): City {
  const reg = coreRegistry();
  // A store only to ask how far under its place each kind's foot is.
  const feet = new StructureStore({ chunksX: 1, chunksZ: 1 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts).low;
  const statics: MapStatic[] = pieces.map((p) => {
    if ("kind" in p) {
      if (!reg.index.has(p.kind)) throw new Error(`no kind ${p.kind}`);
      return { kind: p.kind, x: p.x, y: 0, z: p.z, yaw: p.yaw ?? 0 };
    }
    const kind = ruinKind(p.shape, p.finish);
    if (!reg.index.has(kind)) throw new Error(`the kit has no ${p.shape} in ${p.finish}`);
    return { kind, x: p.x, y: (p.up ?? 0) - feet[reg.index.get(kind)!]!, z: p.z, yaw: p.yaw ?? 0 };
  });
  const map = writeMap(flatMap(chunks, { ...more, statics: [...statics, ...((more.statics as readonly MapStatic[] | undefined) ?? [])] }));
  const h = new Harness(game, 1, 30, { dev: true, ...host, map });
  const structs = h.world.structs;
  const refs = statics.map((s) => {
    for (const chunk of structs.held) {
      const t = structs.chunks[chunk]!;
      for (let slot = 0; slot < t.mapped; slot++) if (Math.abs(t.x[slot]! - s.x) < 0.01 && Math.abs(t.z[slot]! - s.z) < 0.01 && Math.abs(t.y[slot]! - s.y) < 0.01 && h.reg.ids[structs.mapKind(chunk, slot)] === s.kind) return chunk * 65536 + slot;
    }
    throw new Error(`no ${s.kind} at ${s.x}, ${s.z}`);
  });
  const row = (ref: number) => [structs.chunks[Math.floor(ref / 65536)]!, ref & 0xffff] as const;
  return {
    h, refs, map,
    id: (ref) => { const [t, s] = row(ref); return t.kind[s] === 0 ? "" : h.reg.ids[t.kind[s]!]!; },
    form: (ref) => { const [t, s] = row(ref); return t.kind[s] === 0 ? -1 : formOf(h.reg, t.kind[s]!); },
    hp: (ref) => { const [t, s] = row(ref); return t.hp[s]!; },
    full: (ref) => h.reg.maxHp[structs.mapKind(Math.floor(ref / 65536), ref & 0xffff)]!,
    at: (ref) => { const [t, s] = row(ref); return { x: t.x[s]!, y: t.y[s]!, z: t.z[s]! }; },
  };
}

const NOBODY = { by: null, x: 0, z: 0, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 };
/** A blast or a round as combat is handed it, from nobody: a rocket's 7,350 to what is built, a grenade's 788, a rifle round's 280. */
export const rocket = (reg: Registry): Source => ({ ...NOBODY, item: reg.index.get("core:rocket_launcher")!, base: 250, type: DMG_EXPLOSIVE });
export const grenade = (reg: Registry): Source => ({ ...NOBODY, item: reg.index.get("core:grenade")!, base: 175, type: DMG_EXPLOSIVE });
export const rifle = (reg: Registry): Source => ({ ...NOBODY, item: 0, base: 280, type: DMG_BULLET });
/** A rocket's reach and a grenade's, in metres. */
export const ROCKET_REACH = 7.5, GRENADE_REACH = 6;
