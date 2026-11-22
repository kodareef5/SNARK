// The device probe's terrain flight on a terrain server's link, a whole run of a client on the harness as a phone's page
// makes it. Beside device.test.ts, on the page they share (tests/fixtures/device.ts).

import { expect, test } from "bun:test";
import { DeviceProbe } from "../../client/core/device.ts";
import { deviceTable } from "../../client/core/devicetext.ts";
import { lacking } from "../../tools/device.ts";
import { TIMING, TOKEN, browser, client, renderer, run, settle } from "../fixtures/device.ts";

test("the terrain flight is offered only by its own server's link, flies the camera over each of its tiers with jumps, times each jump's window, and stands far bases and the wood; its soak turns through them", async () => {
  const { h, pack, app, expected } = client();
  const offers = async (tests?: string): Promise<boolean[]> => {
    const shown = browser({ expected, ...(tests ? { tests } : {}) });
    void new DeviceProbe(TOKEN, shown.b, TIMING).before();
    await settle();
    return ["quick", "terrain"].map((m) => shown.page.text.includes(`data-mode="${m}"`));
  };
  expect([await offers(), await offers("terrain,soak")]).toEqual([[true, false], [false, true]]);
  const card = renderer();
  const { b } = browser({ clock: () => h.now + card.spent(), expected, mode: "terrain", tests: "terrain,soak" });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  await probe.before();
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, card.r);
  // How far the camera strays from the body it would follow.
  let strayed = 0;
  // And what the far feed had sent before the far bases.
  let sent = -1;
  const each = (): void => {
    strayed = Math.max(strayed, Math.hypot(app.cam.x - app.session.own.x, app.cam.z - app.session.own.z));
    if (probe.report.stage === "terrain far 0") sent = app.session.far.chunks.size;
  };
  await run(probe, h, app, card.r, 60000, { each });
  const r = probe.report;
  expect([r.done, r.errors, r.probes]).toEqual([true, [], null]);
  const t = r.terrain!;
  expect([t.side, t.flights.map((f) => f.tier)]).toEqual([512, ["medium", "lowpoly"]]);
  for (const f of t.flights) {
    expect(f.frames).toBeGreaterThan(100);
    // Three jumps in 2 s of flight; on the proving ground the window is the whole map, so each is in at once.
    expect(f.fills).toEqual([1, 1, 1]);
  }
  expect(strayed).toBeGreaterThan(100);
  // Then far bases at medium: on the proving ground, in the chunks the near store does not hold whole and the feed sent
  // nothing for; taken away after. The proving ground's only far pieces are its own, which stand as the map placed them
  // and which the page draws from its copy of the map, so the feed has sent nothing and nothing is left.
  expect(t.far.map((g) => [g.asked, g.chunks, g.farDraws > 0])).toEqual([[0, 0, false], [130, 58, true], [480, 58, true]]);
  expect([sent, app.session.far.chunks.size, app.ui.settings.tier]).toEqual([0, 0, "medium"]);
  // Then the wood on each tier the device takes. The proving ground's far nodes are only in the chunks at its west and
  // north edges that the near field leaves out, which the turning camera faces in some rungs and not in others, as its
  // settling took longer or shorter: whether a rung drew any is not judged here.
  expect(t.wood.map((g) => `${g.tier} ${g.reach}${g.band ? " band" : ""}`)).toEqual(["lowpoly 500", "medium 1500", "high 1500", "medium 1500 band"]);
  expect(lacking(r, "terrain").filter((line) => !line.startsWith("wood "))).toEqual(["no frame on medium carried rows of the terrain window", "no frame on lowpoly carried rows of the terrain window", "far 130: bases stood in 58 chunks", "far 480: bases stood in 58 chunks", "the wood has no rung on ultra"]);
  const table = deviceTable(r);
  expect(table.some((line) => line.startsWith("terrain   a map 0.5 km across"))).toBe(true);
  expect(table.some((line) => /^58\/130 +(yes|GPU|ours|invalid) /.test(line))).toBe(true);
  expect(table.some((line) => /^high +(yes|GPU|ours|invalid) /.test(line))).toBe(true);

  // The soak on this server stands at the middle among the far bases, with nothing else, and takes them away after: 58
  // chunks of them, as above.
  probe.start("soak");
  let among = 0;
  await run(probe, h, app, card.r, 30000, { each: () => void (among = Math.max(among, app.session.far.chunks.size - sent)) });
  const s = probe.report.soak!;
  expect([probe.report.done, s.wood, s.load.bodies, s.minutes.length, among, app.session.far.chunks.size === sent]).toEqual([true, true, 0, 1, 58, true]);
  // The picture probes look at the proving ground, so a soak through the wood lacks none.
  expect(lacking(probe.report, "soak")).not.toContain("no probes");
  expect(deviceTable(probe.report).some((line) => line.startsWith("soak      high: turning once a minute (the terrain map's wood and 480 far base chunks round its middle"))).toBe(true);
});
