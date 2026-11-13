import { expect, test } from "bun:test";
import { HudModel, headingOf, minimapImage, updateHud } from "../../client/core/hud.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { probePasses, provingProbes } from "../../client/core/selfcheck.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import { provingView } from "../../tools/snap.ts";
import { Harness } from "../fixtures/net.ts";

test("HUD coordinates, compass and minimap markers follow the map convention", () => {
  const h = new Harness();
  const a = h.join("ada");
  h.join("bo");
  h.run(600);
  const hud = new HudModel();
  const remote = new RemoteSample();
  a.sampleRemote(remote);
  updateHud(hud, a, remote, 60);
  // Spawn is at x 256, z 240 on a 512 m map: centre longitude, a little south of centre.
  expect(hud.lon).toBeCloseTo(50, 0);
  expect(hud.lat).toBeCloseTo((1 - 240 / 512) * 100, 0);
  expect(hud.compass).toBe("N");
  expect(hud.nearby).toBe(1);
  expect(hud.markers.map((m) => m.kind)).toEqual(["player", "self"]);
  expect(hud.vitals.map((v) => v.id)).toEqual(["health", "stamina", "food", "water"]);

  // Walking north lowers latitude; north is up on the minimap.
  const v0 = hud.markers[1]!.v;
  h.pilots[0]!.moveZ = 1;
  h.run(2000);
  a.sampleRemote(remote);
  updateHud(hud, a, remote, 60);
  expect(hud.markers[1]!.v).toBeLessThan(v0);
  expect(hud.speed).toBeGreaterThan(4);

  // Facing +X is west (270), facing -X is east (90).
  expect(headingOf(Math.PI / 2)).toBeCloseTo(270, 6);
  expect(headingOf(-Math.PI / 2)).toBeCloseTo(90, 6);
  expect(headingOf(Math.PI)).toBeCloseTo(180, 6);
});

test("the minimap image is the terrain seen from above with north up and east right", () => {
  const view = provingView(64, 36);
  const size = 128;
  const img = minimapImage(view.hf, view.pack.palette, size);
  const at = (x: number, z: number): number[] => {
    const px = Math.floor((1 - x / 512) * size);
    const py = Math.floor((1 - z / 512) * size);
    return [...img.subarray((py * size + px) * 4, (py * size + px) * 4 + 3)];
  };
  const plaza = at(256, 230);
  expect(Math.abs(plaza[0]! - plaza[2]!)).toBeLessThan(12); // grey
  const steep = at(240, 300); // the 60 degree strip is red
  expect(steep[0]!).toBeGreaterThan(steep[2]! * 1.5);
  const gentle = at(200, 320); // the 10 degree strip is green
  expect(gentle[1]!).toBeGreaterThan(gentle[2]! * 1.3);
});

test("the self-check probes pass on the reference renderer and fail on a wrong picture", () => {
  const W = 320;
  const H = 180;
  const view = provingView(W, H);
  view.cam.pitch = 0;
  view.remote.count = 0;
  view.render();
  const probes = provingProbes(view.cam, view.reg, view.pack.palette, SKY_COLOR, view.hf);
  expect(probes.map((p) => p.name)).toEqual(["sky", "plaza", "block", "slope"]);
  for (const p of probes) {
    const o = (Math.floor(p.sy * H) * W + Math.floor(p.sx * W)) * 4;
    expect(probePasses(p, view.raster.color[o]!, view.raster.color[o + 1]!, view.raster.color[o + 2]!)).toBe(true);
    expect(probePasses(p, 0, 0, 0)).toBe(false);
    expect(probePasses(p, 255, 0, 255)).toBe(false);
  }
});
