// A drone feed's HUD (client/core/hud/air-feed.ts, client/core/hud/tracks.ts): a box round each body it sees and none
// round one the world hides, the target under its reticle, and N marking that target for the tribe from the drone.

import { expect, test } from "bun:test";
import { FEED, buildFeed } from "../../client/core/hud/air-feed.ts";
import { KEY_TRACKS, LOCK_MS, TRACKS, buildTracks, trackBodies, type TracksModel } from "../../client/core/hud/tracks.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { CMD_MARK, DRONE_LOOK } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { flatWorld, sealedRoom, type TestWorld } from "../fixtures/world.ts";

/** A camera 20 m up and 30 m back from (x, z), looking at it. */
function droneOver(x: number, z: number): Camera {
  const cam = new Camera();
  cam.aspect = 16 / 9;
  cam.fovY = Math.PI / 3;
  cam.x = x; cam.y = 20; cam.z = z - 30;
  cam.yaw = 0;
  cam.pitch = Math.atan2(-19, 30);
  cam.update();
  return cam;
}

/** A body of `kind` standing at (x, z) on the ground, `n`th of `r`. */
function stand(w: TestWorld, r: RemoteSample, kind: string, x: number, z: number, team = 0): number {
  const n = r.count++;
  r.id[n] = 500 + n; r.gen[n] = 3; r.kind[n] = w.kind(kind);
  r.x[n] = x; r.y[n] = 0; r.z[n] = z; r.yaw[n] = 0;
  r.flags[n] = 1; r.level[n] = 12; r.team[n] = team; r.name[n] = "";
  return n;
}

const tracks = (): TracksModel => TRACKS.make!();

test("a body in view gets a box round its bounds on the screen, labelled with its species, level and range", () => {
  const w = flatWorld(4), r = new RemoteSample(), cam = droneOver(128, 128);
  stand(w, r, "core:trike", 128, 128);
  const m = tracks();
  trackBodies(m, cam, w, w.reg, r, -1, -1, 0, 0);
  expect(m.trackCount).toBe(1);
  const t = m.tracks[0]!, kind = w.kind("core:trike"), at = [0, 0, 0];
  // Its feet and its head project inside the box; a point beyond its radius to the side does not.
  cam.project(128, 0, 128, at);
  expect([at[0]! > t.u0 && at[0]! < t.u1, at[1]! > t.v0 && at[1]! <= t.v1 + 1e-9]).toEqual([true, true]);
  cam.project(128, w.reg.bodyHeight[kind]!, 128, at);
  expect(at[1]! >= t.v0 - 1e-9).toBe(true);
  cam.project(128 + w.reg.bodyRadius[kind]! * 2, 0, 128, at);
  expect(at[0]! < t.u0 || at[0]! > t.u1).toBe(true);
  expect(t.title).toBe("TRIKE");
  expect(t.line).toBe(`LV 12  ${Math.round(t.far)} M`);
  expect(t.far).toBeCloseTo(Math.hypot(30, 20 - w.reg.bodyHeight[kind]! / 2), 6);
  // In the middle of the view it is the target.
  expect(m.trackLock).toBe(0);
  // Drawn, once locked on: four corners of two panels each about that box.
  const f = new UiFrame();
  f.begin(16 / 9);
  m.trackNow = LOCK_MS + 1;
  buildTracks(f, m, f.width, f.height);
  const corners = f.nodes.slice(0, f.count).filter((n) => n.key >= KEY_TRACKS && n.key < KEY_TRACKS + 8);
  expect(corners.length).toBe(8);
  const left = Math.min(...corners.map((n) => n.x)), right = Math.max(...corners.map((n) => n.x + n.w));
  expect(Math.abs((left + right) / 2 - ((t.u0 + t.u1) / 2) * f.width)).toBeLessThan(4);
  expect(f.nodes.slice(0, f.count).some((n) => n.text === "TRIKE")).toBe(true);
});

test("a body the world hides gets no box; one in the open beside it does", () => {
  const w = flatWorld(4), r = new RemoteSample(), cam = droneOver(128, 128);
  sealedRoom(w, 128, 128);
  stand(w, r, "core:dodo", 128, 128);
  stand(w, r, "core:dodo", 136, 128);
  const m = tracks();
  trackBodies(m, cam, w, w.reg, r, -1, -1, 0, 0);
  expect(m.trackCount).toBe(1);
  expect(m.tracks[0]!.index).toBe(1);
});

