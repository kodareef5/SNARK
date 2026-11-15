// A survivor knocked out, on the server and in his own client: he lies down and can do nothing, sees the dark, and comes
// round when his torpor has gone. Apart from buffs.test.ts, whose other client test it would wait behind, so the two
// run side by side.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_BANNER, KEY_OUT, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { MF_OUT, STANCE_PRONE } from "../../shared/sim/character.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

test("a survivor knocked out lies down, can do nothing, sees the dark, and comes round; flak keeps most of a dart out", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = corePack();
  const app = new App(h.join("bob", {}, { manual: true }), h.reg, pack);
  app.frame(0, 1280, 720);
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(500);
  const s = app.session;
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  const survival = h.host.survival;
  const f = app.ui.frame;
  const e = h.ent(s);
  const ents = h.world.ents;
  // 150 of his 200 torpor. It falls 4 a second.
  survival.add(rec, V_TORPOR, 150);
  run(300);
  expect(f.find(KEY_VITAL + 11)!.value).toBeGreaterThan(0.7);
  expect(f.find(KEY_OUT)).toBeNull();
  run(5000);
  expect(survival.value(rec, V_TORPOR)).toBeCloseTo(150 - 4 * 5.3, 0);
  expect(rec.out).toBe(false);
  survival.add(rec, V_TORPOR, 200);
  app.controls.key("KeyW", true);
  app.controls.mouseButton(0, true);
  const [x, z] = [ents.x[e]!, ents.z[e]!];
  run(1500);
  expect(rec.out).toBe(true);
  expect(ents.mflags[e]! & MF_OUT).toBe(MF_OUT);
  // His own client predicts the same state, so the server corrects nothing.
  expect(ents.stance[e]).toBe(STANCE_PRONE);
  expect(Math.hypot(ents.x[e]! - x, ents.z[e]! - z)).toBeLessThan(0.3);
  expect([ents.act[e], s.own.act]).toEqual([ACT_NONE, ACT_NONE]);
  expect(s.own.stance).toBe(STANCE_PRONE);
  const corrections = s.stats.corrections;
  run(1000);
  expect(s.stats.corrections).toBe(corrections);
  expect(f.find(KEY_OUT)!.alpha).toBeGreaterThan(0.5);
  expect(f.find(KEY_BANNER)!.text).toBe("UNCONSCIOUS");
  // 200 torpor at 4 a second is gone in fifty seconds.
  run(51000);
  expect(rec.out).toBe(false);
  expect(f.find(KEY_OUT)).toBeNull();
  run(1500);
  expect(Math.hypot(ents.x[e]! - x, ents.z[e]! - z)).toBeGreaterThan(2);
  app.controls.release();
});
