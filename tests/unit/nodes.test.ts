import { expect, test } from "bun:test";
import { CHUNK_SIZE, TICK_DT, chunkCx, chunkCz } from "../../shared/coords.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { Rng } from "../../shared/rng.ts";
import { Body, STANCE_STAND, stanceEye, stepBody } from "../../shared/sim/character.ts";
import { ROUTE_MARGIN } from "../../server/behavior.ts";
import { SKIN, capsuleFree, capsuleKind, groundUnder } from "../../shared/world/collide.ts";
import { NodeField, SIZE_STEPS, SIZE_UNITS, mix, nodeForms, scatterNodes, type NodeSpot } from "../../shared/world/nodes.ts";
import { PROVING_DIMS, PROVING_NODES_PER_CHUNK, PROVING_SEA_LEVEL, buildProvingHeightfield, provingNodeLayers, provingNodes } from "../../shared/world/proving.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { nodeLayers, type NodeZoned } from "../../shared/world/mapfile.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { Def, NodeDef } from "../../shared/content/defs.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { HIT_NODE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { variantRegistry } from "../fixtures/nodes.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const forms = nodeForms(reg);
const hf = buildProvingHeightfield();
const CHUNKS = PROVING_DIMS.chunksX * PROVING_DIMS.chunksZ;
const field = (): NodeField => new NodeField(PROVING_DIMS, reg, provingNodes(hf, reg));
const kind = (id: string) => reg.index.get(id)!;
const spot = (): NodeSpot => ({ kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 });
const KINDS = ["core:tree", "core:oak", "core:palm", "core:fig", "core:banyan", "core:mangrove", "core:rock", "core:rubble", "core:metal_rock", "core:bush", "core:palmetto", "core:fern", "core:seagrape", "core:creeper"];

test("where nodes stand is a pure function of the map: the same every time, dry, off the plaza, on the ground, and of every kind", () => {
  const a = provingNodes(hf, reg);
  const b = provingNodes(buildProvingHeightfield(), coreRegistry());
  const [sa, sb] = [spot(), spot()];
  const counts = new Map<number, number>();
  const sizes = new Set<number>();
  expect(a.perChunk).toBe(144);
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    for (let i = 0; i < a.perChunk; i++) {
      a.at(chunk, i, sa);
      b.at(chunk, i, sb);
      expect(sa.kind === 0 ? [0] : [sa.kind, sa.form, sa.x, sa.y, sa.z, sa.yaw]).toEqual(sb.kind === 0 ? [0] : [sb.kind, sb.form, sb.x, sb.y, sb.z, sb.yaw]);
      if (sa.kind === 0) continue;
      counts.set(sa.kind, (counts.get(sa.kind) ?? 0) + 1);
      expect([forms.kind[sa.form], forms.depleted[sa.form]]).toEqual([sa.kind, 0]);
      if (sa.kind === kind("core:tree")) sizes.add(forms.size[sa.form]!);
      expect(hf.heightAt(sa.x, sa.z)).toBeGreaterThan(PROVING_SEA_LEVEL);
      expect(sa.y).toBe(hf.heightAt(sa.x, sa.z)); // its origin is the ground under it
      expect(Math.max(Math.abs(sa.x - 256), Math.abs(sa.z - 256))).toBeGreaterThan(96);
    }
  }
  const total = [...counts.values()].reduce((x, y) => x + y, 0);
  expect(total).toBeGreaterThan(2500);
  for (const id of ["core:tree", "core:rock", "core:bush"]) expect(counts.get(kind(id))!).toBeGreaterThan(200);
  // The big trees are few: elder oaks among the figs, and banyans only where the ground is level enough for their trunks.
  for (const id of KINDS) expect(counts.get(kind(id)) ?? 0).toBeGreaterThan(id === "core:banyan" ? 15 : 20);
  // Every young live oak is one of sixteen sizes from 0.4 to 0.75 of its model.
  expect([...sizes].sort((x, y) => x - y)).toEqual(Array.from({ length: SIZE_STEPS }, (_, s) => Math.round((0.4 + (0.35 * s) / 15) * SIZE_UNITS)));
});

