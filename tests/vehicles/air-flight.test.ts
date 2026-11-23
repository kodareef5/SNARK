import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { AirCamera } from "../../client/core/air-camera.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { handleIndex } from "../../shared/ids.ts";
import { chunkAt } from "../../shared/coords.ts";
import { EVENT_BLAST, RESULT_OK } from "../../shared/net/protocol.ts";
import { AIR_ACTION, emptyAirSupport } from "../../shared/sim/air-support.ts";
import { BTN_AIR_REMOTE, BTN_PRIMARY, BTN_SPRINT } from "../../shared/sim/character.ts";
import { InputBuffer } from "../../shared/net/protocol.ts";
import { AIR_FRAME, airBayZ } from "../../shared/world/air-support-art.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { frozenPack } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

test("the drone camera predicts the look at once and takes the server's word", () => {
  const camera = new AirCamera(), view = emptyAirSupport(), inputs = new InputBuffer(128);
  view.tick = 100; view.flight = 7;
  const row = { id: 7, ent: 3, x: 13, y: 6, z: 8, yaw: 0, pitch: 0, fuel: 1, bay: 4, signal: 1, launched: 40, speed: 20, turn: 2 };
  view.drones.push(row);
  camera.receive(view, inputs, 100);
  expect(camera.sample()!.x).toBe(13);
  // A look a quarter turn right is followed on the very next tick, before any server row.
  const right = Math.round(Math.PI / 2 * 32768 / Math.PI);
  for (let t = 101; t <= 110; t++) { inputs.set(t, 0, 0, right, 0, BTN_AIR_REMOTE); camera.step(t, right, 0, BTN_AIR_REMOTE); }
  const ahead = camera.sample()!;
  expect(ahead.yaw).toBeGreaterThan(.3);
  expect(ahead.z).toBeGreaterThan(8 + 5);
  // The server, a few ticks behind, agreeing at tick 105 changes nothing; disagreeing replays from it.
  view.tick = 105; view.drones[0] = { ...row, x: 13 + 100 };
  camera.receive(view, inputs, 110);
  expect(camera.sample()!.x).toBeGreaterThan(110);
  expect(camera.stats.replays).toBe(5);
  camera.receive(emptyAirSupport(), inputs, 110);
  expect(camera.sample()).toBeNull();
});

function waitFor(h: Harness, done: () => boolean, seconds = 45): void {
  for (let at = 0; at < seconds * 10 && !done(); at++) h.run(100);
  expect(done()).toBe(true);
}

function setup() {
  const h = new Harness({ entityRadius: 1, structRadius: 1 }, 35, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(12)) });
  h.host.setSetting("AirSupportOrderRequired", "False");
  const pilot = h.join("driver", { latencyMs: 45, jitterMs: 4 }), observer = h.join("observer");
  h.run(800);
  const c = h.client(pilot)!, ents = h.world.ents;
  const truck = h.host.spawnVehicle("core:semi", 220, 200, h.host.records.byPid.get(c.pid)!.team);
  const seat = h.reg.vehicle[ents.kind[truck]!]!.seats[0]!;
  const point = [0, 0, 0];
  h.host.urban.door(truck, seat, h.reg.move[ents.kind[c.ent]!]!.radius, point);
  ents.setPosition(c.ent, point[0]!, point[1]!, point[2]!);
  expect(h.host.urban.mount(c, truck)).toBe(RESULT_OK);
  ents.setPosition(h.ent(observer), 225, 0, 400);
  h.run(1500);
  pilot.airCommand(AIR_ACTION.trailer);
  waitFor(h, () => !!pilot.airSupport.pod, 120);
  const pod = pilot.airSupport.pod;
  pilot.airCommand(AIR_ACTION.panels, pod);
  waitFor(h, () => pilot.airSupport.pods.some(p => p.id === pod && p.open === 1));
  return { h, pilot, observer, c, ents, truck, pod };
}

