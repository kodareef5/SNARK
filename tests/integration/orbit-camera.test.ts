import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { GamepadInput } from "../../client/core/gamepad.ts";
import { LOOK_SPEED } from "../../client/core/controls.ts";
import { ORBIT_NOTCH } from "../../client/core/orbit.ts";
import { ORBIT_BACK } from "../../client/core/viewpoint.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { KEY_CROSS } from "../../client/core/ui/hud.ts";
import { CMD_VEHICLE, RESULT_OK, SESSION_ALIVE } from "../../shared/net/protocol.ts";
import { CH_RELIABLE } from "../../shared/net/transport.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { orbitScene } from "../../tools/snap/orbit.ts";

const pack = parsePack(corePackBytes());

/** A survivor on flat open ground with cheats on, her whole client framed every frame. */
function survivor(h: Harness, name: string) {
  const app = new App(h.join(name, {}, { manual: true }), h.reg, pack);
  return app;
}

function world() {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = survivor(h, "ada"), s = app.session;
  const apps = [app];
  const run = (ms: number, each?: () => void): void => h.run(ms, (now) => { for (const a of apps) a.frame(now, 1280, 720); each?.(); });
  run(600);
  s.text("enablecheats");
  run(300);
  const g = flatGround(h, 40, 40);
  s.text(`tp ${g.x + 20} ${g.z + 20}`);
  run(600);
  return { h, app, s, run, apps, g };
}

const tap = (app: App, run: (ms: number) => void, code: string): void => {
  app.key(code, true);
  run(50);
  app.key(code, false);
  run(50);
};

const camAt = (app: App): number[] => [app.cam.x, app.cam.y, app.cam.z];
const gap = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

test("K on foot swings the camera round the body without turning it, the wheel moves it, and K again brings the view back", () => {
  const { h, app, s, run } = world();
  try {
    const c = app.controls;
    c.yaw = .4; c.pitch = -.1;
    run(300);
    // First person: the camera is at the eye, and that eye is the orbit's pivot.
    const eye = camAt(app);
    expect(app.wheel(100)).toBe(false);
    expect(app.ui.frame.find(KEY_CROSS)).not.toBeNull();
    tap(app, run, "KeyK");
    expect(app.orbit.on).toBe(true);
    run(400);
    // K swings the camera round to face her, at third person's distance.
    const front = [eye[0]! + Math.sin(.4) * Math.cos(-.1) * ORBIT_BACK, eye[1]! - Math.sin(-.1) * ORBIT_BACK, eye[2]! + Math.cos(.4) * Math.cos(-.1) * ORBIT_BACK];
    expect(gap(camAt(app), front)).toBeLessThan(1e-3);
    expect(app.cam.yaw).toBeCloseTo(.4 + Math.PI, 9);
    // The mouse swings the camera; the body's facing, and the look the input carries, stay.
    app.look(-1000, 200);
    run(200);
    expect([c.yaw, c.pitch]).toEqual([.4, -.1]);
    expect(app.scene!.own!.yaw).toBe(.4);
    const yaw = .4 + Math.PI + 1000 * LOOK_SPEED * c.zoom, pitch = -.1 - 200 * LOOK_SPEED * c.zoom;
    expect(app.orbit.yaw).toBeCloseTo(yaw, 9);
    expect(app.cam.yaw).toBeCloseTo(yaw, 9);
    expect(app.cam.pitch).toBeCloseTo(pitch, 9);
    const want = [eye[0]! - Math.sin(yaw) * Math.cos(pitch) * ORBIT_BACK, eye[1]! - Math.sin(pitch) * ORBIT_BACK, eye[2]! - Math.cos(yaw) * Math.cos(pitch) * ORBIT_BACK];
    expect(gap(camAt(app), want)).toBeLessThan(1e-3);
    // No crosshair: the middle of the screen is not where the body aims.
    expect(app.hud.orbit).toBe(true);
    expect(app.ui.frame.find(KEY_CROSS)).toBeNull();
    // A wheel notch away, in the browser's pixels, then back in its lines.
    expect(app.wheel(100, 0)).toBe(true);
    run(600);
    expect(gap(camAt(app), eye)).toBeCloseTo(ORBIT_BACK * ORBIT_NOTCH, 2);
    expect(app.wheel(-3, 1)).toBe(true);
    run(600);
    expect(gap(camAt(app), eye)).toBeCloseTo(ORBIT_BACK, 2);
    // K again: the camera comes back to the eye over the ease, never jumping, and looks where the body does.
    app.key("KeyK", true);
    app.key("KeyK", false);
    let last = camAt(app), most = 0;
    h.run(500, (now) => { app.frame(now, 1280, 720); most = Math.max(most, gap(camAt(app), last)); last = camAt(app); });
    expect(most).toBeLessThan(.5);
    expect(app.orbit.inUse).toBe(false);
    expect(gap(camAt(app), eye)).toBeLessThan(1e-9);
    expect([app.cam.yaw, app.cam.pitch]).toEqual([.4, -.1]);
    expect(app.ui.frame.find(KEY_CROSS)).not.toBeNull();
    expect(app.wheel(100)).toBe(false);
    expect(s.sessionState).toBe(SESSION_ALIVE);
    // The picture tool's --orbit sets the same view up by degrees and notches.
    orbitScene(app, run, "30,20,2");
    expect(app.orbit.on).toBe(true);
    expect(app.cam.yaw).toBeCloseTo(.4 + Math.PI + Math.PI / 6, 6);
    expect(app.cam.pitch).toBeCloseTo(-.1 - 20 * Math.PI / 180, 6);
    expect(gap(camAt(app), eye)).toBeCloseTo(ORBIT_BACK * ORBIT_NOTCH ** 2, 1);
    expect([c.yaw, c.pitch]).toEqual([.4, -.1]);
  } finally { h.host.shutdown(); }
});