test("a world saved before the new kinds came keeps every node where it was and of its kind: the first 96 slots are as they were, but where a rock's footing fails", () => {
  // The rule as it stood: a slot's place and its kind and turn from two hashes, trees, rocks and bushes 5, 3 and 3 beyond the plaza.
  const kinds = [...Array(5).fill(kind("core:tree")), ...Array(3).fill(kind("core:rock")), ...Array(3).fill(kind("core:bush"))] as number[];
  const was = (chunk: number, index: number): number[] => {
    const h = mix(0x51ab, chunk, index);
    const g = mix(h, index, chunk);
    const x = (chunkCx(PROVING_DIMS, chunk) + (h & 0xffff) / 65536) * CHUNK_SIZE;
    const z = (chunkCz(PROVING_DIMS, chunk) + (h >>> 16) / 65536) * CHUNK_SIZE;
    if (Math.max(Math.abs(Math.floor(x) + 0.5 - 256), Math.abs(Math.floor(z) + 0.5 - 256)) <= 99) return [0];
    if (hf.heightAt(x, z) < PROVING_SEA_LEVEL + 0.3 || hf.slopeCosAt(x, z) < 0.85) return [0];
    return [kinds[g % kinds.length]!, x, z, (g >>> 8) & 0xffff];
  };
  const now = provingNodes(hf, reg);
  const s = spot();
  let standing = 0;
  let footless = 0;
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    for (let i = 0; i < PROVING_NODES_PER_CHUNK; i++) {
      now.at(chunk, i, s);
      const before = was(chunk, i);
      // A rock grows nowhere the ground falls away under its base further than the base is buried.
      if (s.kind === 0 && before[0] === kind("core:rock")) footless++;
      else expect(s.kind === 0 ? [0] : [s.kind, s.x, s.z, s.yaw]).toEqual(before);
      if (s.kind !== 0) standing++;
    }
  }
  expect([standing > 1500, footless]).toEqual([true, 73]);
});

test("the zoned layer's slots keep their places and kinds: an elder oak grows only where the ground was bare, a strangler fig only where a banyan's footing fails, and nothing where a heap's or a metal rock's does", () => {
  // The zones as they were, without the elder oak, and the content without footings.
  const layers = provingNodeLayers(hf);
  const zoned = layers[1] as NodeZoned;
  const before = [layers[0]!, { ...zoned, zones: zoned.zones.map((z) => ({ bare: z.bare + z.kinds.filter(([id]) => id === "core:oak").length, kinds: z.kinds.filter(([id]) => id !== "core:oak") })) }];
  const level = compileContent(CORE_CONTENT.map((d) => (d.type === "node" ? { ...d, footing: undefined } : d))).registry!;
  const was = nodeLayers(PROVING_DIMS, hf, level, before)!;
  const now = provingNodes(hf, reg);
  const [a, b] = [spot(), spot()];
  const changed = new Map<string, number>();
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    for (let i = PROVING_NODES_PER_CHUNK; i < now.perChunk; i++) {
      was.at(chunk, i, a);
      now.at(chunk, i, b);
      if (a.kind === b.kind) {
        if (a.kind !== 0) expect([b.x, b.y, b.z, b.yaw]).toEqual([a.x, a.y, a.z, a.yaw]);
        continue;
      }
      const key = `${a.kind === 0 ? "bare" : level.ids[a.kind]} to ${b.kind === 0 ? "bare" : reg.ids[b.kind]}`;
      changed.set(key, (changed.get(key) ?? 0) + 1);
      if (a.kind !== 0 && b.kind !== 0) expect([b.x, b.y, b.z, b.yaw]).toEqual([a.x, a.y, a.z, a.yaw]);
    }
  }
  // Of the 25 banyans, 6 stood where the ground falls away under their outer trunks further than they are buried; of the
  // 97 heaps of rubble 22, and of the 30 metal rocks 5, where it falls away under their bases.
  expect(Object.fromEntries(changed)).toEqual({ "bare to core:oak": 44, "core:banyan to core:fig": 6, "core:rubble to bare": 22, "core:metal_rock to bare": 5 });
});

test("a kind with a footing grows only where the ground under it falls no further than it allows, and the kind it names elsewhere", () => {
  // Level ground at 10 m with a cliff down to 4 m at x = 100. A boulder's footing reaches 3 m and allows a fall of 0.5 m.
  const vreg = variantRegistry();
  const dims = { chunksX: 4, chunksZ: 2 };
  const cliff = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < cliff.nz; j++) for (let i = 0; i < cliff.nx; i++) cliff.setSample(i, j, i * cliff.cell < 100 ? 10 : 4);
  const [boulder, shrub] = ["test:boulder", "test:shrub"].map((id) => vreg.index.get(id)!);
  const source = scatterNodes(dims, cliff, 3, 256, nodeForms(vreg), () => [boulder!]);
  const s = spot();
  const kinds = new Map<string, number>();
  for (let chunk = 0; chunk < 8; chunk++) {
    for (let i = 0; i < 256; i++) {
      source.at(chunk, i, s);
      if (s.kind === 0 || s.x > 99 || s.x < 92 || cliff.slopeCosAt(s.x, s.z) < 1) continue;
      // Above the cliff: within its reach of the edge a shrub, and a boulder further back. Its reach is counted in whole
      // samples of 2 m, from the sample nearest the origin.
      const key = `${s.x > 97 ? "near" : s.x < 94 ? "back" : "between"} ${s.kind === boulder ? "boulder" : s.kind === shrub ? "shrub" : s.kind}`;
      kinds.set(key, (kinds.get(key) ?? 0) + 1);
    }
  }
  expect([...kinds.keys()].sort()).toEqual(["back boulder", "between boulder", "between shrub", "near shrub"]);
});

