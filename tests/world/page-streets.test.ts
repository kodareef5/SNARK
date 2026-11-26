// A car's prediction at the edge of a sector whose streets the page lists and does not hold yet
// (client/core/session.ts groundHeld, client/core/mapload.ts lookRoads): with the loader's own books, on a server.

import { expect, test } from "bun:test";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Link, Page, inside, pagedMap, say, serverOn, type Wants } from "../fixtures/map-page.ts";

const file = writeMap(pagedMap(0));

test("a car by a sector whose streets have not come is predicted once they do", async () => {
  const h = serverOn(file);
  try {
    const wants: Wants = { view: 1500, statics: 700, camera: null, focus: null, screen: null };
    // The streets of the sector east of where the body will stand are kept back from the start; every other part comes in 150 ms.
    let back = true;
    const slow = (url: string): boolean => back && url.includes("/streets.129-128.");
    const link = new Link(file);
    link.keepBack = slow;
    const page = await Page.open(h, file, "ada", wants, undefined, undefined, link);
    const { loader, session: s } = page;
    page.onFrame = () => {
      for (let k = 0; k < link.waiting.length; k++) if (!slow(link.waiting[k]!.url) && link.waiting[k]!.at <= link.now - 150) link.answer(k--);
    };
    // 36 m west of that sector's edge, on the street that runs through both.
    page.tp(1500, 1012);
    for (let k = 0; k < 100 && !(loader.progress().settled && Math.hypot(s.own.x - 1500, s.own.z - 1012) < 3); k++) await page.run(250);
    await page.run(1500);
    const streets = loader.staged.hf.streets!;
    expect([loader.progress().settled, loader.progress().roads, streets.heldIn(1400, 900, 1500, 1100), streets.heldIn(1400, 900, 1600, 1100)]).toEqual([true, 1, true, false]);
    // On foot the body is predicted: the ground is the map's own.
    expect([s.predicting, s.driving]).toEqual([true, -1]);
    const car = h.host.spawnVehicle("core:compact", s.own.x + 1.6, s.own.z - 0.12, 0, Math.PI);
    h.host.urban.mount(page.client, car);
    let predicted = 0, frames = 0;
    for (let k = 0; k < 180; k++) {
      await page.run(17);
      if (s.driving === car) (frames++, s.predicting && predicted++);
    }
    expect([s.driving, frames > 100, predicted, page.unsound]).toEqual([car, true, 0, []]);
    // Its streets come: the car is predicted from then on.
    back = false;
    await page.run(1500);
    expect([inside(loader).roadsHeld.size > 0, streets.heldIn(1400, 900, 1600, 1100), s.predicting, loader.progress().roads]).toEqual([true, true, true, 0]);
    // Driven along that sector's edge for 6 s, predicted all the way.
    h.pilots[h.sessions.indexOf(s)]!.moveZ = 1;
    let unpredicted = 0;
    for (let k = 0; k < 360; k++) {
      await page.run(17);
      if (!s.predicting) unpredicted++;
    }
    say(`the car went from 1500, 1012 to ${s.own.x.toFixed(0)}, ${s.own.z.toFixed(0)}; ${unpredicted} frames of 360 not predicted; ${page.unsound.length} unsound`);
    expect([unpredicted, page.unsound]).toEqual([0, []]);
  } finally {
    h.host.shutdown();
  }
});
