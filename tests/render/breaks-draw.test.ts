// A city piece's broken form as it is drawn: an instance in the finish of the kind the map placed until its chunk's mesh
// is made again, and then the mesh's, with what a cut bared in the core's colour.

import { expect, test } from "bun:test";
import { QUIET_MS, REMAKE_MS, MESH_SLOT } from "../../client/core/render/nearcity.ts";
import { PIECE_IN_MESH, PIECE_KEYS, PIECE_MADE, PIECE_WEAR, PIECE_WEAR_SHIFT, WEAR_PANES_OUT, WEAR_SHADE, pieceWear, wearShade } from "../../client/core/render/pieces.ts";
import { DRAW_RANGED, type FramePacket } from "../../client/core/render/packet.ts";
import { FACADE_TIERS, KIND, facadeMarks, facadeOut, facadeSurface, type FacadeSample } from "../../client/core/render/facade.ts";
import { MADE_MARK, SPALL_LINEAR, spalled } from "../../client/core/render/world-surfaces.ts";
import { materialIndex } from "../../client/core/texgen/layers.ts";
import { RUIN_FINISHES } from "../../content/ruins.ts";
import { FORM_BREACH_A, FORM_OPEN } from "../../shared/content/breaks.ts";
import { INSTANCE_BYTES, VERTEX_BYTES, lodVertices } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { STAGE_CRACKED, STAGE_FAILING, STAGE_WORN } from "../../shared/world/breaking.ts";
import { PIECE_SLOTS } from "../../shared/world/city.ts";
import { breakCity, wallRow } from "../fixtures/breakcity.ts";
import { farPack } from "../fixtures/farworld.ts";

const CORE = RUIN_FINISHES.fracture.color;

/** The bytes of the instance of `slot` in the last instances of `chunk` a frame sent, or null where it has none. */
function instanceOf(sent: Map<number, { data: Uint8Array; slots: Uint16Array }>, chunk: number, slot: number): Uint8Array | null {
  const u = sent.get(chunk);
  const i = u ? u.slots.indexOf(slot) : -1;
  return i < 0 ? null : u!.data.subarray(i * INSTANCE_BYTES, (i + 1) * INSTANCE_BYTES);
}

/** Runs `frames` frames of `w`, keeping each chunk's instances as last sent and each near mesh as last put on the card. */
function run(w: ReturnType<typeof breakCity>, frames: number, sent = new Map<number, { data: Uint8Array; slots: Uint16Array }>(), meshes = new Map<number, Uint8Array>()) {
  let p: FramePacket | null = null;
  for (let f = 0; f < frames; f++) {
    p = w.frame();
    for (const u of p.uploads) sent.set(u.buffer, { data: u.data.slice(), slots: u.slots.slice() });
    for (const u of p.assetUploads) meshes.set(u.slot, u.data);
  }
  return { p: p!, sent, meshes };
}

/** The palette bytes of the faces of the mesh now `chunk`'s, counted. */
function meshColours(w: ReturnType<typeof breakCity>, meshes: Map<number, Uint8Array>): Map<number, number> {
  const data = meshes.get(w.scene.near!.chunk(w.chunk)!.mesh!.slot)!;
  const n = new Map<number, number>();
  for (let v = 0; v < data.length; v += 4 * VERTEX_BYTES) n.set(data[v + 6]!, (n.get(data[v + 6]!) ?? 0) + 1);
  return n;
}