test("what the server receives while orbiting is what standing still with the mouse untouched sends, plus real movement and actions", () => {
  const { h, app, s, run } = world();
  try {
    const c = app.controls, conn = h.client(s)!;
    c.yaw = 1.1; c.pitch = .05;
    run(500);
    const end = h.ends[h.sessions.indexOf(s)]!, send = end.send.bind(end);
    let reliable = 0;
    end.send = (channel: number, data: Uint8Array) => { if (channel === CH_RELIABLE) reliable++; send(channel, data); };
    let seen = conn.newestInput;
    const got: string[] = [];
    const record = (): void => {
      const n = conn.inputs;
      for (let t = seen + 1; t <= conn.newestInput; t++) if (n.has(t)) {
        const i = t & n.mask;
        got.push(`${n.yaw[i]} ${n.pitch[i]} ${n.moveX[i]} ${n.moveZ[i]} ${n.buttons[i]}`);
      }
      seen = conn.newestInput;
    };
    // Standing still, the mouse untouched.
    run(1000, record);
    const still = [...got], stillReliable = reliable;
    expect(still.length).toBeGreaterThan(20);
    expect(new Set(still).size).toBe(1);
    // Orbiting: the mouse sweeps every frame and the wheel turns, in and out of the orbit.
    got.length = reliable = 0;
    app.key("KeyK", true); app.key("KeyK", false);
    let frame = 0;
    run(1500, () => {
      record();
      app.look(Math.sin(frame / 7) * 40, Math.cos(frame / 11) * 15);
      if (frame % 9 === 0) app.wheel(frame % 18 === 0 ? 120 : -100);
      frame++;
    });
    app.key("KeyK", true); app.key("KeyK", false);
    run(500, record);
    expect(got.length).toBeGreaterThan(50);
    expect(new Set(got)).toEqual(new Set(still));
    expect(reliable).toBe(stillReliable);
    // Walking and jumping in the orbit: the inputs carry them, still faced as the body was, and the body walks its own way.
    app.key("KeyK", true); app.key("KeyK", false);
    run(400);
    got.length = 0;
    const from = [s.own.x, s.own.z];
    app.key("KeyW", true);
    run(1200, () => { record(); app.look(30, 0); });
    app.key("Space", true);
    run(100, record);
    app.key("Space", false);
    app.key("KeyW", false);
    run(300, record);
    const [yaw, pitch] = still[0]!.split(" ");
    expect(got.every((line) => line.startsWith(`${yaw} ${pitch} 0 `))).toBe(true);
    expect(got.some((line) => line === `${yaw} ${pitch} 0 127 0`)).toBe(true);
    expect(got.some((line) => (Number(line.split(" ")[4]) & BTN_JUMP) !== 0)).toBe(true);
    const walked = Math.atan2(s.own.x - from[0]!, s.own.z - from[1]!);
    expect(Math.hypot(s.own.x - from[0]!, s.own.z - from[1]!)).toBeGreaterThan(2);
    expect(Math.abs(Math.atan2(Math.sin(walked - 1.1), Math.cos(walked - 1.1)))).toBeLessThan(.05);
    expect(c.yaw).toBe(1.1);
  } finally { h.host.shutdown(); }
});

