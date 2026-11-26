// A second opinion on the far city's pieces gone as their sector comes and goes (client/core/render/farcity.ts): a
// chunk's pieces taken on the server while the page has let its sector's statics go, while it holds them, and while it
// has let them go again; after each the far city leaves out just the pieces the server's list names.

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

const file = writeMap(reviewMap(36000));

test("pieces taken while their sector's statics are let go, held and let go again are left out of the far city each time it is held", async () => {
  const h = serverOn(file);
  try {
    const inline = new InlineCityMaker(), made: BlocksMade[] = [];
    const maker: CityMaker = { onMade: null, start: (k) => inline.start(k), make: (j) => inline.make(j), take: (out) => inline.take(out), run: (ms) => inline.run(ms), blocks: (job) => void made.push(makeBlocks(job)), built: () => made.shift() ?? null };
    const wants: Wants = { view: 1800, statics: 800, camera: null, focus: null, screen: null };
    const page = await Page.open(h, file, "ada", wants, undefined, maker);
    const { link, loader, session: s } = page;
    const scene = new Scene(s.world!, h.reg, farPack());
    scene.assets.tier = tierOf("medium");
    scene.viewDistance = wants.view;
    const cam = new Camera();
    // A chunk of the dense sector, 1.3 km from where the body stands near it: far, and its sector within the statics reach
    // there, with none of its chunks among those the near store holds or keeps aside.
    const T = 30 * 80 + 30, structs = h.world.structs;
    const near = { x: 2900, z: 2900 }, away = { x: 4900, z: 4900 };
    page.onFrame = () => {
      s.askFar(1500, 6000);
      [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [s.own.x, s.own.y + 30, s.own.z, Math.atan2(1952 - s.own.x, 1952 - s.own.z), -0.1];
      wants.camera = { x: cam.x, z: cam.z };
      scene.now = h.now;
      scene.build(cam, null);
      while (link.waiting.length > 0 && link.waiting[0]!.at <= link.now - 150) link.answer(0);
    };
    const go = async (to: { x: number; z: number }): Promise<void> => {
      page.tp(to.x, to.z);
      for (let k = 0, quiet = 0; k < 200 && quiet < 8; k++) {
        await page.run(250);
        quiet = loader.progress().settled && link.waiting.length === 0 && Math.hypot(s.own.x - to.x, s.own.z - to.z) < 5 ? quiet + 1 : 0;
      }
      await page.run(4000);
    };
    /** The slots the far city leaves out of the chunk, and those the server's list names. */
    const state = (): { held: boolean; city: number[]; list: number[]; told: number[] } => {
      const gone = scene.city!.goneOf(T);
      const far = h.host.tactical as unknown as { gone: (Uint16Array | null)[] };
      return { held: loader.held.find(T) !== null, city: gone ? [...gone.keys()].filter((i) => gone[i] === 1) : [], list: [...(far.gone[T] ?? [])].sort((a, b) => a - b), told: [...(s.gone.lists.get(T) ?? [])].sort((a, b) => a - b) };
    };
    const out: string[] = [];
    const note = (what: string): void => {
      const st = state();
      out.push(`${what}: sector held ${st.held}; the far city leaves out ${JSON.stringify(st.city)}, the server's list ${JSON.stringify(st.list)}, told ${JSON.stringify(st.told)}`);
    };
    // By the near place, so the chunks kept aside are its own, and away: three pieces go while the sector is let go.
    await go(near);
    await go(away);
    for (const slot of [0, 1, 2]) structs.remove(T * 65536 + slot);
    await page.run(4000);
    note("taken while let go");
    const a = state();
    await go(near);
    note("then held");
    const b = state();
    // Held: two more go.
    for (const slot of [5, 6]) structs.remove(T * 65536 + slot);
    await page.run(5000);
    note("two more taken while held");
    const c = state();
    // Let go, two more go, and held again.
    await go(away);
    for (const slot of [9, 10]) structs.remove(T * 65536 + slot);
    await page.run(4000);
    note("let go, two more taken");
    const d = state();
    await go(near);
    note("held again");
    const e = state();
    console.log(out.join("\n"));
    expect([a.held, a.told]).toEqual([false, [0, 1, 2]]);
    expect([b.held, b.city]).toEqual([true, [0, 1, 2]]);
    expect([c.held, c.city]).toEqual([true, [0, 1, 2, 5, 6]]);
    expect([d.held, d.told]).toEqual([false, [0, 1, 2, 5, 6, 9, 10]]);
    expect([e.held, e.city]).toEqual([true, [0, 1, 2, 5, 6, 9, 10]]);
  } finally {
    h.host.shutdown();
  }
}, 900_000);
