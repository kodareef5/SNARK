// A city piece falling as its break set (client/core/fragments.ts, rubble.ts, render/fragment-meshes.ts): which set a
// break throws, where each group is by the time since the server's tick, and what the frame spends on drawing them.

import { expect, test } from "bun:test";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { BreakSets, MOST_GROUPS, POSE, SET_ALL, SET_LEAVES, fragmentPose, type BreakSet, type Broken } from "../../client/core/fragments.ts";
import { CORE_COLOUR, FRAGMENT_SLOTS, MOST_MESHES, fragmentMesh, fragmentSlot } from "../../client/core/render/fragment-meshes.ts";
import { BONE_FLOATS, DRAW_ONE_BONE, DRAW_SKINNED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { FRONT_MS_PER_METRE, Falling, MAX_FRONT_MS, SHRINK } from "../../client/core/rubble.ts";
import type { Rubble } from "../../client/core/session.ts";
import { leavesOf } from "../../content/breaks/leaves.ts";
import { RUIN_FINISHES, ruinKind, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import { FORM_BREACH_A, FORM_OPEN, formKind, heapKind } from "../../shared/content/breaks.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE, YAW_UNITS } from "../../shared/coords.ts";
import { INSTANCE_BYTES, VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { variantAt } from "../../shared/world/breaking.ts";
import { GONE_BLAST, GONE_DESTROYED, GONE_FELL } from "../../shared/world/structures.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { breakCity, wallRow } from "../fixtures/breakcity.ts";
import { farPack } from "../fixtures/farworld.ts";
import { coreRegistry } from "../fixtures/world.ts";

const CAUSES = [GONE_BLAST, GONE_DESTROYED, GONE_FELL];
const kindOf = (reg: Registry, shape: RuinShape, finish: RuinFinish): number => reg.index.get(ruinKind(shape, finish))!;
const corners = (set: BreakSet): unknown => set.groups.map((g) => g.map((c) => c.corners));

/** A break of a piece of `kind` whose set's lowest point stands `up` metres over a floor at 0, begun 3 m off to one side. */
function broken(reg: Registry, kind: number, cause: number, up = 0, yaw = 5000): Broken {
  const sets = new BreakSets(reg), [x, z] = [100, 100];
  const probe = sets.rubble(kind, kind, x, 0, z)!, n = probe.groups.length;
  const y = up - (probe.boxes[n * 6 + 1]! - probe.boxes[n * 6 + 4]!);
  const set = sets.rubble(kind, kind, x, y, z)!;
  return { cause, x, y, z, yaw, ox: x - 2.5, oy: up + 1, oz: z - 1.5, radius: cause === GONE_BLAST ? 7.5 : 0, wait: 0, under: 0, set };
}

/** The corners of the box round group `g` of a break's set, as a pose puts them in the world. */
function boxCorners(e: Broken, g: number, pose: Float64Array): number[] {
  const b = e.set.boxes, out: number[] = [];
  for (let k = 0; k < 8; k++) {
    const x = b[g * 6]! + (k & 1 ? 1 : -1) * b[g * 6 + 3]!, y = b[g * 6 + 1]! + (k & 2 ? 1 : -1) * b[g * 6 + 4]!, z = b[g * 6 + 2]! + (k & 4 ? 1 : -1) * b[g * 6 + 5]!;
    for (let r = 0; r < 3; r++) out.push(pose[r * 4]! * x + pose[r * 4 + 1]! * y + pose[r * 4 + 2]! * z + pose[r * 4 + 3]!);
  }
  return out;
}

/** A near client over a row of walls with pieces falling in it, as the app sets them up. */
function fallingCity(n = 4) {
  const w = breakCity(wallRow(n, 16, 30, ["rose", "mint", "limestone", "concrete"]));
  w.look(16 + n * 2, 30, 18, 7);
  w.scene.near!.pieces = Infinity;
  const falling = (w.scene.falling = new Falling(w.reg.halfY, (x, z) => w.hf.heightAt(x, z), { reg: w.reg, structs: w.structs, mapKind: (chunk, slot) => w.structs.mapKind(chunk, slot) }));
  const t = w.structs.chunks[w.chunk]!;
  /** The piece in `slot` as a removal's rubble tells of it. */
  const rubble = (slot: number, cause: number, tick: number, more: Partial<Rubble> = {}): Rubble => ({ kind: t.kind[slot]!, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, yaw: t.yaw[slot]!, cause, ox: t.x[slot]! - 1, oy: 1, oz: t.z[slot]! - 3, tick, radius: cause === GONE_BLAST ? 7.5 : 0, into: 0, map: w.placed(slot), ...more });
  const mine = (p: FramePacket): number[] => [...Array(p.drawCount).keys()].filter((d) => fragmentSlot(p.drawSlot[d]!));
  return { ...w, falling, t, rubble, mine, stats: (w.scene as unknown as { looseEntities: { fragmentStats: { fine: number; coarse: number; bones: number; draws: number } } }).looseEntities.fragmentStats };
}

test("a breach throws the content's break set for its form and variant", () => {
  const w = fallingCity();
  w.frame();
  const was = w.t.kind[0]!, [x, y, z] = [w.t.x[0]!, w.t.y[0]!, w.t.z[0]!];
  const kind = w.setForm(0, FORM_BREACH_A);
  expect(kind).toBe(formKind(w.reg, was, FORM_BREACH_A, variantAt(x, y, z)));
  w.falling.swap(was, kind, x, y, z, -1);
  w.falling.absorb([], 0, w.cam.x, w.cam.y, w.cam.z, 50);
  const set = w.falling.sets[0]!, things = leavesOf(w.reg, kind)!.things;
  expect([w.falling.count, set.key, w.falling.map[0]]).toEqual([1, kind * 4 + SET_LEAVES, was]);
  expect(set.groups.length).toBe(things.length);
  expect(corners(set)).toEqual(things.map((thing) => thing.map((c) => c.corners)));
  // A row that only lost health, or was set back whole, throws nothing.
  w.falling.swap(kind, kind, x, y, z, -1);
  w.falling.swap(kind, was, x, y, z, -1);
  w.falling.absorb([], 0, w.cam.x, w.cam.y, w.cam.z, 50);
  expect(w.falling.count).toBe(1);
});

test("a piece that left a heap throws its open form's fragments and what stood", () => {
  const reg = coreRegistry(), sets = new BreakSets(reg), map = kindOf(reg, "wall8", "limestone"), [x, y, z] = [40, 1.4, 60];
  const open = formKind(reg, map, FORM_OPEN, variantAt(x, y, z));
  const set = sets.rubble(map, map, x, y, z)!, flat = set.groups.flat().map((c) => c.corners);
  expect([set.key, set.groups.length <= MOST_GROUPS, heapKind(reg, map, variantAt(x, y, z)) !== 0]).toEqual([open * 4 + SET_ALL, true, true]);
  for (const thing of leavesOf(reg, open)!.things) for (const chunk of thing) expect(flat).toContainEqual(chunk.corners);
  // What stood is the open form's look: a box of each of its boxes and its convex parts.
  const def = reg.defs[open]!, shape = reg.defs[reg.index.get((def as { shape: string }).shape)!] as { look?: { boxes?: unknown[]; hulls?: { corners: unknown }[] } };
  for (const hull of shape.look!.hulls!) expect(flat).toContainEqual(hull.corners as (typeof flat)[number]);
  expect(flat.length).toBe(leavesOf(reg, open)!.things.flat().length + (shape.look!.boxes?.length ?? 0) + shape.look!.hulls!.length);
  // A piece already opened throws what stood of it alone, and a breached one what the whole would.
  expect(sets.rubble(open, map, x, y, z)!.groups.flat().length).toBe(flat.length - leavesOf(reg, open)!.things.flat().length);
  expect(sets.rubble(formKind(reg, map, FORM_BREACH_A, 0), map, x, y, z)).toBe(set);
});

test("a set of more than twelve things is joined to twelve, and loses no chunk", () => {
  const reg = coreRegistry(), sets = new BreakSets(reg);
  const open = formKind(reg, kindOf(reg, "floor8", "concrete"), FORM_OPEN, 0), things = leavesOf(reg, open)!.things;
  const set = sets.of(open, SET_LEAVES)!;
  expect([things.length > MOST_GROUPS, set.groups.length, set.groups.flat().length]).toEqual([true, MOST_GROUPS, things.flat().length]);
});

test("a group's pose is the same for the same break and starts where the piece stood", () => {
  const reg = coreRegistry(), a = new Float64Array(POSE.length), b = new Float64Array(POSE.length);
  for (const cause of CAUSES) {
    const e = broken(reg, kindOf(reg, "wall8", "limestone"), cause), turn = (e.yaw / YAW_UNITS) * 2 * Math.PI;
    const poses: string[] = [];
    for (let g = 0; g <= e.set.groups.length; g++) {
      fragmentPose(e, g, 0, 0, a);
      expect(Array.from(a.subarray(0, 12))).toEqual([Math.cos(turn), 0, Math.sin(turn), e.x, 0, 1, 0, e.y, -Math.sin(turn), 0, Math.cos(turn), e.z]);
      fragmentPose(e, g, 0, 1.2, a);
      fragmentPose({ ...e }, g, 0, 1.2, b);
      expect(Array.from(a)).toEqual(Array.from(b));
      poses.push(Array.from(a.subarray(0, 12)).join());
    }
    // Each group goes its own way.
    expect(new Set(poses).size).toBe(poses.length);
  }
});

test("a group moves without a jump, stays over the floor and lies still in time", () => {
  const reg = coreRegistry(), pose = new Float64Array(POSE.length), rest = tierOf("lowpoly").breaks.rest;
  // A wall on the ground, a column, and a slab a storey up.
  for (const [shape, finish, up] of [["wall8", "limestone", 0], ["pier4", "concrete", 0], ["floor8", "concrete", 3]] as const) {
    for (const cause of CAUSES) {
      const e = broken(reg, kindOf(reg, shape, finish), cause, up);
      let jump = 0, low = Infinity, settled = 0;
      for (let g = 0; g <= e.set.groups.length; g++) {
        fragmentPose(e, g, 0, 0, pose);
        let last = boxCorners(e, g, pose);
        for (let ms = 1; ms <= 2600; ms++) {
          fragmentPose(e, g, 0, ms / 1000, pose);
          const now = boxCorners(e, g, pose);
          for (let k = 0; k < 24; k += 3) {
            jump = Math.max(jump, Math.hypot(now[k]! - last[k]!, now[k + 1]! - last[k + 1]!, now[k + 2]! - last[k + 2]!));
            low = Math.min(low, now[k + 1]!);
          }
          last = now;
        }
        settled = Math.max(settled, pose[POSE.settled]!);
        // Past the time it names it does not move, and it lies on a face of its box.
        const lying = Array.from(pose);
        fragmentPose(e, g, 0, pose[POSE.settled]! + 0.001, pose);
        expect(Array.from(pose)).toEqual(lying);
        expect(Math.max(Math.abs(pose[4]!), Math.abs(pose[5]!), Math.abs(pose[6]!))).toBeCloseTo(1, 6);
        expect(pose[POSE.low]!).toBeCloseTo(0, 6);
      }
      expect([shape, cause, jump < 0.03, low > -0.05, settled <= rest]).toEqual([shape, cause, true, true, true]);
    }
  }
});

test("a blast throws outward and up, and a fallen wall tips away from its fall", () => {
  const reg = coreRegistry(), pose = new Float64Array(POSE.length), wall = kindOf(reg, "wall8", "limestone");
  const blast = broken(reg, wall, GONE_BLAST, 0, 0);
  let out = 0, rose = 0;
  for (let g = 0; g < blast.set.groups.length; g++) {
    fragmentPose(blast, g, 0, 0, pose);
    const far = Math.hypot(pose[POSE.centre]! - blast.ox, pose[POSE.centre + 2]! - blast.oz), y0 = pose[POSE.centre + 1]!;
    fragmentPose(blast, g, 0, 0.15, pose);
    if (Math.hypot(pose[POSE.centre]! - blast.ox, pose[POSE.centre + 2]! - blast.oz) > far) out++;
    // In 0.15 s a thing let go drops 11 cm: most are thrown up enough to be higher than that.
    if (pose[POSE.centre + 1]! > y0 - 0.11) rose++;
  }
  expect([out, rose > blast.set.groups.length / 2]).toEqual([blast.set.groups.length, true]);
  // The wall runs along x and the fall began to its -z: every group goes over toward +z, as one wall until it lets go.
  const fell = broken(reg, wall, GONE_FELL, 0, 0), whole = fell.set.groups.length;
  fragmentPose(fell, whole, 0, 0.5, pose);
  const up = [pose[1]!, pose[5]!, pose[9]!];
  expect([up[2]! > 0.2, Math.abs(up[0]!) < 1e-9, up[1]! < 1]).toEqual([true, true, true]);
  for (let g = 0; g < whole; g++) {
    const one = new Float64Array(POSE.length);
    fragmentPose(fell, g, 0, 0.5, one);
    for (let k = 0; k < 12; k++) expect(one[k]!).toBeCloseTo(pose[k]!, 9);
  }
  fragmentPose(fell, whole, 0, 5, pose);
  // It lies flat on the far side: what was its top points along the floor, toward +z.
  expect([Math.abs(pose[5]!) < 1e-9, pose[9]! > 0.97, Math.hypot(pose[1]!, pose[9]!)]).toEqual([true, true, expect.closeTo(1, 9)]);
});

test("a client that hears of a blast a second late draws it where one on time does", () => {
  const first = fallingCity(), late = fallingCity();
  const list = (w: typeof first): Rubble[] => [1, 2].map((slot) => w.rubble(slot, GONE_BLAST, 100));
  const frame = (w: typeof first, clock: number): FramePacket => (w.falling.step(0, clock), w.frame());
  first.falling.absorb(list(first), 0, first.cam.x, first.cam.y, first.cam.z, 100);
  frame(first, 100);
  frame(first, 100 + TICK_RATE / 2);
  late.falling.absorb(list(late), 0, late.cam.x, late.cam.y, late.cam.z, 100 + TICK_RATE);
  const [a, b] = [frame(first, 100 + TICK_RATE), frame(late, 100 + TICK_RATE)];
  const bones = (p: FramePacket, w: typeof first): number[] => w.mine(p).flatMap((d) => {
    const at = p.drawFirst[d]! * INSTANCE_BYTES, bone = new DataView(p.transient.buffer).getUint16(at + 12, true);
    return Array.from(p.bones.subarray(bone * BONE_FLOATS, (bone + MOST_GROUPS) * BONE_FLOATS));
  });
  expect(first.mine(a).length).toBeGreaterThan(0);
  expect(bones(b, late)).toEqual(bones(a, first));
  // Both are a second in: nothing is where it stood.
  const e = first.falling.broken(0), pose = new Float64Array(POSE.length), still = new Float64Array(POSE.length);
  fragmentPose(e, 0, 0, first.falling.since(0), pose);
  fragmentPose(e, 0, 0, 0, still);
  expect([first.falling.since(0), late.falling.since(0), Math.hypot(pose[3]! - still[3]!, pose[11]! - still[11]!) > 0.2]).toEqual([1, 1, true]);
});

test("the pieces of one set are one draw on bones, in the finish the map placed", () => {
  const w = fallingCity();
  for (let f = 0; f < 3; f++) w.frame();
  const before = w.frame().casterCount;
  // Two walls of one shape at places of one variant would share a set; here each is its own.
  w.falling.absorb([0, 1, 2].map((slot) => w.rubble(slot, GONE_DESTROYED, 10)), 0, w.cam.x, w.cam.y, w.cam.z, 10);
  w.falling.step(0, 10 + TICK_RATE / 4);
  const p = w.frame(), draws = w.mine(p), sets = new Set([0, 1, 2].map((i) => w.falling.sets[i]!.key));
  expect([draws.length, w.stats.draws, w.stats.fine, w.stats.coarse]).toEqual([sets.size, sets.size, 3, 0]);
  expect(draws.reduce((sum, d) => sum + p.drawInstances[d]!, 0)).toBe(3);
  expect(w.stats.bones).toBe([0, 1, 2].reduce((sum, i) => sum + w.falling.sets[i]!.groups.length, 0));
  for (const d of draws) expect([p.drawBuffer[d], p.drawFlags[d]! & (DRAW_SKINNED | DRAW_ONE_BONE)]).toEqual([TRANSIENT_BUFFER, DRAW_SKINNED]);
  // Each instance is dyed as the wall the map placed: its colour, then its soffit's.
  const finishes = draws.flatMap((d) => Array.from({ length: p.drawInstances[d]! }, (_, k) => [p.transient[(p.drawFirst[d]! + k) * INSTANCE_BYTES + 14]!, p.transient[(p.drawFirst[d]! + k) * INSTANCE_BYTES + 15]!].join()));
  expect(finishes.sort()).toEqual([RUIN_FINISHES.rose, RUIN_FINISHES.mint, RUIN_FINISHES.limestone].map((f) => [f.color, f.under].join()).sort());
  // Nothing stood in the store was taken, so the casters are what they were: fragments add none.
  expect(p.casterCount).toBe(before);
  // The software rasterizer draws them.
  const raster = new Rasterizer(160, 90, farPack(), w.hf), again = fallingCity(1);
  raster.take(again.frame());
  again.falling.absorb([again.rubble(0, GONE_DESTROYED, 10)], 0, again.cam.x, again.cam.y, again.cam.z, 10);
  again.falling.step(0, 10 + TICK_RATE / 4);
  const q = again.frame(), drawn = new Set(again.mine(q));
  raster.render(q);
  expect(raster.pickDraw.filter((d) => drawn.has(d)).length).toBeGreaterThan(20);
});

test("a player's piece still falls whole", () => {
  const w = fallingCity();
  w.frame();
  const wall = w.reg.index.get("core:wall")!;
  w.falling.absorb([w.rubble(0, GONE_FELL, 10, { kind: wall, map: 0 }), w.rubble(1, GONE_FELL, 10, { map: 0 })], 0, w.cam.x, w.cam.y, w.cam.z, 10);
  w.falling.step(100, 10);
  expect([w.falling.count, w.falling.sets[0], w.falling.sets[1], w.falling.y[0]! < w.t.y[0]!]).toEqual([2, null, null, true]);
  const p = w.frame();
  expect([w.mine(p).length, w.stats.bones, p.boneCount]).toEqual([0, 0, 0]);
  const whole = [...Array(p.drawCount).keys()].filter((d) => p.drawBuffer[d] === TRANSIENT_BUFFER);
  expect(whole.map((d) => p.drawFlags[d]! & DRAW_SKINNED)).toEqual([0, 0]);
});

test("a fragment mesh's skin is the instance's colour and its bared faces the core's", () => {
  const reg = coreRegistry(), sets = new BreakSets(reg), map = kindOf(reg, "wall8", "limestone");
  const set = sets.of(formKind(reg, map, FORM_BREACH_A, 0), SET_LEAVES)!, mesh = fragmentMesh(set);
  const at = (mesh.indexCount * 2 + 3) & ~3, count = (mesh.data.length - at) / VERTEX_BYTES;
  const colours = new Map<number, number>(), groups = new Set<number>();
  for (let v = 0; v < count; v++) {
    colours.set(mesh.data[at + v * VERTEX_BYTES + 6]!, (colours.get(mesh.data[at + v * VERTEX_BYTES + 6]!) ?? 0) + 1);
    groups.add(mesh.data[at + v * VERTEX_BYTES + 7]!);
  }
  // Shards of a wall: skin in the instance's first colour, the wall's foot in its second, what the cut made in the core's.
  expect([...colours.keys()].sort()).toEqual([CORE_COLOUR, REGION_BASE, REGION_BASE + 1]);
  expect(colours.get(REGION_BASE)!).toBeGreaterThan(0);
  expect(colours.get(CORE_COLOUR)!).toBeGreaterThan(colours.get(REGION_BASE)!);
  expect([...groups].sort((a, b) => a - b)).toEqual(set.groups.map((_, g) => g));
  // A slab's soffit is the instance's second colour, and every vertex is back where content put it to a millimetre.
  const slab = sets.of(formKind(reg, kindOf(reg, "floor8", "concrete"), FORM_OPEN, 0), SET_ALL)!, made = fragmentMesh(slab);
  const from = (made.indexCount * 2 + 3) & ~3, view = new DataView(made.data.buffer), points = slab.groups.flat().flatMap((c) => c.corners);
  let soffit = 0, off = 0;
  for (let v = 0; v < (made.data.length - from) / VERTEX_BYTES; v++) {
    if (made.data[from + v * VERTEX_BYTES + 6] === REGION_BASE + 1) soffit++;
    const p = [0, 1, 2].map((a) => made.bounds.center[a]! + (view.getInt16(from + v * VERTEX_BYTES + a * 2, true) / 32767) * made.bounds.half[a]!);
    off = Math.max(off, Math.min(...points.map((c) => Math.hypot(c[0] - p[0]!, c[1] - p[1]!, c[2] - p[2]!))));
  }
  expect([soffit > 0, off < 0.001]).toEqual([true, true]);
});

test("a wave of pieces keeps to its tier's pieces, bones and draws", () => {
  const w = fallingCity(), reg = w.reg;
  const kinds = (["wall4", "wall8", "floor8", "pier4", "beam8"] as const).flatMap((shape) => (["concrete", "limestone"] as const).map((finish) => reg.index.get(ruinKind(shape, finish)))).filter((k): k is number => k !== undefined && reg.breakSet[k] !== 0);
  expect(kinds.length).toBeGreaterThan(5);
  // 1,280 pieces of a tower falling, in view, 40 a storey: more than any tier keeps.
  const wave = (tick: number): Rubble[] => Array.from({ length: 1280 }, (_, i): Rubble => {
    const x = w.t.x[0]! + (i % 8) * 4, y = 2 + Math.floor(i / 40) * 3, z = w.t.z[0]! + 6 + (Math.floor(i / 8) % 5) * 4;
    return { kind: kinds[i % kinds.length]!, x, y, z, yaw: (i % 4) * 16384, cause: GONE_FELL, ox: w.t.x[0]! + 14, oy: 0, oz: w.t.z[0]! + 14, tick, radius: 0, into: 0, map: kinds[i % kinds.length]! };
  });
  [w.cam.y, w.cam.z, w.cam.pitch] = [40, w.cam.z - 60, 0.1];
  let clock = 1000;
  for (const [name, touch] of [["lowpoly", false], ["medium", false], ["medium", true], ["high", false], ["ultra", false]] as const) {
    const tier = (w.scene.assets.tier = forTouch(tierOf(name), touch)), caps = tier.breaks;
    // The frames before a wave tell the falling pieces their tier, and what casts with nothing falling.
    w.falling.step(0, (clock += 100 * TICK_RATE));
    for (let f = 0; f < 3; f++) w.frame();
    const casters = w.frame().casterCount;
    expect(w.falling.count).toBe(0);
    w.falling.absorb(wave(clock), 0, w.cam.x, w.cam.y, w.cam.z, clock);
    expect([name, touch, w.falling.count, w.falling.taken % 1280]).toEqual([name, touch, caps.pieces, 0]);
    let most = { shown: 0, bones: 0, draws: 0 };
    for (let f = 0; f < 12; f++) {
      w.falling.step(0, (clock += 2));
      const p = w.frame(), draws = w.mine(p);
      expect(draws.length).toBe(w.stats.draws);
      expect(draws.reduce((sum, d) => sum + p.drawInstances[d]!, 0)).toBe(w.stats.fine + w.stats.coarse);
      expect([w.stats.fine + w.stats.coarse <= caps.pieces, w.stats.bones <= caps.bones, p.boneCount <= caps.bones, w.stats.draws <= caps.draws, p.casterCount]).toEqual([true, true, true, true, casters]);
      expect(w.scene.assets.residency.reserved).toBeGreaterThan(0);
      most = { shown: Math.max(most.shown, w.stats.fine + w.stats.coarse), bones: Math.max(most.bones, w.stats.bones), draws: Math.max(most.draws, w.stats.draws) };
    }
    // Every piece the bones reach is drawn: the nearest a bone a group, the rest as one thing each on a bone.
    expect([most.shown, most.bones > caps.bones - MOST_GROUPS, w.stats.fine > 0]).toEqual([Math.min(caps.pieces, caps.bones - MOST_GROUPS), true, caps.bones > caps.pieces]);
  }
  // No more meshes are kept than the cache holds, each in a slot of the fragments' own.
  const held = (w.scene as unknown as { looseEntities: { fragments: { count: number } } }).looseEntities.fragments.count;
  expect([held > 0, held <= MOST_MESHES, FRAGMENT_SLOTS >= 2 ** 30]).toEqual([true, true, true]);
});

test("a fall's front reaches a piece in fragments 25 ms a metre later, 1.5 s at most", () => {
  const w = fallingCity();
  w.frame();
  // Three walls 4 m apart along x, the fall begun 2 m before the first, and one far down the street.
  const from = { ox: w.t.x[0]! - 2, oy: w.t.y[0]!, oz: w.t.z[0]! };
  w.falling.absorb([w.rubble(0, GONE_FELL, 40, from), w.rubble(1, GONE_FELL, 40, from), w.rubble(2, GONE_FELL, 40, from), w.rubble(3, GONE_FELL, 40, { ...from, ox: from.ox - 500 })], 0, w.cam.x, w.cam.y, w.cam.z, 40);
  expect([0, 1, 2, 3].map((i) => w.falling.broken(i).wait)).toEqual([0, (4 * FRONT_MS_PER_METRE) / 1000, (8 * FRONT_MS_PER_METRE) / 1000, MAX_FRONT_MS / 1000].map((v) => expect.closeTo(v, 5)));
  // Until its turn a piece stands as it stood.
  const e = { ...w.falling.broken(1) }, pose = new Float64Array(POSE.length);
  fragmentPose(e, 0, 0, e.wait, pose);
  expect([pose[3], pose[7], pose[11]]).toEqual([e.x, e.y, e.z]);
  fragmentPose(e, 0, 0, e.wait + 0.3, pose);
  expect(pose[5]!).toBeLessThan(1);
});

test("fragments shrink out after the tier's rest time and are forgotten", () => {
  const w = fallingCity();
  w.frame();
  const rest = w.scene.assets.tier.breaks.rest;
  w.falling.absorb([w.rubble(0, GONE_DESTROYED, 10)], 0, w.cam.x, w.cam.y, w.cam.z, 10);
  const at = (seconds: number): number => (w.falling.step(0, 10 + seconds * TICK_RATE), w.falling.count === 0 ? -1 : w.falling.share(0));
  expect([at(1), at(rest), at(rest + SHRINK / 2)]).toEqual([1, 1, 0.5].map((v) => expect.closeTo(v, 6)));
  // Half gone, each group is drawn at half its size.
  const p = w.frame(), d = w.mine(p)[0]!, bone = new DataView(p.transient.buffer).getUint16(p.drawFirst[d]! * INSTANCE_BYTES + 12, true) * BONE_FLOATS;
  expect(Math.hypot(p.bones[bone]!, p.bones[bone + 4]!, p.bones[bone + 8]!)).toBeCloseTo(0.5, 5);
  expect([at(rest + SHRINK + 0.01), w.mine(w.frame()).length]).toEqual([-1, 0]);
});
