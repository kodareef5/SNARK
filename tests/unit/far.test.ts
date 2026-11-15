// Far bases drawn as blocks (client/core/render/far.ts, D257, D258), held to the real pieces by the software rasterizer.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FAR_BUFFER, FAR_SLOTS, farPart } from "../../client/core/render/far.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CHUNK_SIZE, chunkAt } from "../../shared/coords.ts";
import { VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { FarCells, farTopByte } from "../../shared/world/tactical.ts";
import { castle, farWorld, type FarWorld } from "../fixtures/farworld.ts";
import { corePack } from "../fixtures/pack.ts";

/** The middle of the map the castles stand on, 24 chunks a side. */
const MID = 12 * CHUNK_SIZE + 32;
const sum = (a: Uint8Array): number => a.reduce((n, v) => n + v, 0);
/** The far draws of a frame, and the draws of the near store's chunk `chunk`. */
const farDraws = (p: FramePacket): number => p.drawFade.subarray(0, p.drawCount).filter((f) => f > 0).length;
const nearDraws = (p: FramePacket, chunk: number): number => p.drawBuffer.subarray(0, p.drawCount).filter((b) => b === chunk).length;

/** Every vertex of a far tile uploaded and drawn in `p`, in the world: x, y, z. */
function tileVertices(w: FarWorld, p: FramePacket): number[][] {
  const out: number[][] = [];
  for (let d = 0; d < p.drawCount; d++) {
    const u = p.assetUploads.find((u) => u.slot === p.drawSlot[d] && u.slot >= FAR_SLOTS);
    if (!u) continue;
    const m = w.pack.header.meshes[u.mesh]!;
    const at = (u.indexCount * u.indexBytes + 3) & ~3;
    const view = new DataView(u.data.buffer, u.data.byteOffset + at);
    const to = [w.cam.x, w.cam.y, w.cam.z].map((c, a) => c + p.drawOffset[d * 3 + a]!);
    for (let v = 0; v * VERTEX_BYTES < u.data.length - at; v++) out.push([0, 1, 2].map((a) => to[a]! + m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!));
  }
  return out;
}

test("a castle 600 m off with no rows is drawn as blocks over 90% or more of what its pieces cover, its tower's top within a pixel", () => {
  for (const tier of ["medium", "lowpoly"]) {
    const w = farWorld({ chunks: 24, tier: tierOf(tier) });
    const chunk = castle(w, MID, MID);
    w.send(chunk);
    // A long lens, so the castle fills the frame: from the ground, and from a hill 150 m up.
    w.cam.fovY = 2 * Math.atan(35 / 600);
    for (const [yaw, up] of [[0.8 * Math.PI, 1.6], [0.3 * Math.PI, 150]] as const) {
      w.look(MID, 20, MID, 600, yaw, up);
      w.frame();
      const far = w.covered().far;
      w.rows(chunk);
      w.frame();
      const { near, far: none } = w.covered();
      w.drop(chunk);
      expect(sum(none)).toBe(0);
      expect(sum(near)).toBeGreaterThan(1500);
      expect(sum(far.map((f, i) => f & near[i]!)) / sum(near)).toBeGreaterThanOrEqual(0.9);
      if (up > 2) continue;
      const top = (m: Uint8Array): number => Math.floor(m.indexOf(1) / w.W);
      expect(Math.abs(top(far) - top(near))).toBeLessThanOrEqual(1);
    }
  }
});

test("blocks take the colour their pieces' art shows, not the one their kind is listed in", () => {
  const w = farWorld({ chunks: 24, pack: corePack() });
  const chunk = castle(w, MID, MID);
  w.send(chunk);
  w.cam.fovY = 2 * Math.atan(35 / 600);
  w.look(MID, 20, MID, 600, 0.8 * Math.PI);
  const mean = (mask: Uint8Array): number[] => [0, 1, 2].map((c) => w.raster.color.reduce((s, v, i) => s + (i % 4 === c && mask[i >> 2] ? v : 0), 0) / sum(mask));
  w.frame();
  const far = mean(w.covered().far);
  w.rows(chunk);
  w.frame();
  const near = mean(w.covered().near);
  // The wood pieces are listed orange (palette 3) and drawn brown; the blocks are brown too, and on average within a few levels.
  const listed = (w.reg.defs[w.id("core:wall_wood")] as { color: number }).color;
  const pal = w.pack.palette;
  expect(Math.max(...[0, 1, 2].map((c) => Math.abs(far[c]! - near[c]!)))).toBeLessThan(12);
  expect(Math.max(...[0, 1, 2].map((c) => Math.abs(pal[listed * 4 + c]! - near[c]!)))).toBeGreaterThan(40);
});

test("a chunk whose rows come over five ticks is drawn far until its last row and near after, never both and never neither", () => {
  const w = farWorld({ chunks: 24 });
  const chunk = castle(w, MID, MID);
  w.send(chunk);
  w.cam.fovY = 2 * Math.atan(30 / 300);
  w.look(MID, 20, MID, 300, 0.7 * Math.PI);
  const seen: string[] = [];
  const frame = (): void => {
    const p = w.frame();
    const { far, near } = w.covered();
    const [f, n] = [sum(far) > 0, sum(near) > 0];
    expect(f).not.toBe(n);
    expect(farDraws(p) > 0).toBe(f);
    expect(nearDraws(p, chunk) > 0).toBe(n);
    seen.push(f ? "far" : "near");
  };
  frame();
  const high = w.server.chunks[chunk]!.high;
  for (let k = 0; k < 5; k++) {
    w.rows(chunk, Math.floor((high * k) / 5), Math.floor((high * (k + 1)) / 5), k === 4);
    frame();
  }
  // A raid's rows do not send it back; letting go of it does, in the same frame.
  const t = w.structs.chunks[chunk]!;
  for (let s = 0; s < 40; s++) w.structs.put(chunk, s, 0, 0, 0, 0, 0, 0, 0, t.version + 1);
  frame();
  w.drop(chunk);
  frame();
  expect(seen).toEqual(["far", "far", "far", "far", "far", "near", "near", "far"]);
});

test("no far block stands in a chunk the near store holds whole, and a tile is made of the chunks in it drawn far", () => {
  const w = farWorld({ chunks: 24 });
  const [a, b] = [castle(w, MID, MID), castle(w, MID + CHUNK_SIZE, MID)];
  w.sendAll();
  w.rows(a);
  w.look(MID + 32, 10, MID, 500, 0.8 * Math.PI);
  const p = w.frame();
  const vertices = tileVertices(w, p);
  expect(vertices.length).toBeGreaterThan(0);
  // Chunk b is the 64 m square east of a's.
  const [bx, bz] = [(b % w.dims.chunksX) * CHUNK_SIZE, Math.floor(b / w.dims.chunksX) * CHUNK_SIZE];
  for (const [x, , z] of vertices) expect(x! > bx - 0.01 && x! < bx + 64.01 && z! > bz - 0.01 && z! < bz + 64.01).toBe(true);
  expect([sum(w.covered().far) > 0, sum(w.covered().near) > 0, farDraws(p), nearDraws(p, a) > 0]).toEqual([true, true, 1, true]);
});

test("a base's coverage falls from all to none in even steps over the last tenth of reach", () => {
  const reach = 1000;
  // Rows a multiple of 4, so the frame holds the pattern a whole number of times.
  const w = farWorld({ chunks: 24, tier: { reach: { ...tierOf("medium").reach, bases: reach } }, height: 88 });
  // A chunk filled with a block 32 m tall, seen face on through a long lens, so it fills the frame.
  const cells = new FarCells();
  cells.tint.fill(20);
  cells.top.fill(farTopByte(32));
  cells.filled = 256;
  w.sendCells(chunkAt(w.dims, MID, MID), cells);
  w.cam.fovY = 2 * Math.atan(10 / reach);
  const coverage: number[] = [];
  for (let d = 860; d <= 1020; d += 10) {
    w.cam.x = MID;
    w.cam.z = MID - 32 - d;
    w.cam.y = 16;
    w.cam.yaw = w.cam.pitch = 0;
    w.frame();
    coverage.push(sum(w.covered().far) / (w.W * w.H));
    const kept = Math.min(1, Math.max(0, (reach - d) / (reach * 0.1)));
    expect(Math.abs(coverage.at(-1)! - kept)).toBeLessThanOrEqual(1 / 32 + 0.005);
  }
  for (let k = 1; k < coverage.length; k++) expect(coverage[k]!).toBeLessThanOrEqual(coverage[k - 1]!);
  expect([coverage[0], coverage.at(-1)]).toEqual([1, 0]);
  // Each step is a whole number of the pattern's sixteen places.
  for (const c of coverage) expect(Math.abs(c * 16 - Math.round(c * 16))).toBeLessThan(0.02);
});

test("the same cells give the same tile bytes, and cells sent again unchanged make the same tile", () => {
  const made = (): Uint8Array[] => {
    const w = farWorld({ chunks: 24, ground: (x, z) => 20 * Math.sin(x / 90) * Math.cos(z / 70) });
    castle(w, MID, MID, w.hf.heightAt(MID, MID));
    castle(w, MID + 70, MID + 90, w.hf.heightAt(MID + 70, MID + 90));
    const sent = w.sendAll();
    w.look(MID, 10, MID, 700, 0.5);
    const first = w.frame().assetUploads.map((u) => u.data);
    for (const chunk of sent) w.send(chunk);
    const again = w.frame().assetUploads.map((u) => u.data);
    expect(again).toEqual(first);
    return first;
  };
  const [one, two] = [made(), made()];
  expect(one.length).toBe(1);
  expect(two).toEqual(one);
});

test("a block's foot is under every level of the drawn ground, so it meets the coarse ground far off with no gap", () => {
  // Steep, bumpy ground, where a coarse level of it lies metres off the fine one.
  const ground = (x: number, z: number): number => 40 * Math.sin(x / 37) * Math.cos(z / 53) + 12 * Math.sin(x / 11 + z / 7);
  const w = farWorld({ chunks: 8, ground });
  const hf = w.hf;
  /** The ground as a level of the terrain with quads of `s` samples draws it at (x, z): two triangles a quad, split from (i, j) to (i + s, j + s). */
  const drawn = (x: number, z: number, s: number): number => {
    const [i, j] = [Math.floor(x / hf.cell / s) * s, Math.floor(z / hf.cell / s) * s];
    const [fx, fz] = [(x / hf.cell - i) / s, (z / hf.cell - j) / s];
    const h = (a: number, b: number): number => hf.sample(Math.min(a, hf.nx - 1), Math.min(b, hf.nz - 1));
    const [h00, h10, h01, h11] = [h(i, j), h(i + s, j), h(i, j + s), h(i + s, j + s)];
    return fx >= fz ? h00 + fx * (h10 - h00) + fz * (h11 - h10) : h00 + fz * (h01 - h00) + fx * (h11 - h01);
  };
  const rng = new Rng(4);
  let worst = Infinity;
  for (let n = 0; n < 300; n++) {
    const cells = new FarCells();
    const c = rng.int(256);
    cells.top[c] = 1 + rng.int(200);
    cells.tint[c] = 9;
    const [cx, cz] = [rng.int(8), rng.int(8)];
    const part = farPart(cells, cx * CHUNK_SIZE, cz * CHUNK_SIZE, 0, 0, hf);
    let foot = Infinity;
    for (let v = 1; v < part.pos.length; v += 3) foot = Math.min(foot, part.pos[v]!);
    const [x0, z0] = [cx * CHUNK_SIZE + (c % 16) * 4, cz * CHUNK_SIZE + Math.floor(c / 16) * 4];
    for (let s = 1; s <= 16; s *= 2) {
      for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) worst = Math.min(worst, drawn(x0 + a / 2, z0 + b / 2, s) - foot);
    }
  }
  // At least the metre the foot is sunk, under the fine ground and under every coarse level a block 2 km off stands on.
  expect(worst).toBeGreaterThanOrEqual(1 - 1e-3);
});

