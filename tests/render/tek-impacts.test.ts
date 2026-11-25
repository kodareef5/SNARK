import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLOW, DETAIL_TEK, FramePacket } from "../../client/core/render/packet.ts";
import { inField, rippleStrength, RIPPLE_MS, RIPPLE_SPEED } from "../../client/core/render/tek-ripple.ts";
import { ClientSession, RemoteSample } from "../../client/core/session.ts";
import { Shots } from "../../client/core/shots.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { corePack } from "../fixtures/pack.ts";
import { EVENT_SHOT } from "../../shared/net/protocol.ts";
import { flatWorld } from "../fixtures/world.ts";

function setup(pack?: Pack) {
  const world = flatWorld(), reg = world.reg;
  const session = new ClientSession({ open: true, send() {}, close() {}, onMessage: null, onClose: null },
    { name: "field", key: new Uint8Array(16), registry: reg, resolveMap: () => null });
  const cam = new Camera(), p = new FramePacket(), shots = new Shots(reg, pack);
  cam.x = session.own.x = 31;
  cam.y = session.own.y = 1.5;
  cam.z = session.own.z = 26;
  const wall = (x: number, z = 32, name = "tek", yaw = 0) => world.structs.add(world.kind(`core:wall_${name}`), x, 1.5, z, yaw, 3, 100);
  const fire = (x: number, time = 0, remote: RemoteSample | null = null) => {
    session.fired.push({ x, y: 1.5, z: 26, yaw: 0, pitch: 0, cone: 0, seed: 1, draw: 1,
      ammo: world.kind("core:round_pistol"), weapon: world.kind("core:pistol") });
    shots.absorb(session, world, time, remote);
  };
  const cards = (now: number) => {
    p.detailCount = 0;
    shots.tekImpacts.build(world.structs, cam, now);
    shots.tekImpacts.write(p);
    return Array.from({ length: p.detailCount }, (_, i) => {
      const at = i * DETAIL_FLOATS;
      return { flag: (p.detailWords[at + DETAIL.misc]! >>> 8) & 255,
        x: cam.x + p.details[at]!, z: cam.z + p.details[at + 2]!, radius: p.details[at + DETAIL.floor]! };
    });
  };
  return { wall, fire, cards, world, cam, session, shots };
}

test("a pistol starts a field ripple at its hit on the plate", () => {
  const { wall, fire, cards, world } = setup();
  const ref = wall(32);
  fire(31.33);
  const [first] = cards(0);
  expect(first?.flag).toBe(DETAIL_TEK);
  expect(first?.x).toBeCloseTo(31.33, 4);
  expect(first?.z).toBeCloseTo(31.947, 4);
  expect(cards(120)[0]!.radius).toBeCloseTo(0.025 + 120 * RIPPLE_SPEED);
  expect(world.structs.chunks[ref >>> 16]!.hp[ref & 65535]).toBe(100);
  expect(cards(RIPPLE_MS)).toBeEmpty();
});

test("a crest lights only the facing rail of the adjoining Tek wall", () => {
  const { wall, fire, cards, world } = setup();
  wall(32);
  const ref = wall(29, 32, "tek", 32768);
  wall(35);
  fire(31);
  expect(cards(35).map((a) => a.flag)).toEqual([DETAIL_TEK]);
  const flash = cards(100).find((a) => a.flag === DETAIL_GLOW)!;
  expect(flash.x).toBeCloseTo(30.3, 3);
  expect(flash.z).toBeCloseTo(31.913, 3);
  world.structs.remove(ref);
  expect(cards(110).map((a) => a.flag)).toEqual([DETAIL_TEK]);
});

test("a gap, a Metal neighbour and a turned wall do not carry the flash", () => {
  for (const [x, name, yaw] of [[28.85, "tek", 0], [29, "metal", 0], [29, "tek", 16384]] as const) {
    const { wall, fire, cards } = setup();
    wall(32);
    wall(x, 32, name, yaw);
    fire(31);
    expect(cards(100).map((a) => a.flag)).toEqual([DETAIL_TEK]);
  }
});

test("a foreground wall or body stops the field behind it from reacting", () => {
  const { world, wall, fire, cards } = setup();
  wall(32);
  const front = wall(32, 30, "metal");
  fire(31.33);
  expect(cards(40)).toBeEmpty();
  world.structs.remove(front);
  const remote = new RemoteSample();
  remote.count = 1;
  remote.kind[0] = world.kind("core:survivor");
  remote.x[0] = 31.33;
  remote.z[0] = 30;
  fire(31.33, 80, remote);
  expect(cards(110)).toBeEmpty();
});

test("frame hardware and cropped corners stay clear of the wave", () => {
  const { wall, fire, cards } = setup();
  wall(32);
  fire(33.4);
  expect(cards(0)).toBeEmpty();
  expect(inField(1.2, 1.24)).toBe(false);
  expect(rippleStrength(1.2, 1.24, 0.3, 0, 0.3)).toBe(0);
  expect(rippleStrength(1, 1, 0.3, 0, 0.3)).toBeCloseTo(1);
});

test("a remote shot ending on the rear face stays on that face", () => {
  const { wall, cards, world, cam, session, shots } = setup();
  wall(32);
  const event = { kind: EVENT_SHOT, x: 32.25, y: 1.5, z: 38, zone: 0, damage: 0, kill: false, blocked: false, bearing: 0,
    side: false, silenced: false, name: "", item: world.kind("core:round_rifle"), far: 0, level: 0, xp: 0,
    flies: false, vx: 32.25, vy: 1.5, vz: 32.5, back: 0, rays: 1, seed: 0, id: 0, own: false, surface: 0, made: 0 };
  session.events.push(event);
  shots.absorb(session, world, 0);
  cam.z = 38;
  expect(cards(0)).toBeEmpty();
  session.events.push({ ...event, vz: 32.1 });
  shots.absorb(session, world, 20);
  expect(cards(20)[0]!.z).toBeCloseTo(32.053);
  cam.z = 26;
  expect(cards(30)).toBeEmpty();
});

test("a flying plasma bolt reacts when its flight reaches the plate", () => {
  const { wall, cards, world, session, shots } = setup(corePack());
  wall(32);
  session.fired.push({ x: 31.6, y: 1.5, z: 26, yaw: 0, pitch: 0, cone: 0, seed: 1, draw: 1,
    ammo: world.kind("core:plasma_cell"), weapon: world.kind("core:rifle_plasma") });
  shots.absorb(session, world, 0);
  expect(cards(0)).toBeEmpty();
  shots.step(world, null, 1, 16);
  shots.step(world, null, 2, 50);
  expect(cards(50)[0]?.flag).toBe(DETAIL_TEK);
});

test("repeated shots keep a bounded set and a volley shares one crest", () => {
  const { wall, fire, cards } = setup();
  wall(32);
  for (let n = 0; n < 10; n++) {
    fire(32 + n / 30, n * 10);
    fire(32 - n / 30, n * 10);
  }
  expect(cards(100)).toHaveLength(4);
  expect(cards(100).every((c) => c.flag === DETAIL_TEK)).toBe(true);
});
