// Chunk messages a page keeps for a sector of statics not yet held hold back no other chunk's (client/core/session.ts
// chunkOrKeep): a wall built beside the body while a far sector along a sight's cone comes late, or never.

import { expect, test } from "bun:test";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Page, pagedMap, say, serverOn, sessionInside, type Wants } from "../fixtures/map-page.ts";

const file = writeMap(pagedMap(0));

for (const how of ["takes 3 s to come", "fails at every ask"] as const) {
  test(`a wall built by the body reaches the page while a far sector ${how}`, async () => {
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
      say(`a far sector that ${how}: the wall ${ms < 0 ? "had not reached the page 60 s" : `reached the page ${Math.round(ms)} ms`} after it was built, behind ${most} chunk messages kept; the far sector was asked for ${link.asks.get(slow)} times`);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(500);
    } finally {
      h.host.shutdown();
    }
  });
}
