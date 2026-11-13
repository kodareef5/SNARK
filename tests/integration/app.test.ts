import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_CONSOLE_INPUT, KEY_CONSOLE_ROW } from "../../client/core/ui/console.ts";
import { KEY_BANNER, KEY_CROSS, KEY_READOUT, KEY_STATUS, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { buildCorePack } from "../../tools/pack/build.ts";
import { Harness } from "../fixtures/net.ts";

const pack = parsePack(buildCorePack());

/** A whole client (input, session, scene, interface) on the harness's virtual clock. */
function client(h: Harness, name: string): App {
  return new App(h.join(name, { latencyMs: 20 }, { manual: true }), h.reg, pack);
}

function consoleRows(app: App): string[] {
  const out: string[] = [];
  const f = app.ui.frame;
  for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_CONSOLE_ROW) out.push(f.nodes[i]!.text);
  return out;
}

test("a headless client boots, draws, walks, and its interface says where it is", () => {
  const h = new Harness();
  const app = client(h, "ada");
  // Before the world arrives there is nothing to draw, and the interface says why.
  expect(app.frame(0, 1280, 720)).toBeNull();
  expect(app.ui.frame.find(KEY_STATUS)!.text).toBe("connecting");
  let packet = null;
  h.run(500, (now) => (packet = app.frame(now, 1280, 720)));
  expect(packet).not.toBeNull();
  expect(packet!.drawCount).toBeGreaterThan(5);
  expect(app.ui.frame.find(KEY_STATUS)).toBeNull();
  expect(app.ui.frame.find(KEY_CROSS)).not.toBeNull();
  expect(app.ui.frame.find(KEY_READOUT)!.text).toBe("53.1 lat  50.0 lon  N 0");
  expect(app.ui.frame.find(KEY_VITAL + 3)!.value).toBe(1); // stamina, from the predicted body

  app.key("KeyW", true);
  h.run(2000, (now) => app.frame(now, 1280, 720));
  app.key("KeyW", false);
  h.run(500, (now) => app.frame(now, 1280, 720));
  const e = h.ent(app.session);
  expect(h.world.ents.z[e]! - 240).toBeGreaterThan(7);
  expect(app.session.own.z).toBe(h.world.ents.z[e]!);
  expect(app.cam.z).toBe(app.session.own.z);
  expect(app.cam.y).toBeCloseTo(app.session.own.y + 1.62, 5);
  expect(app.ui.frame.find(KEY_READOUT + 1)!.text).toContain(`z ${app.session.own.z.toFixed(1)}`);
});

test("the console is typed into, answered by the server, and holds the keyboard while it is open", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = client(h, "ada");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 1280, 720));
  run(500);
  const e = h.ent(app.session);
  const ents = h.world.ents;

  // Walking, then opening the console: the held key is let go, so the body stops.
  app.key("KeyW", true);
  run(500);
  expect(app.key("Backquote", true)).toBe(true);
  expect(app.ui.captureKeyboard).toBe(true);
  run(500);
  const z = ents.z[e]!;
  expect(z).toBeGreaterThan(241);
  // Keys typed into the console do not steer.
  expect(app.key("KeyW", true)).toBe(false);
  app.mouseButton(0, true);
  app.look(500, 0);
  run(500);
  expect(ents.z[e]).toBe(z);
  expect(app.controls.buttons).toBe(0);
  expect(app.controls.yaw).toBe(0);

  app.textInput(KEY_CONSOLE_INPUT, "help");
  app.key("Enter", true);
  run(300);
  expect(app.ui.frame.find(KEY_CONSOLE_INPUT)!.text).toBe("");
  const rows = consoleRows(app);
  expect(rows[0]).toBe("> help");
  expect(rows).toContain("enablecheats <password>");
  expect(rows).not.toContain("kick <name>");

  app.textInput(KEY_CONSOLE_INPUT, "enablecheats");
  app.key("Enter", true);
  run(300);
  app.textInput(KEY_CONSOLE_INPUT, "spectate");
  app.key("Enter", true);
  run(300);
  expect(consoleRows(app).at(-1)).toContain("spectating");
  expect(app.ui.frame.find(KEY_BANNER)!.text).toBe("SPECTATING");
  expect(app.ui.frame.find(KEY_CROSS)).toBeNull();
  expect(app.session.admin).toBe(true);
  // The camera is the ghost body itself, with no eye height added, once the
  // change of viewpoint has finished gliding (a correction is smoothed, not snapped).
  expect(Math.abs(app.cam.y - app.session.own.y)).toBeLessThan(0.2);
  run(900);
  expect(app.cam.y).toBe(app.session.own.y);

  // History: up recalls the last line.
  app.key("ArrowUp", true);
  run(50);
  expect(app.ui.frame.find(KEY_CONSOLE_INPUT)!.text).toBe("spectate");
  app.key("Escape", true);
  expect(app.ui.captureKeyboard).toBe(false);
  run(50);
  expect(app.ui.frame.find(KEY_CONSOLE_INPUT)).toBeNull();
  // Closed: the same key steers again, now flying the camera.
  app.key("KeyW", true);
  run(500);
  expect(app.session.own.z).toBeGreaterThan(z + 3);
});