test("each node is one of its kind's variants by weight, at one of its sizes, turned every way", () => {
  const vreg = variantRegistry();
  const vforms = nodeForms(vreg);
  const palm = vreg.index.get("test:palm")!;
  const source = scatterNodes(PROVING_DIMS, hf, 99, 256, vforms, () => [palm]);
  const s = spot();
  const variants = [0, 0, 0];
  const sizes = new Set<number>();
  const quarters = [0, 0, 0, 0];
  let n = 0;
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    for (let i = 0; i < 256; i++) {
      source.at(chunk, i, s);
      if (s.kind === 0) continue;
      n++;
      variants[vforms.variant[s.form]!]!++;
      sizes.add(vforms.size[s.form]!);
      quarters[s.yaw >>> 14]!++;
    }
  }
  // Weights 1, 3 and 2.
  expect(variants.map((v) => Math.round((v / n) * 12))).toEqual([2, 6, 4]);
  expect([...sizes].sort((x, y) => x - y)).toEqual(Array.from({ length: 16 }, (_, k) => Math.round((0.6 + (1.1 * k) / 15) * SIZE_UNITS)));
  for (const q of quarters) expect(Math.abs(q / n - 0.25)).toBeLessThan(0.02);
});

test("a node's boxes turn and grow with its picture: what the shader draws at a place is what bodies and rays meet there", () => {
  const vreg = variantRegistry();
  const vforms = nodeForms(vreg);
  const palm = vreg.index.get("test:palm")!;
  const f = new NodeField(PROVING_DIMS, vreg, scatterNodes(PROVING_DIMS, hf, 5, 64, vforms, (x, z) => (Math.max(Math.abs(x - 256), Math.abs(z - 256)) > 100 ? [palm, 0, 0, 0] : null)));
  f.retain(0, 16, 1, () => false);
  const world = { hf, structs: new StructureStore(PROVING_DIMS, vreg.halfX, vreg.halfY, vreg.halfZ, null, vreg.parts), nodes: f.store };
  const s = spot();
  let checked = 0;
  let crowded = 0;
  for (let chunk = 0; chunk < CHUNKS && checked < 40; chunk++) {
    for (let i = 0; i < 64 && checked < 40; i++) {
      f.source.at(chunk, i, s);
      // The second palm leans: its upper box stands 0.8 m out along its own x and 0.3 m along its z, 4 m up.
      if (s.kind !== palm || vforms.variant[s.form] !== 1) continue;
      const k = vforms.size[s.form]! / SIZE_UNITS;
      // Where FLAT_MESH_VERTEX puts the middle of that box: the mesh point sized, then turned by the instance's yaw.
      const a = (s.yaw / 65536) * TAU;
      const [lx, ly, lz] = [0.8 * k, 4 * k, 0.3 * k];
      const at = [Math.cos(a) * lx + Math.sin(a) * lz + s.x, ly + s.y, Math.cos(a) * lz - Math.sin(a) * lx + s.z];
      // A look straight down onto it from above meets the node there, at the top of that box.
      expect(castWorld(world, at[0]!, at[1]! + 3, at[2]!, 0, -1, 0, 3)).toBe(HIT_NODE);
      expect([rayHit.ref, rayHit.t]).toEqual([chunk * 65536 + i, expect.closeTo(3 - k, 2)]);
      // A body's head there is in it. The same place across the trunk is in nothing, unless another palm stands there.
      expect(capsuleFree(world, at[0]!, at[1]! - 1.5, at[2]!, 0.1, 1.6)).toBe(false);
      if (castWorld(world, 2 * s.x - at[0]!, at[1]! + 3, 2 * s.z - at[2]!, 0, -1, 0, 3.5) === HIT_NODE) crowded++;
      checked++;
    }
  }
  expect([checked, crowded < 4]).toEqual([40, true]);
});