test("the rule against third person forbids the orbit and ends one under way; from third person the orbit eases back to the shoulder", () => {
  const { h, app, s, run } = world();
  try {
    const c = app.controls;
    c.yaw = -.7; c.pitch = 0;
    tap(app, run, "KeyV");
    run(200);
    expect(app.view.thirdPerson).toBe(true);
    const shoulder = camAt(app);
    tap(app, run, "KeyK");
    run(400);
    app.look(600, 0);
    run(100);
    expect(gap(camAt(app), shoulder)).toBeGreaterThan(1);
    // K again from third person lands back on the shoulder view.
    tap(app, run, "KeyK");
    run(400);
    expect(app.orbit.inUse).toBe(false);
    expect(gap(camAt(app), shoulder)).toBeLessThan(1e-9);
    // Under way when the server turns the rule off: it eases out to the eye, which is all the rule leaves.
    tap(app, run, "KeyK");
    run(400);
    app.look(-500, 0);
    expect(app.orbit.on).toBe(true);
    s.text("setting AllowThirdPersonPlayer False");
    run(300);
    expect(s.thirdPerson).toBe(false);
    expect(app.orbit.on).toBe(false);
    run(400);
    expect(app.orbit.inUse).toBe(false);
    expect(app.view.thirdPerson).toBe(false);
    expect(app.cam.yaw).toBe(-.7);
    // K does nothing while the rule is off, and works again once it is back.
    tap(app, run, "KeyK");
    expect(app.orbit.inUse).toBe(false);
    s.text("setting AllowThirdPersonPlayer True");
    run(300);
    tap(app, run, "KeyK");
    expect(app.orbit.on).toBe(true);
  } finally { h.host.shutdown(); }
});

test("dying ends the orbit; getting on a mount cuts it, the camera easing from where it was; on the mount K orbits it without turning it", () => {
  const { h, app, s, run } = world();
  try {
    const c = app.controls;
    c.yaw = 0; c.pitch = -.1;
    tap(app, run, "KeyK");
    run(400);
    app.look(-1200, 0);
    run(100);
    // A saddled tame of hers two metres off.
    const ents = h.world.ents, client = h.client(s)!, me = h.host.records.byPid.get(client.pid)!;
    const e = h.host.spawnCreature("core:parasaur", s.own.x + 2, s.own.z, 1), rec = h.host.records.byPid.get(ents.pid[e]!)!;
    rec.team = me.team; rec.saddle = h.reg.index.get("core:saddle_parasaur")!;
    h.host.refreshBody(rec); h.host.creatures.claimed(e); h.host.creatures.mind.stay(e, 0xffffffff);
    run(200);
    expect(app.orbit.on).toBe(true);
    expect(h.host.riding.mount(client, e)).toBe(RESULT_OK);
    // From the orbit's last frame to the chase view behind the mount: no frame jumps or turns far.
    let last = camAt(app), lastYaw = app.cam.yaw, most = 0, turned = 0, cut = false;
    h.run(1500, (now) => {
      app.frame(now, 1280, 720);
      if (s.driving < 0) { last = camAt(app); lastYaw = app.cam.yaw; return; }
      cut ||= !app.orbit.inUse;
      most = Math.max(most, gap(camAt(app), last));
      turned = Math.max(turned, Math.abs(Math.atan2(Math.sin(app.cam.yaw - lastYaw), Math.cos(app.cam.yaw - lastYaw))));
      last = camAt(app); lastYaw = app.cam.yaw;
    });
    expect(s.driving).toBe(e);
    expect(cut).toBe(true);
    expect(most).toBeLessThan(1);
    expect(turned).toBeLessThan(.35);
    // Orbiting the mount: the camera goes round it, the mount and the look keep their facing, and the wheel lengthens the boom.
    const heading = ents.yaw[e]!;
    run(300);
    const behind = camAt(app), pivot = [s.own.x, 0, s.own.z];
    tap(app, run, "KeyK");
    expect(app.orbit.on).toBe(true);
    run(600);
    // K swings the camera round in front of the mount, about as far from it.
    expect(Math.abs(app.cam.yaw - Math.PI)).toBeLessThan(.02);
    expect(app.cam.z - pivot[2]!).toBeGreaterThan(2);
    expect(behind[2]! - pivot[2]!).toBeLessThan(-2);
    // A quarter turn of the mouse takes it to the mount's side; the mount and the look keep their facing.
    app.look(-Math.PI / 2 / (LOOK_SPEED * c.zoom), 0);
    run(600);
    expect([c.yaw, c.pitch]).toEqual([0, -.1]);
    expect(ents.yaw[e]).toBe(heading);
    expect(Math.abs(app.cam.yaw - 1.5 * Math.PI)).toBeLessThan(.02);
    expect(app.cam.x - pivot[0]!).toBeGreaterThan(2);
    const boom = Math.hypot(app.cam.x - s.own.x, app.cam.z - s.own.z);
    for (let i = 0; i < 4; i++) app.wheel(100);
    run(1500);
    expect(Math.hypot(app.cam.x - s.own.x, app.cam.z - s.own.z)).toBeGreaterThan(boom * 1.6);
    // Getting off cuts it as getting on did.
    h.host.riding.dismount(client);
    run(900);
    expect(s.driving).toBe(-1);
    expect(app.orbit.inUse).toBe(false);
    // Orbiting on foot again, then dying: it ends, and the dead are not shown an orbit.
    tap(app, run, "KeyK");
    expect(app.orbit.on).toBe(true);
    s.text("suicide");
    run(300);
    expect(s.sessionState).not.toBe(SESSION_ALIVE);
    expect(app.orbit.on).toBe(false);
    run(400);
    expect(app.orbit.inUse).toBe(false);
    tap(app, run, "KeyK");
    expect(app.orbit.inUse).toBe(false);
  } finally { h.host.shutdown(); }
});