test("a remote flight streams the far scene and leaves its driver parked", () => {
  const { h, pilot, observer, c, ents, truck, pod } = setup();
  try {
    const wall = h.reg.index.get("core:wall")!;
    const wallRef = h.world.structs.add(wall, 224, 1.5, 404, 0, 0, 100);
    const farChunk = wallRef >>> 16, homeChunk = c.chunk;
    const homeX = ents.x[truck]!, homeZ = ents.z[truck]!;
    expect(c.known[farChunk]).toBe(0);
    const release: { side: number; along: number; up: number; pitch: number }[] = [];
    const previous = h.server.onStep!;
    h.server.onStep = tick => {
      previous(tick);
      const f = h.host.airSupport.flights.camera(c);
      if (!f || release.length >= 16) return;
      const rack = h.host.airSupport.view(c).pods.find(p => p.id === pod)!;
      const dx = f.x - rack.x, dz = f.z - rack.z;
      const cs = Math.cos(rack.yaw), sn = Math.sin(rack.yaw);
      release.push({ side: dx * cs - dz * sn, along: dx * sn + dz * cs, up: f.y - rack.y, pitch: f.pitch });
    };
    pilot.airCommand(AIR_ACTION.launch, pod, 0);
    waitFor(h, () => pilot.airCamera.id > 0);
    const controls = h.pilots[0]!;
    controls.yaw = 0; controls.pitch = .05; controls.moveZ = 1; controls.buttons = BTN_SPRINT | BTN_PRIMARY;
    waitFor(h, () => (pilot.mapFocus?.z ?? 0) > 386, 15);
    expect(pilot.airSupport.drones[0]!.fuel).toBeLessThan(.9);
    expect(c.chunk).toBe(homeChunk);
    expect(c.known[farChunk]).toBeGreaterThan(0);
    expect(pilot.world!.structs.chunks[farChunk]!.live).toBeGreaterThan(0);
    // The trailer leans a little on its springs, so the cradle is measured to the centimetres.
    expect(Math.abs(release[0]!.side)).toBeLessThan(.1);
    expect(Math.abs(release[0]!.along - airBayZ(0))).toBeLessThan(.1);
    expect(Math.abs(release[0]!.up - AIR_FRAME.deck - AIR_FRAME.bayY)).toBeLessThan(.1);
    expect(release[0]!.pitch).toBe(0);
    expect(release[15]!.side).toBeCloseTo(1.45, 1);
    expect(release[15]!.up - release[0]!.up).toBeCloseTo(1.27, 1);
    expect(pilot.driving).toBe(truck);
    expect(Math.hypot(ents.x[truck]! - homeX, ents.z[truck]! - homeZ)).toBeLessThan(.5);
    expect(ents.seat[c.ent]).toBe(truck + 1);
    const seen = new RemoteSample();
    pilot.sampleRemote(seen);
    expect([...seen.id.subarray(0, seen.count)]).toContain(h.ent(observer));
    expect(observer.airSupport.drones.some(d => d.id === pilot.airCamera.id)).toBe(true);
    expect(observer.airSupport.flight).toBe(0);
    controls.moveZ = controls.buttons = 0;
    pilot.airCommand(AIR_ACTION.leave, pilot.airCamera.id);
    waitFor(h, () => !pilot.airCamera.id);
    expect(pilot.mapFocus).toBe(pilot.place);
    expect(chunkAt(h.world.dims, pilot.mapFocus!.x, pilot.mapFocus!.z)).toBe(homeChunk);
    expect(pilot.airSupport.pods.find(p => p.id === pod)!.slots & 1).toBe(0);
    expect(c.drive).toBe(truck);
  } finally { h.host.shutdown(); }
});

test("fuel, payload and disconnect each consume only their launched bay", () => {
  const { h, pilot, c, pod } = setup();
  try {
    expect(h.host.rules.assign("AirDroneFuel", "1", "console")).toBe("");
    expect(h.host.rules.assign("AirDroneBurn", "2", "console")).toBe("");
    pilot.airCommand(AIR_ACTION.launch, pod, 0);
    waitFor(h, () => !!pilot.airCamera.id);
    waitFor(h, () => !pilot.airCamera.id);
    expect(pilot.airSupport.notice.toLowerCase()).toContain("fuel");
    expect(h.host.rules.assign("AirDroneFuel", "45", "console")).toBe("");
    pilot.airCommand(AIR_ACTION.launch, pod, 1);
    waitFor(h, () => !!pilot.airCamera.id);
    h.run(1200);
    let blasts = 0;
    h.host.projectiles.heard.push(kind => { if (kind === "blast") blasts++; });
    const spent = pilot.airCamera.id;
    pilot.airCommand(AIR_ACTION.payload, spent);
    pilot.airCommand(AIR_ACTION.payload, spent);
    waitFor(h, () => !pilot.airCamera.id);
    expect(blasts).toBe(1);
    pilot.airCommand(AIR_ACTION.launch, pod, 2);
    waitFor(h, () => !!pilot.airCamera.id);
    const next = pilot.airCamera.id;
    pilot.airCommand(AIR_ACTION.payload, spent);
    h.run(300);
    expect(pilot.airCamera.id).toBe(next);
    pilot.close();
    h.run(700);
    expect(h.server.replication.cameraChunk?.(c)).toBeUndefined();
    expect(blasts).toBe(1);
    const back = h.join("driver");
    h.run(900);
    expect(back.airSupport.flight).toBe(0);
    expect(back.airSupport.pods.find(p => p.id === pod)!.slots & 7).toBe(0);
  } finally { h.host.shutdown(); }
});

