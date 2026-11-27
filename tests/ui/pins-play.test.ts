// Pins in the whole client: placed on the corner chart or where one looks through a glass, seen by the tribe on its map,
// minimap and compass and by nobody outside it, removed from the list, and kept over a restart.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { PIN_TINT } from "../../client/core/pins.ts";
import { KEY_COMPASS } from "../../client/core/ui/compass.ts";
import { KEY_MARKER } from "../../client/core/ui/hud.ts";
import type { UiNode } from "../../client/core/ui/nodes.ts";
import { KEY_PIN_KIND, KEY_PIN_LABEL, KEY_PIN_REMOVE, KEY_PIN_ROW, KEY_PIN_SHARE } from "../../client/core/ui/pins-panel.ts";
import { KEY_MAP_CLOSE, KEY_MAP_MARK, KEY_MAP_MARK_TOOL, KEY_MAP_SAVE, KEY_MAP_SURFACE, KEY_MAP_TOOLS } from "../../client/core/ui/screens.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { WAYPOINT_KINDS } from "../../shared/world/course.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { HIT_NONE, castWorld, lookDirection, rayHit } from "../../shared/world/ray.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-pins-play-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const MAP = writeMap(flatMap(16));
const DANGER = WAYPOINT_KINDS.indexOf("danger");

function play(names: string[], dbPath?: string) {
  const h = new Harness({}, 3, 60, { dev: true, map: MAP, ...(dbPath ? { dbPath } : {}) });
  const apps = names.map((n) => new App(h.join(n, {}, { manual: true }), h.reg, corePack()));
  const run = (ms: number): void => h.run(ms, (now) => void apps.forEach((a) => a.frame(now, 1280, 720)));
  const at = (app: App, key: number): UiNode | null => app.ui.frame.find(key);
  const click = (app: App, key: number, dx = 0.5, dy = 0.5): void => {
    const box = at(app, key);
    expect(box?.interactive, `key ${key}`).toBe(true);
    const x = box!.x + box!.w * dx, y = box!.y + box!.h * dy;
    app.pointer(0, key, x, y, 0, 1);
    app.pointer(1, key, x, y, 0, 1);
    run(64);
  };
  const nodes = (app: App, from: number, count: number): UiNode[] => app.ui.frame.nodes.slice(0, app.ui.frame.count).filter((n) => n.key >= from && n.key < from + count);
  const rec = (app: App) => h.host.records.byPid.get(h.client(app.session)!.pid)!;
  return { h, apps, run, at, click, nodes, rec };
}

/** Opens the corner chart's pins. */
function openPins(p: ReturnType<typeof play>, app: App): void {
  p.click(app, KEY_MAP_TOOLS);
  p.click(app, KEY_MAP_TOOLS);
  p.click(app, KEY_MAP_MARK_TOOL);
}

test("a pin placed on the map reaches the tribe's map, minimap and compass, not a stranger's, and goes when removed", () => {
  const p = play(["ada", "bob", "cat"]);
  const [ada, bob, cat] = p.apps as [App, App, App];
  p.run(1000);
  for (const a of p.apps) a.session.text("enablecheats");
  p.run(300);
  p.h.say(ada.session, "tribe create Scouts");
  p.h.say(ada.session, "tribe invite bob");
  p.h.say(bob.session, "tribe accept");
  p.run(300);
  expect(p.rec(bob).team).toBe(p.rec(ada).team);

  // Ada picks a kind, labels it, chooses a place off her own and saves it.
  openPins(p, ada);
  expect(p.at(ada, KEY_MAP_SAVE)?.interactive).toBe(false);
  p.click(ada, KEY_PIN_KIND + DANGER);
  p.click(ada, KEY_PIN_LABEL);
  expect(ada.ui.captureKeyboard).toBe(true);
  ada.ui.input(KEY_PIN_LABEL, "Rex nest");
  p.click(ada, KEY_MAP_SURFACE, 0.8, 0.3);
  expect(ada.ui.captureKeyboard).toBe(false);
  p.click(ada, KEY_MAP_SAVE);
  p.run(400);
  const team = p.rec(ada).team;
  const [pin] = p.h.host.pins.of(team);
  expect(pin).toMatchObject({ kind: DANGER, label: "Rex nest", shared: true, author: p.rec(ada).pid });
  expect(bob.session.pins.map((q) => [q.label, q.author, q.mine])).toEqual([["Rex nest", "ada", false]]);
  expect(cat.session.pins).toEqual([]);

  // Ada's list names it as hers; Bob, a member, sees it without a remove.
  expect(p.at(ada, KEY_PIN_ROW)?.text).toBe("Danger  Rex nest  you  now");
  expect(p.at(ada, KEY_PIN_REMOVE)?.interactive).toBe(true);
  openPins(p, bob);
  expect(p.at(bob, KEY_PIN_ROW)?.text).toBe("Danger  Rex nest  ada  now");
  expect(p.at(bob, KEY_PIN_REMOVE)).toBeNull();

  // Near it, Bob's minimap and compass show it in its kind's colour, and the map does; Cat's show nothing of it.
  p.click(bob, KEY_MAP_CLOSE);
  bob.session.text(`tp ${(pin!.x - 40).toFixed(2)} ${pin!.z.toFixed(2)}`);
  cat.session.text(`tp ${(pin!.x + 40).toFixed(2)} ${pin!.z.toFixed(2)}`);
  p.run(1500);
  const tint = PIN_TINT[DANGER]!;
  const tinted = (app: App, from: number, count: number) => p.nodes(app, from, count).filter((n) => n.tint === tint).length;
  expect(bob.hud.markers.filter((k) => k.kind === "pin").length).toBe(1);
  expect(tinted(bob, KEY_MARKER, 256)).toBe(1);
  expect(tinted(bob, KEY_COMPASS + 80, 16)).toBe(1);
  expect(cat.hud.markers.some((k) => k.kind === "pin")).toBe(false);
  expect(tinted(cat, KEY_MARKER, 256) + tinted(cat, KEY_COMPASS + 80, 16)).toBe(0);
  bob.key("KeyM", true);
  bob.key("KeyM", false);
  cat.key("KeyM", true);
  cat.key("KeyM", false);
  p.run(200);
  expect(tinted(bob, KEY_MAP_MARK, 256)).toBe(1);
  expect(tinted(cat, KEY_MAP_MARK, 256)).toBe(0);

  // Bob pins a place for himself alone, which Ada is not told of; Ada removes hers, and it goes from both.
  p.click(bob, KEY_MAP_TOOLS);
  p.click(bob, KEY_MAP_MARK_TOOL);
  p.click(bob, KEY_PIN_SHARE);
  p.click(bob, KEY_MAP_SURFACE, 0.4, 0.6);
  p.click(bob, KEY_MAP_SAVE);
  p.run(400);
  expect([bob.session.pins.length, ada.session.pins.length]).toEqual([2, 1]);
  expect(p.at(bob, KEY_PIN_ROW)?.text.startsWith("Go  you")).toBe(true);
  p.click(ada, KEY_PIN_REMOVE);
  p.run(400);
  expect(p.h.host.pins.of(team).map((q) => q.author)).toEqual([p.rec(bob).pid]);
  expect([ada.session.pins.length, bob.session.pins.length]).toEqual([0, 1]);
  p.run(300);
  expect(tinted(bob, KEY_MAP_MARK, 256)).toBe(0);
});

