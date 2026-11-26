// A second opinion on a page that loses its socket in the middle of a drive, with sectors held, coming and let go, and
// comes back as the same survivor: the browser loads the page again (client/shell/main.ts comeIn), so it is a new loader
// and a new session on a new connection. What the new page holds is held to the server; and the old page, which waits
// where it is until the server answers, is watched for what it asks of the map meanwhile.

import { expect, test } from "bun:test";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { checksOf } from "./review-checks.ts";
import { Page, differ, inside, offOf, reviewMap, serverOn, sessionInside, type Wants } from "./review-rig.ts";

const file = writeMap(reviewMap(0));
const { compare, reference, books } = checksOf(file);

for (const cut of ["the page's end", "the server's end"] as const) {
  test(`a socket lost at ${cut} mid-drive, messages kept and parts under way: the page that comes back holds what the server does`, async () => {
    const h = serverOn(file);
    try {
      const wants: Wants = { view: 1500, statics: 700, budget: 900e3, ground: 6e6, camera: null, focus: null, screen: null };
      const page = await Page.open(h, file, "ada", wants);
      const { link, loader, session: s } = page;
      const si = sessionInside(s), structs = h.world.structs, head = loader.staged.head;
      // Parts come 400 ms after they are asked for, and a sector's statics 5 s, so the drive outruns them.
      page.onFrame = () => {
        for (let k = 0; k < link.waiting.length; k++) if (link.waiting[k]!.at <= link.now - (link.waiting[k]!.url.includes("/statics.") ? 5000 : 400)) link.answer(k--);
        if (s.place) wants.camera = { x: s.place.x, z: s.place.z };
      };
      for (let k = 0; k < 200 && !(loader.progress().settled && loader.progress().roads === 0); k++) await page.run(250);
      // East at 320 m/s, pieces of the map falling ahead, until chunk messages are kept and parts are under way.
      let x = 2600, lost = -1;
      for (let k = 0; k < 400 && lost < 0; k++) {
        x += 80;
        page.tp(Math.min(x, 4900), 2600);
        const c = 40 * head.dims.chunksX + Math.min(79, Math.floor(x / CHUNK_SIZE) + 2);
        if (structs.chunks[c]?.kind[0]) structs.remove(c * 65536);
        await page.run(250);
        if (x > 3300 && si.waitingRows.length > 0 && link.waiting.length > 0 && inside(loader).came.size > 0) lost = k;
      }
      expect(lost).toBeGreaterThan(0);
      const [kept, under, heldThen] = [si.waitingRows.length, link.waiting.length, loader.held.size];
      const at = { x: s.own.x, z: s.own.z };
      // The socket goes.
      if (cut === "the page's end") page.end.close();
      else page.end.peer.close();
      const asked = link.log.length;
      await page.run(3000);
      expect([s.state, s.place]).toEqual(["closed", null]);
      // The old page waits where it is, its camera over the body it last drew: what does it ask of the map's host meanwhile?
      const reach = (kind: string): number => (kind === "overview" || kind === "tops" ? wants.view : kind === "statics" || kind === "buildings" ? wants.statics : 1280);
      const since = link.log.slice(asked).map((l) => head.parts.find((p) => `map/${p.name}` === l.url)!);
      const elsewhere = since.filter((p) => offOf(head, p, at.x, at.z) > reach(p.kind));
      console.log(`${cut}: lost with ${kept} chunk messages kept, ${under} parts under way, ${heldThen} sectors held; in 3 s the page left waiting asked for ${since.length} parts, ${elsewhere.length} of them out of every reach of where it stands (${elsewhere.reduce((n, p) => n + p.length, 0)} bytes)`);
      // The page comes back: loaded again, as the same survivor.
      const back = await Page.open(h, file, "ada", wants, "resume");
      back.onFrame = () => {
        while (back.link.waiting.length > 0 && back.link.waiting[0]!.at <= back.link.now - 150) back.link.answer(0);
      };
      const bi = sessionInside(back.session);
      for (let k = 0, quiet = 0; k < 400 && quiet < 8; k++) {
        await back.run(250);
        const p = back.loader.progress();
        quiet = p.settled && p.roads === 0 && bi.waitingRows.length === 0 && back.link.waiting.length === 0 ? quiet + 1 : 0;
      }
      const c = back.client, mine = back.session.world!.structs;
      const sent = back.whole();
      const ghosts: number[] = [];
      for (let k = 0; k < bi.whole.length; k++) if (bi.whole[k] !== 0 && c.known[k] === 0) ghosts.push(k);
      const wrong = [...books(back.loader), ...compare(back.loader, back.session.world!.city!.statics, reference(back.loader))];
      console.log(`back at ${back.session.own.x.toFixed(0)}, ${back.session.own.z.toFixed(0)} (it was lost at ${at.x.toFixed(0)}, ${at.z.toFixed(0)}): ${sent.length} chunks sent whole, ${differ(structs, mine, sent)} slots differ, ${ghosts.length} whole to the page and dropped by the server; the server takes it to hold the statics: ${c.statics}; predicted ${back.session.predicting}; ${back.unsound.length} unsound frames`);
      expect([back.session.state, back.loader.progress().settled, sent.length > 0, differ(structs, mine, sent), ghosts, bi.waitingRows.length, bi.unbased.size, c.statics, back.unsound, wrong]).toEqual(["active", true, true, 0, [], 0, 0, true, [], []]);
      // It came back where it was, not at the first spawn point.
      expect(Math.hypot(back.session.own.x - at.x, back.session.own.z - at.z)).toBeLessThan(60);
      // The old page asked for nothing out of reach of where it stood.
      expect(elsewhere.length).toBe(0);
    } finally {
      h.host.shutdown();
    }
  }, 600_000);
}
