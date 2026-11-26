// Where a page looks from while its body has no place: dead on a server, far from the map's first spawn point
// (client/core/mapload.ts place).

import { expect, test } from "bun:test";
import { SESSION_DEAD } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Page, inside, offOf, pagedMap, say, serverOn, type Wants } from "../fixtures/map-page.ts";

const file = writeMap(pagedMap(0));

test("a survivor dead far from the first spawn point is not sent the map round it", async () => {
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
    say(`dead for 8 s, ${Math.round(Math.hypot(spawn.x - at.x, spawn.z - at.z))} m from the first spawn point: asked for ${since.length} parts, ${elsewhere.length} of them out of reach of the body (${elsewhere.reduce((n, p) => n + p.length, 0)} bytes): ${elsewhere.map((p) => `${p.kind} ${Math.round(offOf(head, p, spawn.x, spawn.z))} m from the spawn point`).slice(0, 8).join(", ")}; let go ${lost.length} it held`);
    expect(elsewhere.length).toBe(0);
  } finally {
    h.host.shutdown();
  }
});
