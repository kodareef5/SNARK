// A second opinion on what a page keeps as it drives the same loop again and again: a page's loader, its session on a
// server, and a scene built every frame, with the far city, the city's blocks, the far shadow and the tops' fixes
// following the sectors as they come and go. After each lap what is held is counted three ways: the map's ledger
// (client/core/mapheld.ts), the process after a forced collection, and the buffers a card would hold by the frames'
// uploads and drops.
//
//   REVIEW_LAPS=6 bun test tests/world/review-laps.test.ts

import { expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { bytesHeld, heldTotal, mapLedger } from "../../client/core/mapheld.ts";
import { makeBlocks, type BlocksMade } from "../../client/core/render/blocks.ts";
import { Camera } from "../../client/core/render/camera.ts";
import "../../client/core/render/city-late.ts";
import { InlineCityMaker, type CityMaker } from "../../client/core/render/citymake.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { farPack } from "../fixtures/farworld.ts";
import { Page, inside, reviewMap, serverOn, sessionInside, type Wants } from "./review-rig.ts";

const LAPS = Number(process.env.REVIEW_LAPS ?? 5);
const file = writeMap(reviewMap(36000));

interface Lap {
  ledger: number;
  rows: string;
  heap: number;
  buffers: number;
  objects: number;
  card: number;
  cardBuffers: number;
  scene: number;
  counts: Record<string, number>;
  types: Record<string, number>;
  asked: number;
}

test(`${LAPS} laps of one loop with every reader attached hold no more at the last than at the second`, async () => {
  const h = serverOn(file);
  const inline = new InlineCityMaker(), made: BlocksMade[] = [];
  // Counts the far city's levels and the blocks' tiles asked of the maker.
  const asks = { levels: 0, tiles: 0 };
  const maker: CityMaker = { onMade: null, start: (k) => inline.start(k), make: (j) => (asks.levels++, inline.make(j)), take: (out) => inline.take(out), run: (ms) => inline.run(ms), blocks: (job) => void (asks.tiles++, made.push(makeBlocks(job))), built: () => made.shift() ?? null };
  const wants: Wants = { view: 1800, statics: 800, budget: 900e3, ground: 6e6, camera: null, focus: null, screen: null };
  const page = await Page.open(h, file, "ada", wants, undefined, maker);
  const { link, loader, session: s } = page;
  link.quietLog = true;
  const li = inside(loader), si = sessionInside(s);
  const scene = new Scene(s.world!, h.reg, farPack());
  scene.assets.tier = tierOf("medium");
  scene.viewDistance = wants.view;
  const cam = new Camera();
  // The buffers a card would hold: each upload sets its buffer's bytes, each drop lets it go.
  const card = new Map<number, number>();
  let heading = 0;
  page.onFrame = () => {
    s.askFar(1500, wants.view);
    [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [s.own.x, s.own.y + 30, s.own.z, heading, -0.2];
    wants.camera = { x: cam.x, z: cam.z };
    scene.now = h.now;
    const p = scene.build(cam, null);
    for (const u of p.uploads) card.set(u.buffer, u.data.byteLength);
    for (const d of p.drops) card.delete(d);
    // A part comes 150 ms after it is asked for.
    while (link.waiting.length > 0 && link.waiting[0]!.at <= link.now - 150) link.answer(0);
  };
  const structs = h.world.structs;
  // The loop: a square through 13 sectors and four overviews, at 80 m/s, a scope up on one side and the map open on another.
  const corners = [[700, 700], [4400, 700], [4400, 4400], [700, 4400]];
  const lap = async (n: number): Promise<void> => {
    for (let leg = 0; leg < 4; leg++) {
      const [a, b] = [corners[leg]!, corners[(leg + 1) % 4]!];
      const length = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!), steps = Math.ceil(length / 20);
      heading = Math.atan2(b[0]! - a[0]!, b[1]! - a[1]!);
      for (let k = 0; k <= steps; k++) {
        const [x, z] = [a[0]! + ((b[0]! - a[0]!) * k) / steps, a[1]! + ((b[1]! - a[1]!) * k) / steps];
        page.tp(x, z);
        wants.focus = leg === 1 && k % 40 < 20 ? { x: 2560, z: 2560 } : null;
        wants.screen = leg === 2 && k % 60 < 30 ? { x: 900, z: 900, half: 900 } : null;
        // On the first lap a few of the map's pieces fall far off, and a wall is built by the road.
        if (n === 0 && k % 37 === 5) {
          const c = (10 + leg * 17 + (k % 11)) * 80 + 20 + ((k * 7) % 40);
          for (let slot = 0; slot < 3; slot++) if (structs.chunks[c] && structs.chunks[c]!.kind[slot]) structs.remove(c * 65536 + slot);
          structs.add(h.reg.index.get("core:wall")!, x + 6, s.own.y + 1, z + 6, 0, 7, 100);
        }
        await page.run(250);
      }
    }
  };
  const measure = async (): Promise<Lap> => {
    // At rest at the first corner for 4 s, everything answered, then collected.
    wants.focus = wants.screen = null;
    for (let k = 0; k < 16; k++) await page.run(250);
    while (link.waiting.length > 0) link.answer(0);
    await page.run(500);
    Bun.gc(true);
    await page.run(100);
    Bun.gc(true);
    const mem = process.memoryUsage(), stats = heapStats();
    const rows = mapLedger({ loader, city: s.world!.city?.statics, farShadow: scene.farShadow, skip: [h.reg] });
    const types: Record<string, number> = {};
    for (const [name, count] of Object.entries(stats.objectTypeCounts)) if (count > 200) types[name] = count;
    const hf = loader.staged.hf;
    return {
      ledger: heldTotal(rows),
      rows: rows.map((r) => `${r.name} ${(r.bytes / 1e6).toFixed(2)}`).join(", "),
      heap: mem.heapUsed,
      buffers: mem.arrayBuffers,
      objects: stats.objectCount,
      card: [...card.values()].reduce((a, b) => a + b, 0),
      cardBuffers: card.size,
      // Every typed array the scene reaches that the ledger's classes did not.
      scene: bytesHeld(scene, new Set<unknown>([h.reg, loader, s.world, farPack()]), 9),
      counts: {
        "ground changes": hf.changes.length / 4,
        "pages": hf.count,
        "sectors": loader.held.size,
        "came": li.came.size,
        "gone lists": s.gone.lists.size,
        "far cells": s.far.chunks.size,
        "kept chunks": si.parked.size,
        "near chunks": s.world!.structs.held.length,
        "node chunks": si.nodeHeld.length,
        "link timers": (link as unknown as { timers: unknown[] }).timers.length,
        // What the readers made and keep by chunk: the far city's levels and its lists by chunk, the blocks' tiles, the far shadow's chunks, the tops fixed.
        "far city levels": asks.levels,
        "far city gone": (scene.city as unknown as { gone: Map<number, unknown> } | null)?.gone.size ?? -1,
        "far city tops": (scene.city as unknown as { tops: Map<number, unknown> } | null)?.tops.size ?? -1,
        "far city left": (scene.city as unknown as { left: Map<number, unknown> } | null)?.left.size ?? -1,
        "blocks tiles": asks.tiles,
        "shadow chunks": scene.farShadow?.stats.chunks ?? -1,
        "shadow sweeps": scene.farShadow?.stats.sweeps ?? -1,
        "tops fixed": scene.blocks?.fix?.fixes.size ?? -1,
        "tops asked": scene.blocks?.fix?.stats.asked ?? -1,
      },
      types,
      asked: [...link.asks.values()].reduce((a, b) => a + b, 0),
    };
  };
  const laps: Lap[] = [];
  for (let n = 0; n < LAPS; n++) {
    const t = performance.now();
    await lap(n);
    laps.push(await measure());
    const l = laps[n]!;
    console.log(`lap ${n + 1} (${((performance.now() - t) / 1000).toFixed(0)} s): ledger ${(l.ledger / 1e6).toFixed(2)} MB; heapUsed ${(l.heap / 1e6).toFixed(2)} MB, arrayBuffers ${(l.buffers / 1e6).toFixed(2)} MB, ${l.objects} objects; card ${(l.card / 1e6).toFixed(2)} MB in ${l.cardBuffers} buffers; scene's arrays ${(l.scene / 1e6).toFixed(2)} MB; asked ${l.asked}; ${Object.entries(l.counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log(`  ${l.rows}`);
  }
  const [second, last] = [laps[1]!, laps[LAPS - 1]!];
  const grew = Object.entries(last.types).map(([name, count]) => [name, count - (second.types[name] ?? 0)] as const).filter(([, d]) => d > 50).sort((a, b) => b[1] - a[1]);
  console.log(`objects by type, lap ${LAPS} less lap 2: ${grew.slice(0, 14).map(([name, d]) => `${name} +${d}`).join(", ") || "none grew by 50"}`);
  console.log(`unsound frames ${page.unsound.length} of ${page.frames}`);
  h.host.shutdown();
  expect(page.unsound).toEqual([]);
  // The ledger and the card are level from the second lap; the process within a megabyte.
  expect(last.ledger).toBeLessThanOrEqual(second.ledger);
  expect(last.card).toBeLessThanOrEqual(second.card);
  expect(last.scene - second.scene).toBeLessThan(64e3);
  expect(last.heap + last.buffers - second.heap - second.buffers).toBeLessThan(1e6);
}, 3_600_000);