test("at a patrol car's wheel K is the lights and no orbit; another car's driver gets neither; a passenger orbits the car", () => {
  const { h, app, s, run, apps, g } = world();
  try {
    const rider = survivor(h, "bo"), r = rider.session;
    apps.push(rider);
    run(600);
    r.text("enablecheats");
    run(300);
    const x = g.x + 20, z = g.z + 12;
    s.text(`tp ${x + 1.55} ${z + .22}`);
    r.text(`tp ${x - 1.55} ${z + .22}`);
    run(600);
    const jeep = h.host.spawnVehicle("core:patrol_jeep", x, z, 0, 0), compact = h.host.spawnVehicle("core:compact", x + 13, z, 0, 0);
    expect(h.host.urban.mount(h.client(s)!, jeep)).toBe(RESULT_OK);
    expect(h.host.urban.mount(h.client(r)!, jeep)).toBe(RESULT_OK);
    run(1200);
    expect(s.driving).toBe(jeep);
    expect(r.own.seatSlot).toBe(2);
    const lights = (): number => { app.session.sampleRemote(app.remote); return app.remote.vehicleLightMode[app.remote.id.subarray(0, app.remote.count).indexOf(jeep)]!; };
    const sent: number[] = [];
    const command = s.command.bind(s);
    s.command = ((kind: number, body?: Parameters<ClientSession["command"]>[1]) => { sent.push(kind); return command(kind, body); }) as ClientSession["command"];
    expect(lights()).toBe(0);
    tap(app, run, "KeyK");
    run(300);
    expect(sent).toEqual([CMD_VEHICLE]);
    expect(lights()).toBe(1);
    expect(app.orbit.inUse).toBe(false);
    // The passenger's K orbits the car: her look stays, her camera goes round, and the lights are not hers to change.
    const look = [rider.controls.yaw, rider.controls.pitch], before = rider.cam.yaw;
    tap(rider, run, "KeyK");
    expect(rider.orbit.on).toBe(true);
    rider.look(-2 / (LOOK_SPEED * rider.controls.zoom), 0);
    run(500);
    expect([rider.controls.yaw, rider.controls.pitch]).toEqual(look);
    const turned = rider.cam.yaw - before - Math.PI - 2;
    expect(Math.abs(Math.atan2(Math.sin(turned), Math.cos(turned)))).toBeLessThan(.05);
    expect(lights()).toBe(1);
    // A driver's chase camera already swings freely: in a car without lights K does nothing at all.
    h.host.urban.dismount(h.client(s)!);
    run(1500);
    s.text(`tp ${x + 13 + 1.55} ${z + .22}`);
    run(600);
    expect(h.host.urban.mount(h.client(s)!, compact)).toBe(RESULT_OK);
    run(1200);
    expect(s.driving).toBe(compact);
    sent.length = 0;
    tap(app, run, "KeyK");
    run(200);
    expect(sent).toEqual([]);
    expect(app.orbit.inUse).toBe(false);
  } finally { h.host.shutdown(); }
});

test("a pad's LB and B press K, so the pad orbits where the keyboard does and changes a patrol car's lights at the wheel", () => {
  const pad = { connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const keys: string[] = [], driver = new GamepadInput();
  const target = {
    inMenu: false, inspecting: false, flying: false, patrol: false,
    key: (code: string, down: boolean) => { keys.push(`${code}:${down}`); }, mouse: () => {}, move: () => {}, look: () => {},
    navigate: () => {}, adjust: () => false, used: () => {},
  };
  let now = 0;
  const step = (): void => driver.update([pad], now += 16, target);
  pad.buttons[4]!.pressed = true; step();
  pad.buttons[1]!.pressed = true; step();
  pad.buttons[1]!.pressed = false; pad.buttons[4]!.pressed = false; step();
  expect(keys).toEqual(["KeyK:true", "KeyK:false"]);
  // B alone still opens the inventory.
  keys.length = 0;
  pad.buttons[1]!.pressed = true; step();
  pad.buttons[1]!.pressed = false; step();
  expect(keys).toEqual(["KeyI:true", "KeyI:false"]);
});