test("a breached wall is drawn in its building's colour and its broken edge in core", () => {
  const w = breakCity(wallRow(3, 20, 30, ["rose", "mint", "limestone"]));
  w.look(24, 30);
  w.scene.near!.pieces = Infinity;
  const { sent, meshes } = run(w, 4);
  expect(w.scene.near!.chunk(w.chunk)!.drawn.slice(0, 3)).toEqual(Uint8Array.of(1, 1, 1));
  const kind = w.setForm(0, FORM_BREACH_A);
  expect(w.reg.breakForm[kind]).toBe(FORM_BREACH_A);
  run(w, 1, sent, meshes);
  // At once: an instance of the form's own mesh, in the rose of the wall the map placed.
  const inst = instanceOf(sent, w.chunk, 0)!;
  expect(inst[14]).toBe(RUIN_FINISHES.rose.color);
  expect(w.reg.defs[kind]).toMatchObject({ color: CORE });
  // The form's mesh in the pack: skin faces in the instance's colour, the faces a cut bared in the core's.
  const pack = farPack(), mesh = pack.header.meshes.find((m) => m.id === w.reg.ids[kind])!;
  const verts = lodVertices(pack, mesh.lods[0]!), seen = new Set<number>();
  for (let v = 0; v < verts.length; v += VERTEX_BYTES) seen.add(verts[v + 6]!);
  expect([...seen].sort()).toEqual([CORE, REGION_BASE]);
  // Once its chunk has stood quiet the mesh is made again with the form in it: rose skin, a core edge, no instance.
  const { p } = run(w, Math.ceil((REMAKE_MS + QUIET_MS) / (1000 / 60)) + 30, sent, meshes);
  const c = w.scene.near!.chunk(w.chunk)!;
  expect([c.drawn[0], c.mesh!.forms[0], c.stale]).toEqual([1, kind, false]);
  expect(instanceOf(sent, w.chunk, 0)).toBeNull();
  const colours = meshColours(w, meshes);
  expect(colours.get(CORE)).toBeGreaterThan(0);
  expect(colours.get(RUIN_FINISHES.rose.color)).toBeGreaterThan(0);
  expect(colours.get(RUIN_FINISHES.mint.color)).toBeGreaterThan(0);
  // Its slot's own state says the whole wall is gone; its faces are a group's of its slot alone, which stands.
  const row = p.pieceRowOf.get(w.chunk)!, bit = (key: number): number => p.pieces[(row * PIECE_KEYS + key) * 4]! & PIECE_IN_MESH;
  expect(bit(0)).toBe(0);
  const g = c.mesh!.slotGroups[c.mesh!.slotFirst[0]!]!;
  expect([c.mesh!.slotFirst[1]! - c.mesh!.slotFirst[0]!, bit(PIECE_SLOTS + g)]).toEqual([1, 1]);
});

test("a form of a recipe-material wall keeps its material", () => {
  const w = breakCity(wallRow(2, 20, 30, ["rosestucco", "rose"]));
  w.look(22, 30);
  w.scene.near!.pieces = Infinity;
  const { sent, meshes } = run(w, 4);
  w.setForm(0, FORM_BREACH_A);
  w.setForm(1, FORM_OPEN);
  run(w, 1, sent, meshes);
  const stucco = materialIndex("stucco");
  // As an instance its last two regions say the material, as the whole wall's do.
  expect([...instanceOf(sent, w.chunk, 0)!.subarray(14)]).toEqual([RUIN_FINISHES.rose.color, 0, 0, 0, MADE_MARK, stucco]);
  expect([...instanceOf(sent, w.chunk, 1)!.subarray(14)]).toEqual([RUIN_FINISHES.rose.color, 0, 0, 0, 0, 0]);
  // In the mesh its group's state says it.
  const { p } = run(w, Math.ceil((REMAKE_MS + QUIET_MS) / (1000 / 60)) + 30, sent, meshes);
  const c = w.scene.near!.chunk(w.chunk)!, row = p.pieceRowOf.get(w.chunk)!;
  const made = (slot: number): number => p.pieces[(row * PIECE_KEYS + PIECE_SLOTS + c.mesh!.slotGroups[c.mesh!.slotFirst[slot]!]!) * 4 + 3]! & PIECE_MADE;
  expect([c.drawn[0], c.drawn[1], made(0), made(1)]).toEqual([1, 1, stucco, 0]);
});