test("the node store holds only chunks someone is near, minus what is used up", () => {
  // Every kind leaves something used up, so the rocks here leave nothing.
  const bare = compileContent(CORE_CONTENT.map((d): Def => (d.id === "core:rock" && d.type === "node" ? { ...d, variants: d.variants!.map(({ mesh, weight, boxes }) => ({ mesh, weight, boxes })) } : d))).registry!;
  const forms = nodeForms(bare);
  const f = new NodeField(PROVING_DIMS, bare, provingNodes(hf, bare));
  const used = new Set<string>();
  const gone = (chunk: number, i: number) => used.has(`${chunk}:${i}`);
  expect(f.store.count).toBe(0);
  f.retain(27, 1, 1, gone); // a 3 by 3 block of chunks
  const one = f.store.count;
  expect(one).toBeGreaterThan(50);
  expect(f.isLoaded(27)).toBe(true);
  expect(f.isLoaded(0)).toBe(false);
  f.retain(28, 1, 1, gone); // The shared chunks are not filled twice.
  const two = f.store.count;
  expect(two).toBeGreaterThan(one);
  expect(two).toBeLessThan(one * 2);
  f.retain(27, 1, -1, gone);
  expect(f.isLoaded(27)).toBe(true); // still held by the second
  f.retain(28, 1, -1, gone);
  expect(f.store.count).toBe(0);

  // A used-up node of a kind with nothing left of it (a rock) is left out when its chunk is filled. While the chunk is filled,
  // set() puts it back and takes it out.
  const t = f.store;
  f.retain(9, 0, 1, gone);
  const slot = [...Array(PROVING_NODES_PER_CHUNK).keys()].find((i) => t.chunks[9]!.kind[i] !== 0 && forms.left[t.chunks[9]!.kind[i]!] === 0)!;
  const was = t.chunks[9]!.kind[slot]!;
  f.retain(9, 0, -1, gone);
  used.add(`9:${slot}`);
  f.retain(9, 0, 1, gone);
  expect(t.chunks[9]!.kind[slot]).toBe(0);
  f.set(9, slot, true);
  expect(t.chunks[9]!.kind[slot]).toBe(was);
  expect(t.chunks[9]!.hp[slot]).toBe(bare.nodeHits[forms.kind[was]!]!);
  f.set(9, slot, false);
  expect(t.chunks[9]!.kind[slot]).toBe(0);
  f.set(3, 0, true); // The chunk is not filled, so nothing happens.
  expect(f.isLoaded(3)).toBe(false);
  expect(f.kindAt(9, slot)).toBe(forms.kind[was]); // what the map says is there, used up or not
});

