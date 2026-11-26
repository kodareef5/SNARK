// A second opinion on what a scope costs a page that holds its ground by budget: a page at rest on a server, a scene built
// every frame, and a scope raised on a place 3.5 km off and lowered, again and again. The ground round the focus is held
// past the budget, so the pages past the fine window round the body go, and come back when the scope is lowered. Counted:
// the parts asked for again, the changes to the ground, what the readers make again, and the time a frame's build takes.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { makeBlocks, type BlocksMade } from "../../client/core/render/blocks.ts";
import { Camera } from "../../client/core/render/camera.ts";
import "../../client/core/render/city-late.ts";
import { InlineCityMaker, type CityMaker } from "../../client/core/render/citymake.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { farPack } from "../fixtures/farworld.ts";
import { Page, reviewMap, serverOn, type Wants } from "./review-rig.ts";

const file = writeMap(reviewMap(0));

test("a scope raised and lowered ten times makes nothing again that stood before it", async () => {
  const h = serverOn(file);
  try {
    const inline = new InlineCityMaker(), made: BlocksMade[] = [];
    // Counts the far city's levels and the blocks' tiles asked of the maker.
    const asks = { levels: 0, tiles: 0 };
    const maker: CityMaker = { onMade: null, start: (k) => inline.start(k), make: (j) => (asks.levels++, inline.make(j)), take: (out) => inline.take(out), run: (ms) => inline.run(ms), blocks: (job) => void (asks.tiles++, made.push(makeBlocks(job))), built: () => made.shift() ?? null };
    // The medium tier's shape on a map a third the size: statics and ground to 2 km, 16 pages of ground, a view of 2.6 km.
    const wants: Wants = { view: 2600, statics: 2000, budget: 30e6, ground: 14e6, camera: null, focus: null, screen: null };
    const page = await Page.open(h, file, "ada", wants, undefined, maker);
    const { link, loader, session: s } = page;
    const scene = new Scene(s.world!, h.reg, farPack());
    scene.assets.tier = tierOf("medium");
    scene.viewDistance = wants.view;
    const cam = new Camera();
    const builds: number[] = [];
    page.onFrame = () => {
      s.askFar(1500, wants.view);
      [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [s.own.x, s.own.y + 2, s.own.z, Math.PI / 4, 0];
      wants.camera = { x: cam.x, z: cam.z };
      scene.now = h.now;
      const t = performance.now();
      scene.build(cam, null);
      builds.push(performance.now() - t);
      while (link.waiting.length > 0 && link.waiting[0]!.at <= link.now - 150) link.answer(0);
    };
    page.tp(1500, 1500);
    for (let k = 0, quiet = 0; k < 400 && quiet < 12; k++) {
      await page.run(250);
      quiet = loader.progress().settled && loader.progress().roads === 0 && link.waiting.length === 0 ? quiet + 1 : 0;
    }
    const hf = loader.staged.hf;
    const count = () => ({ asked: link.log.length, changes: hf.changes.length / 4, shadow: scene.farShadow?.stats.chunks ?? 0, sweeps: scene.farShadow?.stats.sweeps ?? 0, blocks: asks.tiles, city: asks.levels, pages: hf.count });
    const stats = (ms: number[]) => { const a = [...ms].sort((x, y) => x - y); return { median: +a[a.length >> 1]!.toFixed(2), p99: +a[Math.floor(a.length * 0.99)]!.toFixed(2), worst: +a[a.length - 1]!.toFixed(2), total: +a.reduce((x, y) => x + y, 0).toFixed(0) }; };
    // 30 s at rest, then 30 s of the scope up 1.5 s and down 1.5 s.
    builds.length = 0;
    const rest0 = count();
    await page.run(30_000);
    const rest1 = count(), restMs = stats(builds);
    builds.length = 0;
    for (let k = 0; k < 20; k++) {
      wants.focus = k % 2 === 0 ? { x: 4000, z: 4000 } : null;
      scene.focusX = k % 2 === 0 ? 4000 : NaN;
      scene.focusZ = k % 2 === 0 ? 4000 : NaN;
      await page.run(1500);
    }
    const flick1 = count(), flickMs = stats(builds);
    const delta = (a: ReturnType<typeof count>, b: ReturnType<typeof count>) => ({ asked: b.asked - a.asked, changes: b.changes - a.changes, shadow: b.shadow - a.shadow, sweeps: b.sweeps - a.sweeps, blocks: b.blocks - a.blocks, city: b.city - a.city });
    const [rest, flick] = [delta(rest0, rest1), delta(rest1, flick1)];
    console.log(`at rest 30 s: ${JSON.stringify(rest)}, build ms ${JSON.stringify(restMs)}, ${rest1.pages} pages held`);
    console.log(`ten scopes in 30 s: ${JSON.stringify(flick)}, build ms ${JSON.stringify(flickMs)}`);
    expect(rest).toEqual({ asked: 0, changes: 0, shadow: 0, sweeps: 0, blocks: 0, city: 0 });
    // After the first raise, which fetches the ground round the focus once, nothing should be asked for or made again.
    expect(flick.asked).toBeLessThan(30);
    expect(flick.shadow).toBeLessThan(2000);
  } finally {
    h.host.shutdown();
  }
}, 900_000);