test("boxes are the nearest ones, coloured by tribe, and the viewer's own body and the dead have none", () => {
  const w = flatWorld(4), r = new RemoteSample(), cam = droneOver(128, 128);
  const mine = stand(w, r, "core:raptor", 124, 128, 9);
  const theirs = stand(w, r, "core:raptor", 132, 128, 4);
  const wild = stand(w, r, "core:raptor", 128, 140);
  const own = stand(w, r, "core:survivor", 128, 120);
  r.flags[own] = 1 | 4;
  const m = tracks();
  trackBodies(m, cam, w, w.reg, r, r.id[own]!, -1, 9, 0);
  const by = (i: number): number => m.tracks.slice(0, m.trackCount).find((t) => t.index === i)?.owner ?? -1;
  expect([by(mine), by(theirs), by(wild), by(own)]).toEqual([1, 2, 0, -1]);
});

test("the feed's HUD shows its name, link, fuel and keys, and the target's readout", () => {
  const w = flatWorld(4), r = new RemoteSample(), cam = droneOver(128, 128);
  stand(w, r, "core:trike", 128, 128, 9);
  r.name[0] = "Mabel";
  const m = { ...FEED.make!(), ...tracks() };
  trackBodies(m, cam, w, w.reg, r, -1, -1, 9, 0);
  Object.assign(m, { feed: true, feedName: "BAY 4 · SRV-04", feedClock: "14:30:17", feedFuel: 0.15, feedSignal: 0.2, feedZoom: 2, trackHealth: 0.5 });
  const f = new UiFrame();
  f.begin(16 / 9);
  buildFeed(f, m, 0);
  const words = f.nodes.slice(0, f.count).map((n) => n.text);
  for (const word of ["REC", "BAY 4 · SRV-04", "LINK 20%", "ZOOM 2.0x", "FUEL 15%", "WEAK SIGNAL", "TGT  MABEL", "N  MARK"]) expect(words).toContain(word);
  expect(words.some((t) => t.startsWith("SHIFT BOOST") && t.includes("N MARK"))).toBe(true);
  buildFeed(f, m, 1);
  expect(f.nodes.slice(0, f.count).some((n) => n.text.startsWith("L3 BOOST"))).toBe(true);
});

test("N marks the creature a drone's camera holds for the tribe, which the body could not see", () => {
  const h = new Harness({}, 3, 60, { dev: true, map: writeMap(flatMap(48)) });
  try {
    const mid = 24 * CHUNK_SIZE, s = h.join("ada");
    h.run(1000);
    s.text("enablecheats");
    h.run(300);
    h.say(s, "tribe create Scouts");
    s.text(`tp ${mid} ${mid}`);
    h.run(1000);
    const c = h.client(s)!, team = h.host.records.byPid.get(c.pid)!.team;
    const target = h.host.spawnCreature("core:dodo", mid + 700, mid, 10);
    h.run(300);
    const gen = h.world.ents.gen[target]!, ents = h.world.ents;
    const mark = (): void => {
      s.command(CMD_MARK, (wr) => (wr.u32(target), wr.u16(gen)));
      h.run(300);
    };
    // From the body it is far out of sight.
    mark();
    expect(h.host.tactical.spotted(team)).toEqual([]);
    // A drone 40 m off it, looking straight at it.
    const eye = { x: mid + 700 - 30, y: ents.y[target]! + 20, z: mid, yaw: Math.PI / 2, pitch: Math.atan2(-19.6, 30) };
    h.host.game.players.remoteEye = (who) => (who === c ? eye : null);
    expect(h.host.overhead.lookedAt(c)).toBe(target);
    mark();
    expect(h.host.tactical.spotted(team)).toEqual([target]);
    // A drone farther off than it looks sees nothing to mark.
    const far = h.host.spawnCreature("core:dodo", mid + 700, mid + DRONE_LOOK + 100, 10);
    h.run(300);
    s.command(CMD_MARK, (wr) => (wr.u32(far), wr.u16(h.world.ents.gen[far]!)));
    h.run(300);
    expect(h.host.tactical.spotted(team)).toEqual([target]);
  } finally {
    h.host.shutdown();
  }
});