test("a rack owner steers through the camera and returns to the same body", () => {
  const pack = frozenPack();
  const h = new Harness({}, 7, 60, { clips: pack.clips, rigs: pack.header.rigs, map: writeMap(flatMap(8)) });
  try {
    const pilot = h.join("operator", {}, { manual: true });
    const app = new App(pilot, h.reg, pack);
    const run = (ms: number) => h.run(ms, now => app.frame(now, 480, 300));
    run(800);
    const c = h.client(pilot)!, actor = h.host.records.byPid.get(c.pid)!;
    const { ents } = h.world;
    const x = ents.x[c.ent]! + 5, z = ents.z[c.ent]!;
    const trailer = h.host.spawnVehicle("core:air_trailer", x, z, actor.team, 0);
    h.host.airSupport.begin(JSON.stringify({ next: 2, calls: [], cooldown: [], racks: [{
      id: 1, pid: ents.pid[trailer]!, open: 1, opening: true, slots: 63, selected: 0, owner: c.pid, team: actor.team,
    }] }));
    app.controls.yaw = 1.05; app.controls.pitch = -.12;
    run(300);
    expect(pilot.airSupport.pod).toBe(1);
    pilot.airCommand(AIR_ACTION.launch, 1, 3);
    run(600);
    expect(pilot.airCamera.id).toBeGreaterThan(0);
    app.controls.pitch = .30;
    app.controls.key("KeyW", true);
    run(700);
    const focus = pilot.mapFocus!;
    expect(Math.hypot(app.cam.x - focus.x, app.cam.z - focus.z)).toBeLessThan(.01);
    expect(Math.hypot(app.cam.x - pilot.own.x, app.cam.z - pilot.own.z)).toBeGreaterThan(10);
    expect(ents.x[c.ent]).toBeCloseTo(x - 5, 2);
    const rec = h.host.records.byPid.get(c.pid)!;
    rec.out = true;
    run(350);
    expect(pilot.airCamera.id).toBe(0);
    expect(app.controls.moveZ).toBe(0);
    expect(app.controls.yaw).toBeCloseTo(1.05, 5);
    expect(app.controls.pitch).toBeCloseTo(-.12, 5);
    expect(Math.hypot(app.cam.x - pilot.own.x, app.cam.z - pilot.own.z)).toBeLessThan(7);
  } finally { h.host.shutdown(); }
});

test("the flight stops at the ground and its payload applies once", () => {
  const { h, pilot, pod } = setup();
  try {
    let hits = 0;
    h.host.projectiles.heard.push(kind => { if (kind === "blast") hits++; });
    pilot.airCommand(AIR_ACTION.launch, pod, 5);
    waitFor(h, () => !!pilot.airCamera.id);
    const controls = h.pilots[0]!;
    controls.yaw = Math.PI / 2; controls.pitch = -1.35;
    waitFor(h, () => !pilot.airCamera.id);
    expect(pilot.airSupport.notice).toContain("payload");
    expect(hits).toBe(1);
    const burst = pilot.events.find(event => event.kind === EVENT_BLAST)!;
    expect(Math.abs(burst.y - h.world.hf.heightAt(burst.x, burst.z))).toBeLessThan(.06);
    h.run(1000);
    expect(hits).toBe(1);
    expect(pilot.airSupport.pods.find(p => p.id === pod)!.slots & (1 << 5)).toBe(0);
  } finally { h.host.shutdown(); }
});

test("the operator's camera agrees with the server through a steering turn", () => {
  const { h, pilot, pod } = setup();
  try {
    pilot.airCommand(AIR_ACTION.launch, pod, 2);
    waitFor(h, () => !!pilot.airCamera.id);
    const controls = h.pilots[0]!;
    controls.yaw = 0; controls.pitch = .1;
    h.run(1500);
    const replays = pilot.airCamera.stats.replays;
    // A hard turn, at 45 ms of latency: what the operator sees is what the server flies.
    controls.yaw = 1.4;
    h.run(2000);
    const flown = h.host.airSupport.flights.camera(h.client(pilot)!)!;
    const seen = pilot.airCamera.sample()!;
    expect(pilot.airCamera.stats.error).toBeLessThan(.01);
    expect(pilot.airCamera.stats.replays - replays).toBeLessThan(40);
    // The camera runs ahead of the server by the latency, along the same path.
    expect(Math.hypot(seen.x - flown.x, seen.z - flown.z)).toBeLessThan(flown.speed * .3);
  } finally { h.host.shutdown(); }
});

test("a shot drone goes down and cuts its operator's feed", () => {
  const { h, pilot, pod, c } = setup();
  try {
    pilot.airCommand(AIR_ACTION.launch, pod, 1);
    waitFor(h, () => !!pilot.airCamera.id);
    h.run(1000);
    const flight = h.host.airSupport.flights.camera(c)!;
    const drone = h.host.records.byPid.get(h.world.ents.pid[handleIndex(flight.ent)]!)!;
    expect(h.reg.ids[h.world.ents.kind[handleIndex(flight.ent)]!]).toBe("core:survey_drone");
    h.host.survival.hurt(drone, 1e6, 0);
    waitFor(h, () => !pilot.airCamera.id, 5);
    expect(pilot.airSupport.notice).toContain("shot down");
    expect(pilot.airSupport.pods.find(p => p.id === pod)!.slots & (1 << 1)).toBe(0);
  } finally { h.host.shutdown(); }
});