test("what is left of a used-up node stands where it was, at its size and turn, is met by bodies and rays, and gives nothing", () => {
  const vreg = variantRegistry();
  const vforms = nodeForms(vreg);
  const [palm, shrub] = ["test:palm", "test:shrub"].map((id) => vreg.index.get(id)!);
  const f = new NodeField(PROVING_DIMS, vreg, scatterNodes(PROVING_DIMS, hf, 6, 64, vforms, () => [palm!, shrub!]));
  const used = new Set<number>();
  f.retain(27, 1, 1, (chunk, i) => used.has(chunk * 256 + i));
  const world = { hf, structs: new StructureStore(PROVING_DIMS, vreg.halfX, vreg.halfY, vreg.halfZ, null, vreg.parts), nodes: f.store };
  const t = f.store.chunks[27]!;
  const s = spot();
  const seen = new Set<string>();
  for (let i = 0; i < 64; i++) {
    f.source.at(27, i, s);
    if (s.kind === 0) continue;
    const live = t.kind[i]!;
    expect([live, f.standing(27, i)]).toEqual([s.form, s.kind]);
    f.set(27, i, false);
    const left = t.kind[i]!;
    seen.add(`${vforms.kind[s.form]}/${vforms.variant[s.form]}`);
    if (s.kind === shrub) {
      // A stripped shrub has a mesh and no boxes: it is drawn, walked through and not looked at.
      expect([vforms.depleted[left], vforms.mesh[left], vforms.parts.start[left + 1]! - vforms.parts.start[left]!]).toEqual([1, "test:shrub_depleted", 0]);
    } else {
      // The third palm leaves its own stump, and the others the kind's. Each is as large and turned as the palm was.
      expect([vforms.depleted[left], vforms.mesh[left], vforms.size[left], vforms.variant[left]]).toEqual([1, vforms.variant[s.form] === 2 ? "test:palm_3_depleted" : "test:palm_depleted", vforms.size[s.form], vforms.variant[s.form]]);
      expect([t.x[i], t.y[i], t.z[i], t.yaw[i], t.hp[i]]).toEqual([Math.fround(s.x), Math.fround(s.y), Math.fround(s.z), s.yaw, 0]);
      const k = vforms.size[left]! / SIZE_UNITS;
      // The stump's top is 0.6 or 0.8 m up at size 1. A look down at the trunk's foot meets it there.
      const top = (vforms.variant[s.form] === 2 ? 0.8 : 0.6) * k;
      const a = (s.yaw / 65536) * TAU;
      const [lx, lz] = vforms.variant[s.form] === 2 ? [-0.3 * k, 0.1 * k] : [0, 0];
      const x = Math.cos(a) * lx + Math.sin(a) * lz + s.x;
      const z = Math.cos(a) * lz - Math.sin(a) * lx + s.z;
      expect(castWorld(world, x, s.y + 3, z, 0, -1, 0, 3)).toBe(HIT_NODE);
      expect([rayHit.ref, rayHit.t]).toEqual([27 * 65536 + i, expect.closeTo(3 - top, 2)]);
    }
    expect(f.standing(27, i)).toBe(0);
    // Grown back, it is the same palm as before.
    f.set(27, i, true);
    expect([t.kind[i], t.hp[i]]).toEqual([live, vreg.nodeHits[s.kind]]);
    // A chunk filled again shows what is left of a used-up node.
    used.add(27 * 256 + i);
  }
  expect([...seen].sort()).toEqual([`${palm}/0`, `${palm}/1`, `${palm}/2`, `${shrub}/0`]);
  f.retain(27, 1, -1, () => false);
  f.retain(27, 1, 1, (chunk, i) => used.has(chunk * 256 + i));
  for (let i = 0; i < 64; i++) {
    f.source.at(27, i, s);
    if (s.kind !== 0) expect(f.store.chunks[27]!.kind[i]).toBe(vforms.left[s.form]);
  }
});

test("trees stop a body, rocks stop it or are climbed, bushes do not, and a ray finds every kind", () => {
  const f = field();
  f.retain(0, 16, 1, () => false);
  const world = { hf, structs: new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: f.store };
  const p = reg.move[kind("core:survivor")]!;
  const s = spot();
  const seen = new Set<number>();
  for (let chunk = 0; chunk < CHUNKS && seen.size < KINDS.length; chunk++) {
    for (let i = 0; i < f.source.perChunk; i++) {
      f.source.at(chunk, i, s);
      if (s.kind === 0 || seen.has(s.kind)) continue;
      // Pick one with level ground to its south, so a body can walk straight at it. A body stands where its lower sphere rests.
      const reach = forms.halfZ[s.form]! + p.radius + 0.6;
      const ground = groundUnder(hf, s.x, s.z, p.radius);
      const south = groundUnder(hf, s.x, s.z - reach, p.radius);
      if (Math.abs(south - ground) > 0.3 || !capsuleFree(world, s.x, south, s.z - reach, p.radius, p.height)) continue;
      seen.add(s.kind);
      const soft = reg.soft[s.kind] === 1;
      expect(capsuleFree(world, s.x, ground, s.z, p.radius, p.height)).toBe(soft);
      const b = new Body();
      b.x = s.x;
      b.z = s.z - reach;
      b.y = south;
      b.grounded = true;
      let closest = Infinity;
      let rose = 0;
      for (let t = 0; t < 90; t++) {
        stepBody(world, b, 0, 127, 0, 0, 0, p, TICK_DT);
        if (!capsuleFree(world, b.x, b.y, b.z, p.radius, p.height)) throw new Error("in solid");
        closest = Math.min(closest, Math.hypot(b.x - s.x, b.z - s.z));
        rose = Math.max(rose, b.y - groundUnder(hf, b.x, b.z, p.radius));
      }
      // A bush is walked through. A tree stops the body or turns it aside before its trunk. A rock does, or the body
      // climbs onto it where its boxes rise in steps it can take.
      if (soft) expect([closest < 0.5, b.z > s.z + 2]).toEqual([true, true]);
      else if (reg.defs[s.kind]?.type === "node" && (reg.defs[s.kind] as NodeDef).material === "stone") expect(closest > p.radius || rose > 0.1).toBe(true);
      else expect(closest).toBeGreaterThan(p.radius);
      // A look level with the middle of its first box, which stands on its origin, from in front of it.
      const first = forms.parts.start[s.form]! * 6;
      expect(castWorld(world, s.x, s.y + forms.parts.box[first + 1]!, s.z - reach, 0, 0, 1, reach + 1)).toBe(HIT_NODE);
      expect(rayHit.ref).toBe(chunk * 65536 + i);
    }
  }
  expect(seen.size).toBe(KINDS.length);
});

