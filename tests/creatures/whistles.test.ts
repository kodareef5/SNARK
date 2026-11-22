// The client's keys and menu for the orders the creature rules built (server/taming.ts order): the attack whistles,
// the fourth stance and wandering, as a player gives them through the whole client.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_OPEN_ORDER, KEY_OPEN_WANDER } from "../../client/core/ui/inventory.ts";
import type { EntityRecord } from "../../server/records.ts";
import { STANCE_AGGRESSIVE, STANCE_NEUTRAL, STANCE_PASSIVE, STANCE_YOURS } from "../../server/behavior.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

/** Ada in the whole client on level ground with two dodos of hers and a wild one before her, all told to stand. */
function field() {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(400);
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 6 };
  s.text(`tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  run(400);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.survival.gods.add(me.pid);
  const put = (x: number, z: number): { e: number; rec: EntityRecord } => {
    const e = h.host.spawnCreature("core:dodo", x, z, 1);
    expect(e).toBeGreaterThanOrEqual(0);
    h.host.creatures.mind.stay(e, h.world.tick + 1e6);
    return { e, rec: h.host.records.byPid.get(h.world.ents.pid[e]!)! };
  };
  const mine = [put(at.x - 2, at.z + 1), put(at.x + 2, at.z + 1)];
  for (const m of mine) expect(h.host.taming.give(m.rec, me, 0.9, "forced")).toBe(true);
  const wild = put(at.x, at.z + 3);
  // Each new tame asks for a name. She gives none.
  run(400);
  for (let k = 0; k < 4 && app.ui.captureKeyboard; k++) tap(app, "Escape", run);
  expect(app.ui.captureKeyboard).toBe(false);
  return { h, app, run, mine, wild };
}

/** Points her view at the middle of entity `e`. */
function aim(h: Harness, app: App, e: number): void {
  const ents = h.world.ents;
  const s = app.session;
  const eye = s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance);
  const [dx, dz] = [ents.x[e]! - s.own.x, ents.z[e]! - s.own.z];
  app.controls.yaw = Math.atan2(dx, dz);
  app.controls.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * 0.5 - eye, Math.hypot(dx, dz));
}

/** A key pressed and let go. */
function tap(app: App, code: string, run: (ms: number) => void): void {
  app.key(code, true);
  run(60);
  app.key(code, false);
  run(300);
}

test("the period key sends every creature of hers that hears at the body she looks at, and the right bracket gives them her target for theirs", () => {
  const { h, app, run, mine, wild } = field();
  const mind = h.host.creatures.mind;
  aim(h, app, wild.e);
  run(300);
  expect(app.target).toBe(wild.e);
  tap(app, "Period", run);
  expect(mine.map((m) => mind.targetOf(m.e))).toEqual([wild.e, wild.e]);
  tap(app, "BracketRight", run);
  expect(mine.map((m) => [m.rec.stance, mind.stance[m.e]])).toEqual([[STANCE_YOURS, STANCE_YOURS], [STANCE_YOURS, STANCE_YOURS]]);
  // Looking at nothing, the period key names nothing.
  app.controls.pitch = 1.2;
  run(300);
  expect(app.target).toBe(-1);
});

test("in her creature's menu the stance button comes round through attack your target, and the wander button sets it wandering until pressed again, when it stays", () => {
  const { h, app, run, mine } = field();
  const [blue] = mine as [{ e: number; rec: EntityRecord }];
  const s = app.session;
  aim(h, app, blue.e);
  run(300);
  tap(app, "KeyF", run);
  expect([s.open !== null, s.subject?.owned, s.subject?.id, s.subject?.stance, s.subject?.wandering]).toEqual([true, true, blue.e, STANCE_NEUTRAL, false]);
  const stances: number[] = [];
  for (let k = 0; k < 4; k++) {
    app.pointer(0, KEY_OPEN_ORDER + 1, 0, 0, 0);
    run(400);
    stances.push(blue.rec.stance);
  }
  expect(stances).toEqual([STANCE_AGGRESSIVE, STANCE_YOURS, STANCE_PASSIVE, STANCE_NEUTRAL]);
  app.pointer(0, KEY_OPEN_WANDER, 0, 0, 0);
  run(400);
  expect([blue.rec.wander, s.subject?.wandering, app.ui.frame.find(KEY_OPEN_WANDER)?.text.startsWith("Stop")]).toEqual([true, true, true]);
  app.pointer(0, KEY_OPEN_WANDER, 0, 0, 0);
  run(400);
  expect([blue.rec.wander, blue.rec.follow, s.subject?.wandering, app.ui.frame.find(KEY_OPEN_WANDER)?.text]).toEqual([false, 0, false, "Wander"]);
});
