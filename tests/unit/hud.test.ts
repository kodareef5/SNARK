import { expect, test } from "bun:test";
import { HudModel, headingOf, minimapImage, updateHud } from "../../client/core/hud.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { heldTo, probePasses, provingProbes } from "../../client/core/selfcheck.ts";
import { MARKER_DEATH, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import { latOf, lonOf } from "../../shared/world/coords.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../../shared/world/proving.ts";
import { provingView } from "../../tools/snap.ts";
import { Harness } from "../fixtures/net.ts";

test("HUD coordinates, compass and minimap markers follow the map convention", () => {
  const h = new Harness();
  const a = h.join("ada");
  const b = h.join("bo");
  h.run(600);
  const hud = new HudModel();
  const remote = new RemoteSample();
  a.sampleRemote(remote);
  updateHud(hud, a, remote, 60);
  // Spawn is at x 256, z 240 on a 512 m map, so longitude is 50 and latitude a little south of centre.
  expect(hud.lon).toBeCloseTo(50, 0);
  expect(hud.lat).toBeCloseTo((1 - 240 / 512) * 100, 0);
  expect(hud.compass).toBe("N");
  expect(hud.nearby).toBe(1);
  // The survivor beside it is of another tribe, and by the server's rule is not marked.
  expect(hud.markers.map((m) => m.kind)).toEqual(["self"]);
  expect(hud.vitals.map((v) => v.id)).toEqual(["health", "stamina", "food", "water", "oxygen", "torpor"]);

  // Walking north lowers latitude, and north is up on the minimap.
  const v0 = hud.markers[0]!.v;
  h.pilots[0]!.moveZ = 1;
  h.run(2000);
  a.sampleRemote(remote);
  updateHud(hud, a, remote, 60);
  expect(hud.markers[0]!.v).toBeLessThan(v0);
  expect(hud.speed).toBeGreaterThan(4);
  h.pilots[0]!.moveZ = 0;

  // Markers are listed the most important first: the reader, its mates, its tames, strangers if the rule shows them, then creatures in view.
  const kinds = (): string[] => {
    h.run(1500);
    a.sampleRemote(remote);
    updateHud(hud, a, remote, 60);
    return hud.markers.map((m) => m.kind);
  };
  const ents = h.world.ents;
  const wild = h.host.spawnCreature("core:dummy", ents.x[h.ent(a)]! + 6, ents.z[h.ent(a)]! + 6, 1);
  const mine = h.host.spawnCreature("core:dummy", ents.x[h.ent(a)]! - 6, ents.z[h.ent(a)]! + 6, 1);
  const rec = (s: typeof a) => h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.taming.give(h.host.records.byPid.get(ents.pid[mine]!)!, rec(a), 0, "forced");
  expect(h.host.setSetting("MapPlayers", "view")).toBe("");
  expect(kinds()).toEqual(["self", "tame", "player", "creature"]);
  h.host.tribes.create(rec(a), "Night Shift");
  h.host.tribes.invite(rec(a), rec(b), true);
  h.host.tribes.accept(rec(b));
  expect(kinds()).toEqual(["self", "mate", "tame", "creature"]);
  // The mate and the tame are also in the server's marks, and are drawn once, from the view.
  h.run(10000);
  expect(a.tactical.marks.count).toBe(3);
  expect(kinds()).toEqual(["self", "mate", "tame", "creature"]);
  expect(ents.team[wild]).toBe(0);
  // While it chooses where to return to life, the places it may choose are marked, after its deaths.
  a.sessionState = SESSION_DEAD;
  a.markers.push({ kind: MARKER_DEATH, x: 200, y: 0, z: 200, tick: 1 });
  a.respawnPoints.push({ kind: 0, name: "Plaza", x: 256, z: 240, readyAt: 0 });
  updateHud(hud, a, remote, 60);
  expect(hud.markers.map((m) => m.kind)).toEqual(["self", "mate", "tame", "death", "spawn", "creature"]);
  expect([hud.markers[4]!.u, hud.markers[4]!.v]).toEqual([lonOf(h.world.hf, 256) / 100, latOf(h.world.hf, 240) / 100]);

  // Facing +X is west (270) and facing -X is east (90).
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
  // Put the grazer and the survivor's body at the probe's spots, as the probe server does.
  const r = view.remote;
  r.x[1] = PROBE_CREATURE.x;
  r.z[1] = PROBE_CREATURE.z;
  r.y[1] = view.hf.heightAt(PROBE_CREATURE.x, PROBE_CREATURE.z);
  r.colors[6] = PROBE_CREATURE.color;
  r.x[0] = PROBE_BODY.x;
  r.z[0] = PROBE_BODY.z;
  r.y[0] = view.hf.heightAt(PROBE_BODY.x, PROBE_BODY.z);
  const packet = view.render();
  const probes = provingProbes(view.cam, view.reg, view.pack.palette, SKY_COLOR, view.hf, true, packet);
  expect(probes.map((p) => p.name)).toEqual(["sky", "plaza", "block", "slope", "creature", "body"]);
  for (const p of probes) {
    const o = (Math.floor(p.sy * H) * W + Math.floor(p.sx * W)) * 4;
    expect(probePasses(p, view.raster.color[o]!, view.raster.color[o + 1]!, view.raster.color[o + 2]!)).toBe(true);
    expect(probePasses(p, 0, 0, 0)).toBe(false);
    expect(probePasses(p, 255, 0, 255)).toBe(false);
  }
  // With the creature in its species' own colour the creature probe fails, so the check sees colour regions.
  r.colors[6] = 0;
  // Moving the body stands in for bones that were never applied, and the body probe fails.
  r.x[0] = PROBE_BODY.x + 2;
  view.render();
  for (const c of [probes[4]!, probes[5]!]) {
    const o = (Math.floor(c.sy * H) * W + Math.floor(c.sx * W)) * 4;
    expect(probePasses(c, view.raster.color[o]!, view.raster.color[o + 1]!, view.raster.color[o + 2]!)).toBe(false);
  }
});

test("on a lit tier the creature probe holds its colour to the facing nearest it, and still tells its region's colour from the species' own", () => {
  const view = provingView(320, 180);
  view.cam.pitch = 0;
  view.scene.assets.tier = tierOf("medium");
  view.scene.plainSky = true;
  const r = view.remote;
  [r.x[1], r.z[1], r.y[1]] = [PROBE_CREATURE.x, PROBE_CREATURE.z, view.hf.heightAt(PROBE_CREATURE.x, PROBE_CREATURE.z)];
  const pal = view.pack.palette;
  const dot = (a: readonly number[], b: readonly number[]): number => (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (Math.hypot(a[0]!, a[1]!, a[2]!) * Math.hypot(b[0]!, b[1]!, b[2]!));
  // What a GPU read off the grazer at the probe server's hours, where the twin facing the camera says 0.9974 to 0.9999.
  const gpu: Record<string, number[]> = { "7.5": [183, 154, 55], "9": [145, 132, 52], "12": [102, 97, 41] };
  for (const [hour, got] of Object.entries(gpu)) {
    view.scene.hour = Number(hour);
    const packet = view.scene.build(view.cam, r);
    const creature = provingProbes(view.cam, view.reg, pal, SKY_COLOR, view.hf, true, packet).find((p) => p.name === "creature")!;
    expect(creature.facings!.length).toBeGreaterThan(32);
    expect(probePasses(creature, got[0]!, got[1]!, got[2]!)).toBe(true);
    expect(dot(heldTo(creature, got[0]!, got[1]!, got[2]!), got)).toBeGreaterThan(0.9995);
    // The grazer in its species' own colour, lit from any facing, is not taken for the region's.
    const own = provingProbes(view.cam, view.reg, Uint8Array.from(pal, (c, i) => (i >> 2 === PROBE_CREATURE.color ? pal[9 * 4 + (i & 3)]! : c)), SKY_COLOR, view.hf, true, packet).find((p) => p.name === "creature")!;
    for (const c of [own.rgb, ...own.facings!]) expect(probePasses(creature, c[0], c[1], c[2])).toBe(false);
  }
});