test("a live oak, young or elder, stops a body at its trunk alone, which a swing reaches, and a banyan at each of its trunks, with free ground between", () => {
  const f = field();
  f.retain(0, 16, 1, () => false);
  const world = { hf, structs: new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: f.store };
  const p = reg.move[kind("core:survivor")]!;
  const s = spot();
  const box = forms.parts.box;
  /** Where box `b` of the form at the spot stands: its middle across, and its foot. */
  const placed = (b: number): [number, number, number] => {
    const a = (s.yaw / 65536) * TAU;
    const [lx, lz] = [box[b * 6]!, box[b * 6 + 2]!];
    return [Math.cos(a) * lx + Math.sin(a) * lz + s.x, s.y + box[b * 6 + 1]! - box[b * 6 + 4]!, Math.cos(a) * lz - Math.sin(a) * lx + s.z];
  };
  const meets = (x: number, y: number, z: number): boolean => capsuleKind(forms.parts, s.form, s.x, s.y, s.z, s.yaw, x, y, z, p.radius, p.height, SKIN);
  let [oaks, elders, banyans] = [0, 0, 0];
  for (let chunk = 0; chunk < CHUNKS && (oaks < 20 || elders < 10 || banyans < 5); chunk++) {
    for (let i = 0; i < f.source.perChunk; i++) {
      f.source.at(chunk, i, s);
      const [first, end] = [forms.parts.start[s.form]!, forms.parts.start[s.form + 1]!];
      const elder = s.kind === kind("core:oak");
      if ((s.kind === kind("core:tree") && oaks < 20) || (elder && elders < 10)) {
        if (elder) elders++;
        else oaks++;
        // One box, its trunk, 0.6 to 1.6 m across or an elder's 1.3 to 2.5: a body cannot stand in it, and stands free of it
        // under its limbs.
        expect([forms.mesh[s.form]!.startsWith("core:tree_"), end - first]).toEqual([true, 1]);
        expect(meets(s.x, s.y, s.z)).toBe(true);
        for (let k = 0; k < 8; k++) for (const d of [2.5, 6, 9]) expect(meets(s.x + Math.sin((k * TAU) / 8) * d, s.y, s.z + Math.cos((k * TAU) / 8) * d)).toBe(false);
        // A survivor beside it, looking at the middle of its trunk, meets it well within the 3.5 m a use or a swing reaches. A
        // young oak's trunk forks below a survivor's eyes, and its limbs are not met.
        const alone = new StructureStore(PROVING_DIMS, forms.halfX, forms.halfY, forms.halfZ, forms.soft, forms.parts);
        alone.put(chunk, i, s.form, s.x, s.y, s.z, s.yaw, 0, 1, 1);
        const back = box[first * 6 + 3]! + p.radius + 0.3;
        const eye = hf.heightAt(s.x, s.z - back) + 1.62;
        const down = s.y + box[first * 6 + 1]! - eye;
        const far = Math.hypot(back, down);
        expect(castWorld({ hf, structs: world.structs, nodes: alone }, s.x, eye, s.z - back, 0, down / far, back / far, 3.5)).toBe(HIT_NODE);
        expect([rayHit.ref, rayHit.t < far]).toEqual([chunk * 65536 + i, true]);
      }
      if (s.kind === kind("core:banyan") && banyans < 5) {
        banyans++;
        // Its middle trunk and each it let down from its limbs, as far as 12 m out, stop a body standing at its foot, in the
        // node store as in its own boxes. Half way from the middle to each, the ground is free of it.
        expect(end - first).toBeGreaterThan(3);
        for (let b = first; b < end; b++) {
          const [x, y, z] = placed(b);
          expect([meets(x, y, z), capsuleFree(world, x, Math.max(y, hf.heightAt(x, z)), z, p.radius, p.height)]).toEqual([true, false]);
          if (b > first) expect(meets((x + s.x) / 2, s.y, (z + s.z) / 2)).toBe(false);
        }
      }
    }
  }
  expect([oaks, elders, banyans]).toEqual([20, 10, 5]);
});

