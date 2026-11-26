// What a second opinion on the page's bounded map loader found, each as a test that fails while it stands.

import { expect, test } from "bun:test";
import { SESSION_DEAD } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Link, Page, inside, offOf, reviewMap, serverOn, sessionInside, startLoader, wantOf, type Wants } from "./review-rig.ts";

const file = writeMap(reviewMap(0));

test("a survivor that dies far from the map's first spawn point is not sent the map round that point", async () => {
  const h = serverOn(file);
  try {
    const wants: Wants = { view: 1500, statics: 700, camera: null, focus: null, screen: null };
    const page = await Page.open(h, file, "ada", wants);
    const { link, loader, session: s } = page;
    const head = loader.staged.head, spawn = head.spawns[0]!;
    page.onFrame = () => {
      // A part comes 150 ms after it is asked for, and the camera stays over the body, or over where it fell.
      while (link.waiting.length > 0 && link.waiting[0]!.at <= link.now - 150) link.answer(0);
      if (s.place) wants.camera = { x: s.place.x, z: s.place.z };
    };
    // The far north-east, 2.8 km from the first spawn point in the middle.
    const at = { x: 4600, z: 700 };
    page.tp(at.x, at.z);
    for (let k = 0; k < 200 && !(loader.progress().settled && loader.progress().roads === 0 && Math.hypot(s.own.x - at.x, s.own.z - at.z) < 5); k++) await page.run(250);
    await page.run(2000);
    expect([loader.progress().settled, Math.round(Math.hypot(spawn.x - at.x, spawn.z - at.z)) > wants.view + 1024]).toEqual([true, true]);
    const held = new Set(inside(loader).came);
    const asked = link.log.length;
    s.text("suicide");
    await page.run(8000);
    expect([s.sessionState, s.place]).toEqual([SESSION_DEAD, null]);
    // What it asked for while dead, and of that what is out of every reach of where it fell.
    const since = link.log.slice(asked).map((l) => head.parts.find((p) => `map/${p.name}` === l.url)!);
    const reach = (kind: string): number => (kind === "overview" || kind === "tops" ? wants.view : kind === "statics" || kind === "buildings" ? wants.statics : 1280);
    const elsewhere = since.filter((p) => offOf(head, p, at.x, at.z) > reach(p.kind));
    const lost = [...held].filter((p) => !inside(loader).came.has(p));
    console.log(`dead for 8 s, ${Math.round(Math.hypot(spawn.x - at.x, spawn.z - at.z))} m from the first spawn point: asked for ${since.length} parts, ${elsewhere.length} of them out of reach of the body (${elsewhere.reduce((n, p) => n + p.length, 0)} bytes): ${elsewhere.map((p) => `${p.kind} ${Math.round(offOf(head, p, spawn.x, spawn.z))} m from the spawn point`).slice(0, 8).join(", ")}; let go ${lost.length} it held`);
    expect(elsewhere.length).toBe(0);
  } finally {
    h.host.shutdown();
  }
}, 600_000);

test("a page that says it is settled has looked from where the body is now", async () => {
  const link = new Link(file);
  const loader = await startLoader(link);
  const body = { x: 700, z: 700, vx: 0, vz: 0 };
  const wants: Wants = { view: 1500, statics: 700, camera: null, focus: null, screen: null };
  let drawn = false;
  void loader.follow(() => body, { want: () => wantOf(wants) }).then(() => (drawn = true));
  for (let k = 0; k < 400 && !drawn; k++) await link.drain(0, 1);
  for (let k = 0; k < 40; k++) await link.drain(250, 1);
  expect(loader.progress().settled).toBe(true);
  // The body is set down 5 km off, as a respawn or a tool's jump does. A third of a second on nothing has been asked for.
  [body.x, body.z] = [4400, 4400];
  await link.advance(300);
  const head = loader.staged.head;
  const missing = head.parts.filter((p) => p.kind === "ground" && offOf(head, p, body.x, body.z) === 0 && !inside(loader).came.has(p));
  expect(missing.length).toBe(1);
  // The ground under the body is not held, yet the page says it is settled (tools/wiki, client/core/trip.ts and the bench read this).
  expect(loader.progress().settled).toBe(false);
}, 600_000);

for (const how of ["takes 3 s to come", "fails at every ask"] as const) {
  test(`a wall built beside the body reaches the page while a far sector a sight looks into ${how}`, async () => {
    const h = serverOn(file);
    try {
      const wants: Wants = { view: 1500, statics: 700, camera: null, focus: null, screen: null };
      const page = await Page.open(h, file, "ada", wants);
      const { link, loader, session: s } = page;
      const head = loader.staged.head, structs = h.world.structs, si = sessionInside(s);
      // Three chunks 2 km east of the body that hold pieces of the map, in a sector the page does not hold.
      const far: number[] = [];
      for (let cx = 72; cx < 80 && far.length < 3; cx++) if (head.counts[40 * head.dims.chunksX + cx]! > 0) far.push(40 * head.dims.chunksX + cx);
      const slow = `map/${loader.held.partOf(far[0]!)!.name}`, HOLD = 3000;
      // A part comes 150 ms after it is asked for; that sector's statics after 3 s (a megabyte or two on a phone's link), or never: a 503 each time.
      page.onFrame = () => {
        for (let k = 0; k < link.waiting.length; k++) {
          const w = link.waiting[k]!, mine = w.url === slow;
          if (w.at <= link.now - (mine && how === "takes 3 s to come" ? HOLD : 150)) link.answer(k--, mine && how === "fails at every ask" ? "fail" : "ok");
        }
      };
      for (let k = 0; k < 200 && !(loader.progress().settled && loader.progress().roads === 0); k++) await page.run(250);
      await page.run(1000);
      expect([loader.progress().settled, far.length, loader.held.find(far[0]!)]).toEqual([true, 3, null]);
      // A sight raised that way: the server sends the chunks of its cone (server/gaze.ts), and the page's scope asks round its focus.
      h.server.replication.cone = () => ({ chunks: Int32Array.from(far), count: far.length });
      wants.focus = { x: 74 * 64, z: 40 * 64 + 32 };
      for (let k = 0; k < 120 && si.waitingRows.length === 0; k++) await page.run(17);
      expect(si.waitingRows.length).toBeGreaterThan(0);
      // An enemy sets a wall down 6 m from the body.
      const wall = h.reg.index.get("core:wall")!;
      const ref = structs.add(wall, s.own.x + 6, s.own.y + 1, s.own.z, 0, 7, 100), chunk = Math.floor(ref / 65536), slot = ref % 65536;
      const from = h.now;
      let ms = -1, most = 0;
      for (let k = 0; k < 3600 && ms < 0; k++) {
        await page.run(17);
        most = Math.max(most, si.waitingRows.length);
        if (s.world!.structs.chunks[chunk]?.kind[slot] === wall) ms = h.now - from;
      }
      console.log(`a far sector that ${how}: the wall ${ms < 0 ? "had not reached the page 60 s" : `reached the page ${Math.round(ms)} ms`} after it was built, behind ${most} chunk messages kept; the far sector was asked for ${link.asks.get(slow)} times`);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(500);
    } finally {
      h.host.shutdown();
    }
  }, 600_000);
}