test("a chunk of breached pieces returns to its usual draws after the quiet remake", () => {
  // A hundred walls in ten rows, in four finishes.
  const rows = Array.from({ length: 10 }, (_, r) => wallRow(10, 8, 6 + r * 5, ["rose", "mint", "limestone", "concrete"]));
  const w = breakCity(rows.flat());
  [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [4 * 64 + 28, 40, 4 * 64 - 20, 0, -0.6];
  w.follow(w.cam.x, w.cam.z);
  w.scene.near!.pieces = Infinity;
  const count = (p: FramePacket): { draws: number; instanced: number; casters: number } => {
    let draws = 0, instanced = 0, casters = 0;
    for (let d = 0; d < p.drawCount; d++) if (p.drawBuffer[d] === w.chunk) (p.drawFlags[d]! & DRAW_RANGED) !== 0 ? draws++ : instanced++;
    for (let e = 0; e < p.casterCount; e++) if (p.casterBuffer[e] === w.chunk) casters++;
    return { draws, instanced, casters };
  };
  const sent = new Map<number, { data: Uint8Array; slots: Uint16Array }>(), meshes = new Map<number, Uint8Array>();
  const before = count(run(w, 6, sent, meshes).p);
  expect(before.instanced).toBe(0);
  for (let s = 0; s < 100; s++) w.setForm(s, s % 2 === 0 ? FORM_OPEN : FORM_BREACH_A);
  const broken = count(run(w, 2, sent, meshes).p);
  // Each form in each variant is a mesh of its own: a draw each while they are instances.
  expect(broken.instanced).toBeGreaterThan(4);
  expect(sent.get(w.chunk)!.slots.filter((s) => s !== MESH_SLOT).length).toBe(100);
  const after = count(run(w, Math.ceil((REMAKE_MS + QUIET_MS) / (1000 / 60)) + 30, sent, meshes).p);
  expect(after).toEqual({ ...before, casters: after.casters });
  expect(after.casters).toBeLessThanOrEqual(before.casters + 1);
  expect([...sent.get(w.chunk)!.slots]).toEqual([MESH_SLOT]);
  expect(w.owners(w.frame())).toEqual([]);
  // A form that breaks again leaves the mesh by its group's state, and is an instance of what it now is.
  w.setForm(1, FORM_OPEN);
  const p = run(w, 1, sent, meshes).p;
  const c = w.scene.near!.chunk(w.chunk)!, row = p.pieceRowOf.get(w.chunk)!;
  const g = c.mesh!.slotGroups[c.mesh!.slotFirst[1]!]!;
  expect([c.drawn[1], p.pieces[(row * PIECE_KEYS + PIECE_SLOTS + g) * 4]! & PIECE_IN_MESH, instanceOf(sent, w.chunk, 1) !== null]).toEqual([0, 0, true]);
  expect(w.owners(p)).toEqual([]);
});

/** The wear the state of key `key` of the fixture's chunk holds in frame `p`. */
const wearOf = (w: ReturnType<typeof breakCity>, p: FramePacket, key: number): number => (p.pieces[(p.pieceRowOf.get(w.chunk)! * PIECE_KEYS + key) * 4]! >> PIECE_WEAR_SHIFT) & PIECE_WEAR;

test("a worn piece's texel holds its stage when its row arrives and after a remake", () => {
  const w = breakCity(wallRow(4, 20, 30, ["rose"], "wall8"));
  w.look(36, 30, 30);
  w.scene.near!.pieces = Infinity;
  const sent = new Map<number, { data: Uint8Array; slots: Uint16Array }>(), meshes = new Map<number, Uint8Array>();
  let p = run(w, 4, sent, meshes).p;
  expect([0, 1, 2, 3].map((s) => wearOf(w, p, s))).toEqual([0, 0, 0, 0]);
  w.wear(1, 0.6);
  w.wear(2, 0.25);
  w.wear(3, 0.1);
  p = run(w, 1, sent, meshes).p;
  // The frame the row is read: the stage is in the state, the piece is still the mesh's, nothing is laid out again.
  expect([0, 1, 2, 3].map((s) => wearOf(w, p, s))).toEqual([0, STAGE_WORN, STAGE_CRACKED, STAGE_FAILING]);
  expect([...w.scene.near!.chunk(w.chunk)!.drawn.slice(0, 4)]).toEqual([1, 1, 1, 1]);
  expect([p.uploads.length, w.scene.near!.stats.laid]).toEqual([0, 0]);
  expect(w.owners(p)).toEqual([]);
  // A mesh made again, and a chunk let go and come back to, hold it still.
  const before = w.scene.near!.chunk(w.chunk)!.mesh;
  p = run(w, Math.ceil((REMAKE_MS + QUIET_MS) / (1000 / 60)) + 30, sent, meshes).p;
  expect(w.scene.near!.chunk(w.chunk)!.mesh).not.toBe(before);
  expect([0, 1, 2, 3].map((s) => wearOf(w, p, s))).toEqual([0, STAGE_WORN, STAGE_CRACKED, STAGE_FAILING]);
  w.wear(1, 1);
  p = run(w, 1, sent, meshes).p;
  expect(wearOf(w, p, 1)).toBe(0);
  // The twin reads what the vertex text reads, and a stage darkens a piece by a fixed share.
  const row = p.pieceRowOf.get(w.chunk)!, rows = new Array(9).fill(row);
  expect([pieceWear(p.pieces, rows, 0, 2), pieceWear(p.pieces, rows, 0, 3)]).toEqual([STAGE_CRACKED, STAGE_FAILING]);
  expect([wearShade(0), wearShade(STAGE_FAILING), wearShade(STAGE_FAILING | WEAR_PANES_OUT)]).toEqual([1, 1 - 3 * WEAR_SHADE, 1 - 3 * WEAR_SHADE]);
});

test("a member of a merged box that is worn shows its mark", () => {
  // Four walls end to end in one colour merge into one box.
  const w = breakCity(wallRow(4, 20, 30, ["rose"], "wall4"));
  w.look(28, 30, 20);
  w.scene.near!.pieces = Infinity;
  const sent = new Map<number, { data: Uint8Array; slots: Uint16Array }>(), meshes = new Map<number, Uint8Array>();
  let p = run(w, 4, sent, meshes).p;
  let c = w.scene.near!.chunk(w.chunk)!, m = c.mesh!;
  expect(m.slotFirst[2]! - m.slotFirst[1]!).toBeGreaterThan(0);
  const g = m.slotGroups[m.slotFirst[1]!]!, bit = (q: FramePacket, key: number): number => q.pieces[(q.pieceRowOf.get(w.chunk)! * PIECE_KEYS + key) * 4]! & PIECE_IN_MESH;
  expect(bit(p, PIECE_SLOTS + g)).toBe(1);
  w.wear(1, 0.5);
  p = run(w, 1, sent, meshes).p;
  // Its box is broken, so each member's own faces are drawn, which read each its own state: only the worn one's is marked.
  expect([bit(p, PIECE_SLOTS + g), bit(p, 1), wearOf(w, p, 1), wearOf(w, p, 0), wearOf(w, p, 2), wearOf(w, p, PIECE_SLOTS + g)]).toEqual([0, 1, STAGE_WORN, 0, 0, 0]);
  expect(m.opened).toBeGreaterThan(0);
  expect(w.owners(p)).toEqual([]);
  // The mesh made again is made with the worn wall apart: it is in no box, and the rest merge without it.
  p = run(w, Math.ceil((REMAKE_MS + QUIET_MS) / (1000 / 60)) + 30, sent, meshes).p;
  c = w.scene.near!.chunk(w.chunk)!;
  m = c.mesh!;
  expect([m.slotFirst[2]! - m.slotFirst[1]!, c.stale, m.opened, wearOf(w, p, 1)]).toEqual([0, false, 0, STAGE_WORN]);
  expect(m.slotFirst[4]! - m.slotFirst[2]!).toBeGreaterThan(0);
});

test("a piece's glass out does not change its neighbour's", () => {
  const w = breakCity(wallRow(3, 20, 30, ["limestone"], "zwin").map((p, i) => ({ ...p, x: 20 + i * 8 })));
  w.look(28, 30, 20);
  w.scene.near!.pieces = Infinity;
  const sent = new Map<number, { data: Uint8Array; slots: Uint16Array }>(), meshes = new Map<number, Uint8Array>();
  run(w, 4, sent, meshes);
  w.unglaze(1);
  const p = run(w, 1, sent, meshes).p;
  expect([wearOf(w, p, 0), wearOf(w, p, 1), wearOf(w, p, 2)]).toEqual([0, WEAR_PANES_OUT, 0]);
  // No merged box of the three bays stands with the middle one in it: every face of the middle bay reads its own state.
  const c = w.scene.near!.chunk(w.chunk)!, m = c.mesh!, row = p.pieceRowOf.get(w.chunk)!;
  for (let k = m.slotFirst[1]!; k < m.slotFirst[2]!; k++) expect(p.pieces[(row * PIECE_KEYS + PIECE_SLOTS + m.slotGroups[k]!) * 4]! & PIECE_IN_MESH).toBe(0);
  expect(w.owners(p)).toEqual([]);
});

test("a cracked wall is lost to its core in patches, a failing one in more, a worn one in none", () => {
  const share = (stage: number): number => {
    let lost = 0;
    for (let i = 0; i < 4000; i++) lost += spalled(100 + (i % 80) * 0.1, 2 + Math.floor(i / 80) * 0.08, 50, 0, 0, 1, stage)[0]!;
    return lost / 4000;
  };
  expect([share(0), share(STAGE_WORN)]).toEqual([0, 0]);
  expect(share(STAGE_CRACKED)).toBeGreaterThan(0.03);
  expect(share(STAGE_CRACKED)).toBeLessThan(0.3);
  expect(share(STAGE_FAILING)).toBeGreaterThan(share(STAGE_CRACKED) * 1.5);
  expect(share(STAGE_FAILING)).toBeLessThan(0.6);
  // The mask is the world's: two walls in one plane read it alike where they meet, and a floor reads it across itself.
  expect(spalled(108, 3, 50, 0, 0, 1, STAGE_FAILING).slice()).toEqual(spalled(108, 3, 50, 0, 0, 1, STAGE_FAILING).slice());
  expect(spalled(108, 3, 50, 0, 1, 0, STAGE_FAILING).slice()).toEqual(spalled(108, 9, 50, 0, 1, 0, STAGE_FAILING).slice());
  // The core shows darker than its palette colour.
  expect(Math.max(...SPALL_LINEAR)).toBeLessThan(0.5);
});

const blank: FacadeSample = (_texture, _u, _v, _lod, out) => out.fill(0);

test("a wall's cracks and scars grow with its stage, and a whole wall's are as they were", () => {
  // The share of a wall's points a mark darkens or pocks, over many walls of one size by their place.
  const marked = (stage: number): number => {
    const o = facadeOut();
    let n = 0, all = 0;
    for (let wall = 0; wall < 40; wall++) {
      for (let i = 0; i < 600; i++, all++) {
        o.albedo.fill(0.5);
        o.orm.set([1, 0.5, 0]);
        o.normal.set([0, 0, 1]);
        const x = ((i * 0.6180339) % 1) * 8, y = ((i * 0.7548776) % 1) * 4;
        // A storey up, where no poster or tag is laid.
        facadeMarks(o, KIND.none, x, y, 8, 4, 15, [0, 0, 1], [0, 0, 0], [1, 0, 0], wall * 37, wall * 11, 12 + y, 8 + y, -1e9, 0.004, FACADE_TIERS.high!, blank, stage);
        if (Math.abs(o.albedo[0]! - 0.5) > 0.02) n++;
      }
    }
    return n / all;
  };
  const by = [0, STAGE_WORN, STAGE_CRACKED, STAGE_FAILING].map(marked);
  expect(by[1]!).toBeGreaterThan(by[0]!);
  expect(by[2]!).toBeGreaterThan(by[1]! * 1.3);
  expect(by[3]!).toBeGreaterThan(by[2]!);
  // No stage given is the whole wall's marks, as every wall had them.
  const o = facadeOut(), q = facadeOut();
  for (let i = 0; i < 300; i++) {
    for (const [out, wear] of [[o, undefined], [q, 0]] as const) {
      out.albedo.fill(0.5);
      out.orm.set([1, 0.5, 0]);
      out.normal.set([0, 0, 1]);
      facadeMarks(out, KIND.none, (i % 20) * 0.4, Math.floor(i / 20) * 0.26, 8, 4, 15, [0, 0, 1], [0, 0, 0], [1, 0, 0], 37, 11, 12, 8, -1e9, 0.004, FACADE_TIERS.high!, blank, wear);
    }
    expect([...o.albedo, ...o.orm]).toEqual([...q.albedo, ...q.orm]);
  }
});

test("glass whose piece's panes are out is broken on every tier that draws it, whatever dressed it", () => {
  for (const tier of ["medium", "high"] as const) {
    let changed = 0, darker = 0;
    for (let bay = 0; bay < 30; bay++) {
      const whole = facadeOut(), out = facadeOut();
      for (const [o, wear] of [[whole, 0], [out, WEAR_PANES_OUT]] as const) {
        o.albedo.fill(0.5);
        o.orm.set([1, 0.5, 0]);
        o.normal.set([0, 0, 1]);
        facadeSurface(o, KIND.window, 0.7, 1, 1.4, 2, [0, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0], bay * 53, bay * 17, 5, 5, 0.004, 10, FACADE_TIERS[tier]!, blank, wear);
      }
      if (out.albedo[0] !== whole.albedo[0] || out.orm[1] !== whole.orm[1] || out.room[0] !== whole.room[0]) changed++;
      if (out.albedo[0]! <= whole.albedo[0]!) darker++;
    }
    // With a blank atlas the pane's recess is what differs: darker and fully rough where its panes are out.
    expect(changed).toBeGreaterThan(20);
    expect(darker).toBe(30);
  }
});