/** A survivor walking at a node of `form` standing alone on level ground, from eight sides. */
function walkAt(form: number): { climbed: number; rose: number; reached: number } {
  const w = flatWorld(2);
  const nodes = new StructureStore(w.dims, forms.halfX, forms.halfY, forms.halfZ, forms.soft, forms.parts);
  const [cx, cz] = [32, 32];
  nodes.put(0, 0, form, cx, 0, cz, 0, 0, 1, 1);
  const world = { hf: w.hf, structs: w.structs, nodes };
  const p = reg.move[kind("core:survivor")]!;
  const box = forms.parts.box;
  const first = forms.parts.start[form]! * 6;
  let tallest = 0;
  for (let b = first; b < forms.parts.start[form + 1]! * 6; b += 6) tallest = Math.max(tallest, box[b + 1]! + box[b + 4]!);
  const d = [0, 0, 0];
  let [climbed, highest, reached] = [0, 0, 0];
  for (let side = 0; side < 8; side++) {
    const a = (side * TAU) / 8;
    const b = new Body();
    [b.x, b.y, b.z, b.grounded] = [cx - Math.sin(a) * 6, 0, cz - Math.cos(a) * 6, true];
    // Where it stands at the stone: as near as it comes on the ground, before it climbs if it does.
    let [standX, standZ, closest, rose] = [b.x, b.z, Infinity, 0];
    for (let t = 0; t < 120; t++) {
      stepBody(world, b, 0, 127, Math.round((side * 65536) / 8) & 0xffff, 0, 0, p, TICK_DT);
      if (!capsuleFree(world, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`in ${forms.mesh[form]} from side ${side}`);
      const near = Math.hypot(b.x - cx, b.z - cz);
      rose = Math.max(rose, b.y);
      if (rose < 0.05 && near < closest) [standX, standZ, closest] = [b.x, b.z, near];
    }
    if (rose > 0.05) climbed++;
    highest = Math.max(highest, rose);
    // From there, a swing at the middle of its first box meets it within a pick's reach.
    const eye = stanceEye(p, STANCE_STAND);
    const [tx, ty, tz] = [cx + box[first]! - standX, box[first + 1]! - eye, cz + box[first + 2]! - standZ];
    const far = Math.hypot(tx, ty, tz);
    [d[0], d[1], d[2]] = [tx / far, ty / far, tz / far];
    if (castWorld(world, standX, eye, standZ, d[0]!, d[1]!, d[2]!, reg.reach[kind("core:pick")]!) === HIT_NODE) reached++;
  }
  // It never stands higher than the stone's boxes reach.
  expect(highest).toBeLessThanOrEqual(tallest + 0.01);
  return { climbed, rose: highest, reached };
}

test("a survivor walks over a low slab and is stopped by a tall boulder as their boxes say, and a pick's swing meets every stone and broken base from where it stands", () => {
  const climbs = new Map<string, number[]>();
  for (const id of ["core:rock", "core:rubble", "core:metal_rock"]) {
    const k = kind(id);
    const steps = forms.steps[k]!;
    for (let v = 0; v < forms.sums[k]!.length; v++) {
      for (const step of [0, steps - 1]) {
        const form = forms.first[k]! + v * steps + step;
        for (const f of [form, forms.left[form]!]) {
          const { climbed, reached } = walkAt(f);
          expect([forms.mesh[f], reached]).toEqual([forms.mesh[f], 8]);
          climbs.set(`${forms.mesh[f]} ${step === 0 ? "least" : "most"}`, [climbed]);
        }
      }
    }
  }
  // The low slabs are walked onto from every side, but for one of rock_5's at its largest, where a box 0.56 m high meets its
  // 0.38 m one, and the tall boulders at their largest from none. A body climbs a stone wherever its boxes rise by no more
  // than a step at a time, so it walks up most of the rest from some side.
  for (const low of ["core:rock_4", "core:rock_5", "core:rubble_3"]) expect([climbs.get(`${low} least`), climbs.get(`${low} most`)]).toEqual([[8], [low === "core:rock_5" ? 7 : 8]]);
  for (const tall of ["core:rock_2", "core:rock_6"]) expect(climbs.get(`${tall} most`)).toEqual([0]);
});

test("a used-up rock leaves its broken base, which bodies and rays meet as its own boxes say, and the rock as it was grows back", () => {
  const f = field();
  f.retain(0, 16, 1, () => false);
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const s = spot();
  const box = forms.parts.box;
  const p = reg.move[kind("core:survivor")]!;
  /**
   * What the store holds in the slot, standing alone: how high over its origin a look straight down at the middle of the
   * form's first box meets it. A body standing there is in it.
   */
  const looked = (chunk: number, i: number, form: number): number => {
    const t = f.store.chunks[chunk]!;
    expect([t.kind[i], t.x[i], t.y[i], t.z[i], t.yaw[i]]).toEqual([form, Math.fround(s.x), Math.fround(s.y), Math.fround(s.z), s.yaw]);
    const alone = new StructureStore(PROVING_DIMS, forms.halfX, forms.halfY, forms.halfZ, forms.soft, forms.parts);
    alone.put(chunk, i, form, s.x, s.y, s.z, s.yaw, 0, 1, 1);
    const b = forms.parts.start[form]! * 6;
    const a = (s.yaw / 65536) * TAU;
    const [lx, lz] = [box[b]!, box[b + 2]!];
    const [x, z] = [Math.cos(a) * lx + Math.sin(a) * lz + s.x, Math.cos(a) * lz - Math.sin(a) * lx + s.z];
    expect(capsuleKind(forms.parts, form, s.x, s.y, s.z, s.yaw, x, s.y, z, p.radius, p.height, SKIN)).toBe(true);
    expect([castWorld({ hf, structs, nodes: alone }, x, s.y + 6, z, 0, -1, 0, 6), rayHit.ref]).toEqual([HIT_NODE, chunk * 65536 + i]);
    return 6 - rayHit.t;
  };
  /** The top of the highest of the form's boxes over the middle of its first. */
  const highest = (form: number): number => {
    const b0 = forms.parts.start[form]! * 6;
    let most = -Infinity;
    for (let b = b0; b < forms.parts.start[form + 1]! * 6; b += 6) {
      if (Math.abs(box[b0]! - box[b]!) <= box[b + 3]! && Math.abs(box[b0 + 2]! - box[b + 2]!) <= box[b + 5]!) most = Math.max(most, box[b + 1]! + box[b + 4]!);
    }
    return most;
  };
  // The first ten of each kind.
  const stones = new Map(["core:rock", "core:rubble", "core:metal_rock"].map((id) => [kind(id), 0]));
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    for (let i = 0; i < f.source.perChunk; i++) {
      f.source.at(chunk, i, s);
      if ((stones.get(s.kind) ?? 10) >= 10) continue;
      stones.set(s.kind, stones.get(s.kind)! + 1);
      const whole = looked(chunk, i, s.form);
      expect(whole).toBeCloseTo(highest(s.form), 1);
      f.set(chunk, i, false);
      const left = forms.left[s.form]!;
      expect([f.store.chunks[chunk]!.kind[i], forms.depleted[left], forms.mesh[left]]).toEqual([left, 1, `${forms.mesh[s.form]}_depleted`]);
      // The broken base is met at its own boxes' top, lower than the rock's, until it grows back.
      const base = looked(chunk, i, left);
      expect([base, base < whole]).toEqual([expect.closeTo(highest(left), 1), true]);
      f.set(chunk, i, true);
      expect(looked(chunk, i, s.form)).toBe(whole);
    }
  }
  expect([...stones.values()]).toEqual([10, 10, 10]);
});