test("N through a raised glass at bare ground pins where the server's own ray meets it", () => {
  const p = play(["ada", "bob"]);
  const [ada, bob] = p.apps as [App, App];
  p.run(1000);
  ada.session.text("enablecheats");
  p.run(300);
  p.h.say(ada.session, "tribe create Scouts");
  p.h.say(ada.session, "tribe invite bob");
  p.h.say(bob.session, "tribe accept");
  const glass = p.h.reg.index.get("core:spyglass")!;
  p.h.host.items.mint(p.rec(ada), glass, 1);
  p.run(300);
  takeInHand(p.h, ada.session, glass);
  p.run(500);
  ada.controls.pitch = -Math.atan2(1.6, 25);
  ada.controls.mouseButton(2, true);
  p.run(1500);
  expect(ada.glass.up).toBe(true);
  expect(ada.hud.overhead.lookedId).toBe(-1);
  ada.key("KeyN", true);
  ada.key("KeyN", false);
  p.run(500);
  const [pin] = p.h.host.pins.of(p.rec(ada).team);
  expect(pin).toMatchObject({ kind: WAYPOINT_KINDS.indexOf("go"), shared: true, label: "" });
  // The server's ray, from the survivor's own eye along its own look.
  const ents = p.h.world.ents, e = p.h.ent(ada.session), d = [0, 0, 0];
  lookDirection(ents.yaw[e]!, ents.pitch[e]!, d);
  const ey = ents.y[e]! + stanceEye(p.h.world.reg.move[ents.kind[e]!]!, ents.stance[e]!);
  expect(castWorld(p.h.world, ents.x[e]!, ey, ents.z[e]!, d[0]!, d[1]!, d[2]!, 300)).not.toBe(HIT_NONE);
  expect(pin!.x).toBeCloseTo(ents.x[e]! + d[0]! * rayHit.t, 3);
  expect(pin!.z).toBeCloseTo(ents.z[e]! + d[2]! * rayHit.t, 3);
  expect(Math.hypot(pin!.x - ents.x[e]!, pin!.z - ents.z[e]!)).toBeGreaterThan(15);
  expect(bob.session.pins.length).toBe(1);
  // Looking at the sky, it meets nothing and pins nothing.
  ada.controls.pitch = 0.6;
  p.run(500);
  ada.key("KeyN", true);
  ada.key("KeyN", false);
  p.run(500);
  expect(p.h.host.pins.of(p.rec(ada).team).length).toBe(1);
});

test("a pin outlasts the server's restart and is in the list again", () => {
  const dbPath = join(dir, "restart.db");
  {
    const p = play(["ada"], dbPath);
    const [ada] = p.apps as [App];
    p.run(1000);
    openPins(p, ada);
    ada.ui.input(KEY_PIN_LABEL, "home");
    p.click(ada, KEY_MAP_SURFACE, 0.3, 0.3);
    p.click(ada, KEY_MAP_SAVE);
    p.run(400);
    expect(ada.session.pins.length).toBe(1);
    p.h.host.shutdown();
  }
  {
    const p = play(["ada"], dbPath);
    const [ada] = p.apps as [App];
    p.run(1000);
    expect(ada.session.pins.map((q) => q.label)).toEqual(["home"]);
    openPins(p, ada);
    expect(p.at(ada, KEY_PIN_ROW)?.text.startsWith("Go  home  you")).toBe(true);
    p.h.host.shutdown();
  }
});
