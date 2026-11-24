// Pictures of city pieces breaking, by the software rasterizer with the game's finishes: walls in three finishes whole,
// worn, cracked, breached and opened, as instances and as their chunk's mesh draws them once it is made again; a
// storefront and a window bay with their glass out; a slab holed; a heap.
//
//   bun tools/snap/breaks.ts [out folder] [--tier high] [--size 1280x540] [--only walls]
//
// The out folder is artifacts/breaks-client unless given. tests/render/breaks-draw.test.ts holds what these show to counts.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { QUIET_MS, REMAKE_MS } from "../../client/core/render/nearcity.ts";
import { Falling } from "../../client/core/rubble.ts";
import type { Rubble } from "../../client/core/session.ts";
import { ruinKind, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import { FORM_BREACH_A, FORM_BREACH_B, FORM_HEAP, FORM_OPEN, formKind } from "../../shared/content/breaks.ts";
import { CHUNK_SIZE, TICK_RATE } from "../../shared/coords.ts";
import { bodyHealth, heapAt, variantAt } from "../../shared/world/breaking.ts";
import { GONE_BLAST } from "../../shared/world/structures.ts";
import { parseMap, writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";
import { provingView, type ProvingView } from "../snap.ts";
import { gameFiles, type GameFiles } from "./files.ts";
import { encodePng } from "./png.ts";

/** What a piece of a picture is set to: a share of its body's health left, its panes out, a form. */
export interface Broken {
  readonly left?: number;
  readonly panes?: boolean;
  readonly form?: number;
}

export interface Piece extends Broken {
  readonly shape: RuinShape;
  readonly finish: RuinFinish;
  /** Metres from the chunk's corner, and how far its foot is over the ground. */
  readonly x: number;
  readonly z: number;
  readonly up?: number;
  readonly yaw?: number;
}

/** The chunk the pieces stand in, of a map of four a side. */
const CHUNK = 1 * 4 + 1, X0 = CHUNK_SIZE, Z0 = CHUNK_SIZE;

/** A view of `pieces` standing whole, and each slot's place: slot `i` holds piece `i`. */
export function breakScene(pieces: readonly Piece[], width: number, height: number, tier: string, files?: GameFiles): ProvingView & { set(slot: number, to: Broken): void; blast(slot: number, x: number, up: number, z: number): void; look(x: number, z: number, back: number, up: number, at?: number): void; frames(ms: number): void; build(): ReturnType<ProvingView["scene"]["build"]> } {
  const reg = coreRegistry();
  const feet = new StructureStore({ chunksX: 1, chunksZ: 1 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts).low;
  const statics: MapStatic[] = pieces.map((p) => {
    const kind = ruinKind(p.shape, p.finish);
    if (!reg.index.has(kind)) throw new Error(`the kit has no ${p.shape} in ${p.finish}`);
    return { kind, x: X0 + p.x, y: (p.up ?? 0) - feet[reg.index.get(kind)!]!, z: Z0 + p.z, yaw: p.yaw ?? 0 };
  });
  const map = parseMap(writeMap(flatMap(4, { id: "test:breaks", statics })), true, true);
  const v = provingView(width, height, {}, files, map, undefined, 0, true);
  v.scene.assets.tier = tierOf(tier);
  v.scene.viewHeight = height;
  v.scene.hour = 10.5;
  v.remote.count = 0;
  if (v.scene.near) v.scene.near.pieces = Infinity;
  let version = 1000;
  const t = v.structs.chunks[CHUNK]!;
  // What breaks is thrown as its fragments, by the scene's clock as ticks.
  const falling = (v.scene.falling = new Falling(reg.halfY, (x, z) => v.hf.heightAt(x, z), { reg, structs: v.structs, mapKind: (c, s) => v.structs.mapKind(c, s) }));
  const rubble: Rubble[] = [];
  const ticks = (): number => (v.scene.now / 1000) * TICK_RATE;
  const view = {
    ...v,
    /** A frame on: what broke since the last is taken in, and the frame built. */
    build() {
      v.scene.now += 1000 / 60;
      v.port?.advance(v.scene.now);
      falling.absorb(rubble, v.scene.now, v.cam.x, v.cam.y, v.cam.z, ticks());
      falling.step(v.scene.now, ticks());
      return v.scene.build(v.cam, v.remote);
    },
    /** A blast at (x, up, z) of the chunk takes `slot`'s piece to its heap, or to nothing where it has none. */
    blast(slot: number, x: number, up: number, z: number): void {
      const kind = t.kind[slot]!, [px, py, pz, yaw] = [t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!];
      const into = heapAt(reg, kind, px, py, pz);
      rubble.push({ kind, x: px, y: py, z: pz, yaw, tw: -1, cause: GONE_BLAST, ox: X0 + x, oy: up, oz: Z0 + z, tick: Math.floor(ticks()), radius: 7.5, into, map: v.structs.mapKind(CHUNK, slot) });
      if (into !== 0) v.structs.put(CHUNK, slot, into, px, py, pz, yaw, 0, 24, ++version);
      else v.structs.put(CHUNK, slot, 0, 0, 0, 0, 0, 0, 0, ++version);
      v.structs.setVersion(CHUNK, version);
    },
    set(slot: number, to: Broken): void {
      const placed = v.structs.mapKind(CHUNK, slot), body = bodyHealth(reg, placed);
      const kind = to.form ? formKind(reg, placed, to.form, variantAt(t.x[slot]!, t.y[slot]!, t.z[slot]!)) : placed;
      if (kind === 0) throw new Error(`${reg.ids[placed]} has no form ${to.form}`);
      if (kind !== t.kind[slot]) falling.swap(t.kind[slot]!, kind, t.x[slot]!, t.y[slot]!, t.z[slot]!, -1);
      const hp = Math.fround((to.left ?? 1) * body + (to.panes === false || to.form || (to.left ?? 1) < 1 ? 0 : reg.glassHp[placed]!));
      v.structs.put(CHUNK, slot, kind, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, 0, hp, ++version);
      v.structs.setVersion(CHUNK, version);
    },
    /** The camera `back` metres north of (x, z) of the chunk, `up` over the ground, looking south at a point `at` metres up there: +x is to the right. */
    look(x: number, z: number, back: number, up: number, at = 2): void {
      [v.cam.x, v.cam.y, v.cam.z, v.cam.yaw, v.cam.pitch] = [X0 + x, up, Z0 + z + back, Math.PI, -Math.atan2(up - at, back)];
    },
    /** Runs the scene on by `ms`: each frame's uploads go to the card and nothing is drawn. */
    frames(ms: number): void {
      for (let f = 0; f < ms / (1000 / 60); f++) {
        const p = view.build();
        p.drawCount = p.tileCount = 0;
        v.raster.render(p);
      }
    },
  };
  pieces.forEach((p, slot) => {
    if (p.left !== undefined || p.panes !== undefined || p.form) view.set(slot, p);
  });
  return view;
}

/** Draws the view as it stands once the card holds what it asks for, `wait` milliseconds on at the least. */
function shot(v: ReturnType<typeof breakScene>, out: string, name: string, wait = 1500): void {
  v.frames(wait);
  for (let f = 0; f < 600; f++) {
    const p = v.build(), r = v.scene.assets.residency;
    const done = p.uploads.length + p.assetUploads.length + p.texUploads.length === 0 && r.flying === 0 && r.waiting === 0;
    if (!done) p.drawCount = p.tileCount = 0;
    v.raster.render(p);
    if (done) break;
  }
  writeFileSync(join(out, `${name}.png`), encodePng(v.raster.width, v.raster.height, v.raster.color));
  console.log(`${name}.png`);
}

/** The states a row of five walls shows, left to right. */
const STATES: readonly Broken[] = [{}, { left: 0.6 }, { left: 0.25 }, { form: FORM_BREACH_A, left: 0.3 }, { form: FORM_OPEN, left: 0.2 }];

if (import.meta.main) {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { tier: { type: "string", default: "high" }, size: { type: "string", default: "1280x540" }, only: { type: "string" } }, allowPositionals: true });
  const out = positionals[0] ?? "artifacts/breaks-client";
  const [width, height] = values.size!.split("x").map(Number) as [number, number];
  const tier = values.tier!, only = values.only;
  mkdirSync(out, { recursive: true });
  const files = await gameFiles();
  const wants = (name: string): boolean => !only || name.startsWith(only);

  // Walls 8 m long in three finishes, each a row of five states, drawn as instances and then as the mesh made again.
  for (const finish of ["rosestucco", "limestone", "concrete"] as const) {
    if (!wants("walls")) break;
    const v = breakScene(STATES.map((s, i): Piece => ({ shape: "wall8", finish, x: 6 + i * 10, z: 40 })), width, height, tier, files);
    v.look(26, 40, 17, 3.2);
    v.frames(500);
    STATES.forEach((s, i) => v.set(i, s));
    shot(v, out, `walls-${finish}-${tier}-instances`);
    v.frames(QUIET_MS + REMAKE_MS + 500);
    shot(v, out, `walls-${finish}-${tier}-meshed`);
    v.look(41, 40, 9, 2.4);
    shot(v, out, `walls-${finish}-${tier}-close`);
    v.look(21, 40, 9, 2.4);
    shot(v, out, `walls-${finish}-${tier}-worn`);
  }
  // A storefront and a window bay, whole and with their glass out, and each breached.
  if (wants("glass")) {
    const bays: Piece[] = (["zstore", "zwin"] as const).flatMap((shape, r) => [{}, { panes: false }, { form: FORM_BREACH_A, left: 0.3 }, { form: FORM_BREACH_B, left: 0.3 }].map((s, i): Piece => ({ shape, finish: r === 0 ? "limestone" : "rosestucco", x: 6 + i * 10, z: 44 - r * 24, ...s })));
    const v = breakScene(bays, width, height, tier, files);
    v.look(21, 44, 17, 3);
    shot(v, out, `glass-store-${tier}`);
    v.look(21, 20, 17, 3);
    shot(v, out, `glass-windows-${tier}`);
  }
  // A slab on four piers, holed in one half and then opened, and a wall's heap beside a standing wall.
  if (wants("slab")) {
    const piers: Piece[] = [[2, 2], [14, 2], [2, 10], [14, 10], [26, 2], [26, 10]].map(([x, z]): Piece => ({ shape: "pier4", finish: "concrete", x: 10 + x!, z: 34 + z! }));
    const v = breakScene([...piers, { shape: "floor8", finish: "concrete", x: 14, z: 40, up: 4, form: FORM_BREACH_A, left: 0.3 }, { shape: "floor8", finish: "concrete", x: 22, z: 40, up: 4, form: FORM_OPEN, left: 0.2 }, { shape: "floor8", finish: "concrete", x: 30, z: 40, up: 4 }], width, height, tier, files);
    v.look(22, 40, 18, 12, 4);
    shot(v, out, `slab-${tier}`);
    v.frames(QUIET_MS + REMAKE_MS + 500);
    shot(v, out, `slab-${tier}-meshed`);
  }
  // A rocket at the foot of a row of walls: the nearest goes to its heap and the two beside it are breached, at four moments.
  if (wants("blast")) {
    const v = breakScene([0, 1, 2].map((i): Piece => ({ shape: "wall8", finish: "rosestucco", x: 14 + i * 8, z: 40 })), width, height, tier, files);
    v.look(22, 40, 15, 3.2);
    shot(v, out, `blast-${tier}-0-before`);
    v.blast(1, 22, 1, 41.5);
    v.set(0, { form: FORM_BREACH_B, left: 0.3 });
    v.set(2, { form: FORM_BREACH_A, left: 0.3 });
    let at = 0;
    for (const ms of [120, 400, 900, 2500]) {
      shot(v, out, `blast-${tier}-${ms}ms`, ms - at - 17);
      at = ms;
    }
  }
  if (wants("heap")) {
    const v = breakScene([{ shape: "wall8", finish: "rosestucco", x: 12, z: 40 }, { shape: "wall8", finish: "rosestucco", x: 22, z: 40, form: FORM_HEAP }, { shape: "wall8", finish: "limestone", x: 32, z: 40, form: FORM_HEAP }, { shape: "floor8", finish: "concrete", x: 42, z: 40, form: FORM_HEAP }], width, height, tier, files);
    v.look(27, 40, 20, 5, 1);
    shot(v, out, `heap-${tier}`);
    v.frames(QUIET_MS + REMAKE_MS + 500);
    shot(v, out, `heap-${tier}-meshed`);
  }
}