test("after a lost context every tile and its instance buffer go on the card again, and the picture is as it was", () => {
  const w = farWorld({ chunks: 24 });
  castle(w, MID, MID);
  castle(w, MID - 320, MID + 200);
  w.sendAll();
  w.look(MID, 10, MID, 800, 0.4, 80);
  const first = w.frame();
  const tiles = first.assetUploads.filter((u) => u.slot >= FAR_SLOTS).length;
  expect([tiles, first.uploads.filter((u) => u.buffer === FAR_BUFFER).length]).toEqual([2, 1]);
  const picture = w.raster.color.slice();
  expect(w.frame().assetUploads.length + w.frame().uploads.length).toBe(0);
  w.scene.resetUploads();
  const again = w.frame();
  expect([again.assetUploads.filter((u) => u.slot >= FAR_SLOTS).length, again.uploads.filter((u) => u.buffer === FAR_BUFFER).length]).toEqual([tiles, 1]);
  expect(w.raster.color).toEqual(picture);
});

test("tiles a tile past the tier's reach are let go, what is on the card is reserved, and a tier that reaches nowhere draws none", () => {
  const w = farWorld({ chunks: 48, tier: { reach: { ...tierOf("medium").reach, bases: 1024 } } });
  const near = castle(w, 400, 400);
  castle(w, 2900, 400);
  w.sendAll();
  w.look(400, 10, 400, 300, 0);
  const p = w.frame();
  const residency = w.scene.assets.residency;
  const onCard = p.assetUploads.filter((u) => u.slot >= FAR_SLOTS);
  expect(onCard.length).toBe(1);
  expect(residency.reserved).toBeGreaterThanOrEqual(onCard[0]!.data.length);
  const before = residency.reserved;
  // Walked off 1.6 km east, the first is more than a tile past reach and the second is in it.
  w.look(2600, 10, 400, 300, 0);
  const q = w.frame();
  expect(q.assetDrops).toEqual([onCard[0]!.slot]);
  expect(q.assetUploads.filter((u) => u.slot >= FAR_SLOTS).length).toBe(1);
  expect(residency.reserved - before).toBe(q.assetUploads.find((u) => u.slot >= FAR_SLOTS)!.data.length - onCard[0]!.data.length);
  // A tier that draws no far bases lets go of every tile, and the near store draws whatever rows it has.
  w.scene.assets.tier = { ...w.scene.assets.tier, reach: { ...w.scene.assets.tier.reach, bases: 0 } };
  w.rows(near, 0, 50, false);
  w.look(400, 10, 400, 300, 0);
  const none = w.frame();
  expect([none.assetDrops.length, farDraws(none), nearDraws(none, near) > 0, residency.reserved]).toEqual([1, 0, true, before - onCard[0]!.data.length]);
});
