// A node's level is chosen by the 16 m cell of its chunk it stands in, not by the chunk.
import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS, Scene } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { NodeField, nodeForms, scatterNodes } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { variantMeshes, variantRegistry } from "../fixtures/nodes.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { NodeDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { VARIANT_NODES } from "../../shared/sim/scenarios.ts";

/**
 * The stand-in palms, their finest level made heavy (each triangle 300 times over) and a second as they are, which states an
 * error, standing in every slot of 3 by 3 chunks, seen from the middle of a cell of the middle chunk.
 */
function wood(sapling = false) {
  const reg = sapling ? saplings() : variantRegistry();
  const forms = nodeForms(reg);
  const meshes = variantMeshes().map((m) => {
    const lod = m.lods[0]!;
    const heavy = Uint32Array.from({ length: lod.indices.length * 300 }, (_, i) => lod.indices[i % lod.indices.length]!);
    return { ...m, lods: [{ ...lod, indices: heavy }, { ...lod, error: 0.004 }] };
  });
  const pack = parsePack(buildPack(meshes, defaultPalette()));
  const dims = { chunksX: 3, chunksZ: 3 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const palm = reg.index.get("test:palm")!;
  // With saplings, they fill the middle chunk and palms the rest.
  const small = reg.index.get("test:sapling") ?? palm;
  const field = new NodeField(dims, reg, scatterNodes(dims, hf, 8, 128, forms, (x, z) => (Math.floor(x / CHUNK_SIZE) === 1 && Math.floor(z / CHUNK_SIZE) === 1 ? [small] : [palm])));
  field.retain(4, 1, 1, () => false);
  const scene = new Scene({ dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: field.store }, reg, pack);
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = 1080;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.aspect] = [CHUNK_SIZE + 8, 1.6, CHUNK_SIZE + 8, 16 / 9];
  return { scene, cam, field };
}

/** The stand-in palm's meshes grown as a second kind, a quarter of the size the palm grows to and less. */
function saplings() {
  const palm = VARIANT_NODES.find((d) => d.id === "test:palm") as NodeDef;
  const { registry, errors } = compileContent([...CORE_CONTENT, ...VARIANT_NODES, { ...palm, id: "test:sapling", size: [0.25, 0.25] }]);
  if (!registry) throw new Error(errors.join("\n"));
  return registry;
}

/** Per node of the middle chunk drawn in `p`: how far its cell's nearest point is, and the level it was drawn at. */
function drawn(p: FramePacket, w: ReturnType<typeof wood>): { far: number; level: number }[] {
  const t = w.field.store.chunks[4]!;
  const out: { far: number; level: number }[] = [];
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== NODE_BUFFERS + 4) continue;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      // The slot behind each instance, as the scene laid them out, is in its upload.
      const slot = p.uploads.find((u) => u.buffer === NODE_BUFFERS + 4)!.slots[i]!;
      const [x, z] = [t.x[slot]!, t.z[slot]!];
      const cx = CHUNK_SIZE + Math.floor((x - CHUNK_SIZE) / 16) * 16;
      const cz = CHUNK_SIZE + Math.floor((z - CHUNK_SIZE) / 16) * 16;
      out.push({ far: Math.hypot(Math.max(cx - w.cam.x, w.cam.x - cx - 16, 0), Math.max(cz - w.cam.z, w.cam.z - cz - 16, 0)), level: p.drawLod[d]! });
    }
  }
  return out;
}

test("in the chunk a player stands in, nodes near him are drawn finest and those across it coarser, and few draws do it", () => {
  const w = wood();
  // All round, so that every cell is in view once.
  const seen: { far: number; level: number }[] = [];
  let draws = 0;
  for (let k = 0; k < 8; k++) {
    w.cam.yaw = (k * Math.PI) / 4;
    for (const t of w.field.store.chunks) if (t) t.shape++;
    const p = w.scene.build(w.cam, null);
    seen.push(...drawn(p, w));
    draws = Math.max(draws, p.drawCount);
  }
  const near = seen.filter((n) => n.far < 4);
  const across = seen.filter((n) => n.far > 30);
  expect([near.length > 10, across.length > 10]).toEqual([true, true]);
  expect(near.every((n) => n.level === 0)).toBe(true);
  expect(across.every((n) => n.level === 1)).toBe(true);
  // Three palms and a few cells' runs of each in the middle chunk, and one draw a palm in each other chunk.
  expect(draws).toBeLessThan(3 * 16 + 8 * 3);

  // Chosen by the chunk, every palm of it is drawn finest.
  w.scene.nodeCells = 1;
  for (const t of w.field.store.chunks) if (t) t.shape++;
  const whole = drawn(w.scene.build(w.cam, null), w);
  expect(whole.length).toBeGreaterThan(10);
  expect(whole.every((n) => n.level === 0)).toBe(true);
});

test("two kinds grown as one mesh are each drawn at the level its own largest size asks for", () => {
  // Saplings of the palms' meshes, at a quarter of the size, fill the chunk the camera stands in. Palms elsewhere grow to 1.7,
  // whose level 1 is first drawn 24 m off; a sapling's is 4 m off.
  const w = wood(true);
  const seen: { far: number; level: number }[] = [];
  for (let k = 0; k < 8; k++) {
    w.cam.yaw = (k * Math.PI) / 4;
    for (const t of w.field.store.chunks) if (t) t.shape++;
    seen.push(...drawn(w.scene.build(w.cam, null), w));
  }
  // Drawn as palms they would all be level 0. A few join a run of the cell the camera stands in, drawn one level finer.
  const between = seen.filter((n) => n.far > 6 && n.far < 20);
  expect(between.length).toBeGreaterThan(10);
  expect(between.filter((n) => n.level === 1).length).toBeGreaterThan(between.length * 0.9);
});