test("a creature's way is found again when anything within the reach of the widest node or piece changes, with its own radius", () => {
  const nodes = new StructureStore(PROVING_DIMS, forms.halfX, forms.halfY, forms.halfZ, forms.soft, forms.parts);
  const pieces = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const widest = Math.max(...nodes.spread, ...pieces.spread);
  expect(widest).toBeGreaterThan(12); // a banyan's outer trunks
  expect(widest + Math.max(...reg.bodyRadius)).toBeLessThanOrEqual(ROUTE_MARGIN);
});

test("fuzz: bodies wandering among trees and rocks are always in free space", () => {
  const f = field();
  f.retain(0, 16, 1, () => false);
  const world = { hf, structs: new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: f.store };
  const p = reg.move[kind("core:survivor")]!;
  for (let seed = 1; seed <= 4; seed++) {
    const rng = new Rng(seed);
    const b = new Body();
    do {
      b.x = rng.range(40, 470);
      b.z = rng.range(40, 470);
      b.y = hf.heightAt(b.x, b.z);
    } while (b.y < 0 || !capsuleFree(world, b.x, b.y, b.z, p.radius, p.height));
    b.grounded = true;
    let moveX = 0;
    let moveZ = 127;
    let yaw = 0;
    let buttons = 0;
    for (let i = 0; i < 5000; i++) {
      if (rng.int(25) === 0) {
        moveX = rng.int(255) - 127;
        moveZ = rng.int(255) - 127;
        yaw = rng.int(65536);
        buttons = rng.int(4);
      }
      stepBody(world, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
      if (!capsuleFree(world, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`seed ${seed} in solid at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
    }
  }
});
