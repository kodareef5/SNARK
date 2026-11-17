// The map trip's page (client/core/trip.ts, tools/map/trip.ts). What the trip changes is on its own server: where the page
// joins, where the body goes and which request fails. The page is told only ?trip, and with it the page watches: it fetches,
// draws and sends what a page without it does, so a link to the game with ?trip does nothing to a player.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { TripProbe } from "../../client/core/trip.ts";
import { chunkCount } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

const pack = parsePack(corePackBytes());

/** A client walking on the harness for 3 s, watched or not: each frame's draws, triangles and the body as the server has it. */
function walk(watched: boolean): { frames: number[]; probe: TripProbe | null } {
  const h = new Harness();
  const app = new App(h.join("trip", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const probe = watched ? new TripProbe(app, new Uint16Array(chunkCount(h.world.dims))) : null;
  const frames: number[] = [];
  app.key("KeyW", true);
  h.run(3000, (now) => {
    const packet = app.frame(now, 1280, 720);
    probe?.look();
    if (!packet) return;
    const e = h.ent(app.session);
    frames.push(packet.drawCount, packet.triangles, h.world.ents.x[e]!, h.world.ents.z[e]!, app.session.stats.bytesIn);
  });
  return { frames, probe };
}

test("a page told ?trip draws and sends what one not told does, and marks its first frame, its body predicted and its ground exact", () => {
  const plain = walk(false);
  const watched = walk(true);
  expect(watched.frames.length).toBeGreaterThan(500);
  expect(watched.frames).toEqual(plain.frames);
  const marks = watched.probe!.marks;
  expect([marks[0]!.what, marks.some((m) => m.what === "predicting"), marks.some((m) => m.what === "exact")]).toEqual(["frame", true, true]);
  expect(watched.probe!.whole().ground).toBe(true);
});
