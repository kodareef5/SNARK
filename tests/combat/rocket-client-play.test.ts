// Two clients and a server: one fires the launcher, both draw the rocket, and both end it at the server's blast
// (client/core/shots.ts). The watcher's rocket is within a tick's travel of the server's, and each client's fire is told
// the same blast.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import type { Blasts } from "../../client/core/render/blasts.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT } from "../../shared/net/protocol.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

/** What a client's fire was told, noted on the way to the scene's own. */
class Fire {
  readonly bursts: number[][] = [];
  readonly launches: boolean[] = [];
  flying = 0;
  constructor(real: Blasts) {
    const { fly, end, launch, burst } = real;
    real.fly = (...a) => (this.flying++, fly.apply(real, a));
    real.end = (...a) => (this.flying--, end.apply(real, a));
    real.launch = (...a) => (this.launches.push(a[10]), launch.apply(real, a));
    real.burst = (...a) => (this.bursts.push(a), burst.apply(real, a));
  }
}

test("a rocket one client fires flies on both and ends on both at its blast", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = corePack();
  const app = new App(h.join("ada", { latencyMs: 40 }, { manual: true }), h.reg, pack);
  const eve = new App(h.join("eve", { latencyMs: 40 }, { manual: true }), h.reg, pack);
  let packet = app.frame(0, 1280, 720);
  let seen = eve.frame(0, 1280, 720);
  const run = (ms: number): void =>
    h.run(ms, (now) => {
      packet = app.frame(now, 1280, 720);
      seen = eve.frame(now, 1280, 720);
    });
  run(500);
  // Each has a scene once its world has come.
  const fires = [app, eve].map((a) => new Fire(a.scene!.blasts));
  const say = (who: App, line: string): void => {
    who.session.text(line);
    run(200);
  };
  say(app, "enablecheats");
  say(eve, "enablecheats");
  const g = flatGround(h, 24, 44);
  const at = { x: g.x + 12, z: g.z + 1.5 };
  say(app, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  say(eve, `tp ${(at.x + 8).toFixed(3)} ${(at.z + 10).toFixed(3)}`);
  eve.controls.yaw = -Math.PI / 2;
  const id = (name: string): number => h.reg.index.get(`core:${name}`)!;
  say(app, "give core:rocket_launcher 1");
  say(app, "give core:rocket 3");
  const s = app.session, inv = s.inventory!;
  const from = inv.item.indexOf(id("rocket_launcher")), to = inv.hotbar;
  if (from !== to) s.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(to), w.u16(0), w.u16(id("rocket_launcher"))));
  run(150);
  s.command(CMD_SELECT, (w) => w.u8(0));
  // It comes to hand and loads: four seconds.
  run(5200);
  expect(s.own.rounds).toBe(1);
  const meshes = (p: typeof packet): string[] => [...p!.drawMesh.subarray(0, p!.drawCount)].filter((_, d) => (p!.drawFlags[d]! & DRAW_SKINNED) !== 0).map((m) => pack.header.meshes[m]!.id);
  // Loaded, the round is drawn in her tube on both screens.
  expect(meshes(seen).filter((m) => m === "core:rocket_round").length).toBe(1);
  // Up and north, steeply enough that its 300 m end within her hearing of the blast.
  app.controls.yaw = 0;
  app.controls.pitch = 0.7;
  run(300);
  app.controls.mouseButton(0, true);
  run(70);
  app.controls.mouseButton(0, false);
  // Hers is drawn before the server has fired it, leaving her muzzle: her launcher flashes for her.
  expect(app.shots.flying.map((f) => [f.own, f.id])).toEqual([[true, 0]]);
  expect(fires[0]!.launches).toEqual([true]);
  expect(Math.hypot(app.shots.flying[0]!.ox, app.shots.flying[0]!.oy, app.shots.flying[0]!.oz)).toBeGreaterThan(0.3);
  run(250);
  const shots = h.host.projectiles;
  expect(shots.flyingCount).toBe(1);
  // The server told both: hers took its number and no second started; the watcher's flies and flashed too.
  expect(app.shots.flying.length).toBe(1);
  expect(app.shots.flying[0]!.id).toBeGreaterThan(0);
  expect(eve.shots.flying.map((f) => [f.own, f.id])).toEqual([[false, app.shots.flying[0]!.id]]);
  expect(fires[1]!.launches).toEqual([false]);
  expect(fires.map((f) => f.flying)).toEqual([1, 1]);
  // Fired, her tube is empty on the watcher's screen: the round is up and away, out of its view.
  expect(meshes(seen)).toContain("core:rocket_launcher");
  expect(meshes(seen)).not.toContain("core:rocket_round");
  // The watcher's is where the server's was when its frame's tick was: within a tick's travel and the link's delay.
  const mine = eve.shots.flying[0]!, theirs = app.shots.flying[0]!;
  const tickTravel = h.reg.ammoSpeed[id("rocket")]! / TICK_RATE;
  expect(Math.hypot(mine.x - theirs.x, mine.y - theirs.y, mine.z - theirs.z)).toBeLessThan(tickTravel * 8);
  // Both fall on one path: a tick apart, their climbs differ by a tick of the rocket's gravity.
  expect(Math.abs(mine.vy - theirs.vy)).toBeLessThan((8 * h.reg.ammoGravity[id("rocket")]!) / TICK_RATE);
  run(6000);
  // It came down or ran out; each client ended it at the one blast, and drew that blast from the same seed.
  expect(shots.flyingCount).toBe(0);
  expect([app.shots.flying.length, eve.shots.flying.length]).toEqual([0, 0]);
  expect(fires.map((f) => f.bursts.length)).toEqual([1, 1]);
  expect(fires[0]!.bursts[0]!.slice(0, 11)).toEqual(fires[1]!.bursts[0]!.slice(0, 11));
  expect(fires[0]!.bursts[0]![0]).toBe(h.reg.burstLook[id("rocket")]!);
  expect(fires.map((f) => f.flying)).toEqual([0, 0]);
});
