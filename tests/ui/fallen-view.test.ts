// The own survivor knocked down sees from its ragdoll's head; dying, the view reddens, closes in and goes black.
import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { DYING_MS, dying, fallenShown, headEye } from "../../client/core/view/fallen.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MF_DOWN } from "../../shared/sim/character.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const pack = parsePack(corePackBytes());

/** Ada on flat open ground, seen from her eye. */
function world() {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack), s = app.session;
  const run = (ms: number, each?: () => void): void => h.run(ms, (now) => { app.frame(now, 1280, 720); each?.(); });
  run(600);
  s.text("enablecheats");
  run(300);
  const g = flatGround(h, 40, 40);
  s.text(`tp ${g.x + 20} ${g.z + 20}`);
  run(600);
  if (app.view.thirdPerson) { app.key("KeyV", true); run(50); app.key("KeyV", false); run(300); }
  expect(app.view.thirdPerson).toBe(false);
  return { h, app, s, run, g };
}

test("knocked down, the eye rides the ragdoll's head near the ground", () => {
  const { h, app, s, run, g } = world();
  try {
    const e = h.ent(s), eye = new Float64Array(3), look = new Float64Array(2);
    expect(h.host.falls.knock(e, 0, 1, 3, 3, 0, 0)).toBe(true);
    let seen = 0, worst = 0;
    run(1200, () => {
      const fall = app.scene!.characters.humanFall(e);
      if ((s.own.mflags & MF_DOWN) === 0 || !fall?.down) return;
      headEye(fall, eye, look);
      // The follow lags the head a little while it falls fast; a settled body is where it is.
      worst = Math.max(worst, Math.hypot(app.cam.x - eye[0]!, app.cam.y - eye[1]!, app.cam.z - eye[2]!));
      seen++;
    });
    expect(seen).toBeGreaterThan(20);
    expect(worst).toBeLessThan(0.5);
    expect(app.cam.y - g.y).toBeLessThan(0.6);
    expect(app.hud.fallenRed).toBeGreaterThan(0.3);
    run(5000);
    expect([h.host.falls.isDown(e), app.hud.fallenRed]).toEqual([false, 0]);
  } finally { h.host.shutdown(); }
});

test("dying, the red closes in and is black by DYING_MS", () => {
  const out = fallenShown(), seen: number[][] = [];
  for (let ms = 0; ms <= DYING_MS + 200; ms += 100) { dying(ms, out); seen.push([out.red, out.reach, out.black]); }
  for (let k = 1; k < seen.length; k++) for (let j = 0; j < 3; j++) expect(seen[k]![j]!).toBeGreaterThanOrEqual(seen[k - 1]![j]!);
  expect(seen[4]![0]!).toBeGreaterThan(0.5);
  expect(seen[4]![2]!).toBeLessThan(0.1);
  expect(seen[DYING_MS / 100]![2]).toBe(1);
});

test("the own survivor killed sees the view go black over its body", () => {
  const { h, app, s, run } = world();
  try {
    const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
    h.host.survival.hurt(rec, 1e6, 0);
    let red = 0;
    run(DYING_MS + 500, () => {
      red = Math.max(red, app.hud.fallenRed);
    });
    expect(red).toBeGreaterThan(0.9);
    expect(app.hud.fallenBlack).toBe(1);
    expect(app.hud.banner).toBe("DEAD");
    // The camera rides its body, drawn without the head it looks out of.
    expect(app.scene!.headless).toBeGreaterThanOrEqual(0);
  } finally { h.host.shutdown(); }
});