test("a closed connection is reported on the interface", () => {
  const h = new Harness();
  const app = client(h, "ada");
  h.run(300, (now) => app.frame(now, 1280, 720));
  h.server.reject(h.client(app.session)!, 7);
  let packet: unknown = 1;
  h.run(300, (now) => (packet = app.frame(now, 1280, 720)));
  expect(packet).toBeNull();
  expect(app.ui.frame.find(KEY_STATUS)!.text).toBe("disconnected (reason 7)");
});

test("the inventory screen moves and eats through the server, and the HUD bars are the server's numbers", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = client(h, "ada");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 1280, 720));
  const type = (line: string) => {
    app.key("Backquote", true);
    app.textInput(KEY_CONSOLE_INPUT, line);
    app.key("Enter", true);
    app.key("Backquote", true);
    run(300);
  };
  run(500);
  type("enablecheats");
  type("give stone 150");
  type("give berry 5");
  const rec = h.host.records.byPid.get(h.client(app.session)!.pid)!;
  const inv = h.host.items.inv(rec);
  h.host.survival.add(rec, V_FOOD, -30);
  run(300);
  // The food bar is what the server holds.
  expect(app.ui.frame.find(KEY_VITAL + 5)!.value).toBeCloseTo(h.host.survival.value(rec, V_FOOD) / 100, 4);

  app.key("KeyI", true);
  run(50);
  const slot = (s: number) => KEY_INV_SLOT + s * 3;
  expect(app.ui.frame.find(slot(0) + 2)!.text).toBe("100");
  expect(app.ui.frame.find(slot(1) + 2)!.text).toBe("50");
  // Pick up the 50 and put it in slot 9.
  app.pointer(0, slot(1), 0, 0, 0);
  app.pointer(0, slot(9), 0, 0, 0);
  run(300);
  expect(inv.count[9]).toBe(50);
  expect(inv.item[1]).toBe(0);
  expect(app.ui.frame.find(slot(9) + 2)!.text).toBe("50");
  expect(app.ui.frame.find(slot(1) + 2)).toBeNull();
  // Eat a berry with a right click.
  const berries = app.session.inventory!.item.indexOf(h.reg.index.get("core:berry")!);
  const food = h.host.survival.value(rec, V_FOOD);
  app.pointer(0, slot(berries), 0, 0, 2);
  run(300);
  expect(inv.count[berries]).toBe(4);
  expect(h.host.survival.value(rec, V_FOOD)).toBeGreaterThan(food + 3.9);
  expect(app.ui.frame.find(slot(berries) + 2)!.text).toBe("4");
  // The screen leaves the keyboard to the body.
  const z = h.world.ents.z[h.ent(app.session)]!;
  app.key("KeyW", true);
  run(1000);
  expect(h.world.ents.z[h.ent(app.session)]!).toBeGreaterThan(z + 2);
  expect(h.host.items.audit()).toEqual([]);
});
