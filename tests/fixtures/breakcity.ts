// A client's near city over a few rows of breaking ruin pieces, and its slots set to their broken forms as a row from the
// server sets them: the smallest city a broken form can be drawn in.

import { ruinKind, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import { formKind } from "../../shared/content/breaks.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { bodyHealth, variantAt } from "../../shared/world/breaking.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { flatMap } from "./map.ts";
import { nearClient } from "./nearclient.ts";
import { coreRegistry } from "./world.ts";

/** The chunk the pieces stand in: the middle of a map of nine a side. */
export const BREAK_CHUNK = 4 * 9 + 4;

export interface Standing {
  readonly shape: RuinShape;
  readonly finish: RuinFinish;
  /** Metres from the chunk's corner, and how far its foot is over the ground: 0 unless given. */
  readonly x: number;
  readonly up?: number;
  readonly z: number;
  readonly yaw?: number;
}

/** A row of `n` walls 4 m long and 4 m tall along x from (x, z), in `finishes` in turn. */
export function wallRow(n: number, x: number, z: number, finishes: readonly RuinFinish[], shape: RuinShape = "wall4"): Standing[] {
  return Array.from({ length: n }, (_, i): Standing => ({ shape, finish: finishes[i % finishes.length]!, x: x + i * 4, z }));
}

/** A near client over `pieces`, all in BREAK_CHUNK; slot `i` of the chunk holds piece `i`. */
export function breakCity(pieces: readonly Standing[]) {
  const reg = coreRegistry();
  const [x0, z0] = [4 * CHUNK_SIZE, 4 * CHUNK_SIZE];
  // A store only to ask how far under its place each kind's foot is.
  const feet = new StructureStore({ chunksX: 1, chunksZ: 1 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts).low;
  const statics: MapStatic[] = pieces.map((p) => {
    const kind = ruinKind(p.shape, p.finish);
    if (!reg.index.has(kind)) throw new Error(`the kit has no ${p.shape} in ${p.finish}`);
    return { kind, x: x0 + p.x, y: (p.up ?? 0) - feet[reg.index.get(kind)!]!, z: z0 + p.z, yaw: p.yaw ?? 0 };
  });
  const w = nearClient(flatMap(9, { id: "test:break-city", statics }));
  let version = 100;
  const at = (slot: number): number => w.city.first[BREAK_CHUNK]! + slot;
  return {
    ...w, reg, chunk: BREAK_CHUNK,
    /** The kind the map placed in `slot`. */
    placed: (slot: number): number => w.city.kind[at(slot)]!,
    /** The kind `slot`'s piece is in `form`, by its place's variant. */
    formOf(slot: number, form: number): number {
      const i = at(slot);
      return formKind(reg, w.city.kind[i]!, form, variantAt(w.city.x[i]!, w.city.y[i]!, w.city.z[i]!));
    },
    /** Sets `slot` to `form` of its piece in place, at `hp`, as a row from the server does. */
    setForm(slot: number, form: number, hp = 1): number {
      const i = at(slot), kind = this.formOf(slot, form);
      if (kind === 0) throw new Error(`slot ${slot}'s piece has no form ${form}`);
      w.structs.put(BREAK_CHUNK, slot, kind, w.city.x[i]!, w.city.y[i]!, w.city.z[i]!, w.city.yaw[i]!, 0, hp, ++version);
      w.structs.setVersion(BREAK_CHUNK, version);
      return kind;
    },
    /** Sets the health of the whole piece in `slot`. */
    setHp(slot: number, hp: number): void {
      const i = at(slot);
      w.structs.put(BREAK_CHUNK, slot, w.structs.chunks[BREAK_CHUNK]!.kind[slot]!, w.city.x[i]!, w.city.y[i]!, w.city.z[i]!, w.city.yaw[i]!, 0, hp, ++version);
      w.structs.setVersion(BREAK_CHUNK, version);
    },
    /** Sets the whole piece in `slot` to `share` of its body's health, its panes gone with any of it. */
    wear(slot: number, share: number): void {
      const kind = w.city.kind[at(slot)]!;
      this.setHp(slot, Math.fround(bodyHealth(reg, kind) * share + (share < 1 ? 0 : reg.glassHp[kind]!)));
    },
    /** Takes the panes of the whole piece in `slot`, its body unharmed. */
    unglaze(slot: number): void {
      this.setHp(slot, bodyHealth(reg, w.city.kind[at(slot)]!));
    },
    /** The camera `back` metres south of (x, z) of the chunk and `up` over the ground, looking north and down at it. */
    look(x: number, z: number, back = 14, up = 6): void {
      [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [x0 + x, up, z0 + z - back, 0, -Math.atan2(up - 2, back)];
      w.follow(w.cam.x, w.cam.z);
    },
  };
}
