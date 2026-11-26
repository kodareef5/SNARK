import { expect, test } from "bun:test";
import { GameApp } from "../../client/core/game-app.ts";
import { playUi } from "../../client/core/ui/bag-load.ts";
import * as panels from "../../client/core/ui/bag-panels.ts";
import { KEY_CHAR_TITLE, TAB_MAKE, TAB_STATS } from "../../client/core/ui/character.ts";
import { KEY_FIELD_HUB, KEY_FIELD_LEAF } from "../../client/core/ui/field-dock.ts";
import { KEY_INV_TITLE } from "../../client/core/ui/inventory.ts";
import * as touch from "../../client/core/ui/touch.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

function player(): {
  h: Harness; app: GameApp; run: (ms?: number) => void;
  settle: () => void; fail: () => void; requests: () => number;
} {
  let done!: (module: typeof panels) => void, denied!: (why: Error) => void, requests = 0;
  const ui = playUi(() => {
    requests++;
    return new Promise((resolve, reject) => { done = resolve; denied = reject; });
  });
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new GameApp(h.join("ada", {}, { manual: true }), h.reg, corePack(), ui);
  app.ui.layer = touch;
  const run = (ms = 60): void => h.run(ms, (now) => app.frame(now, 844, 390));
  run(500);
  return { h, app, run, settle: () => done(panels), fail: () => denied(new Error("offline")), requests: () => requests };
}

test("the first key and touch choose the right panels while their code loads", async () => {
  const { h, app, run, settle, requests } = player();
  try {
    const ui = app.ui;
    expect(requests()).toBe(0);
    app.key("KeyI", true);
    expect(ui.opened("inventory")).toBe(true);
    expect(ui.playingField).toBe(false);
    app.key("Escape", true);
    expect(ui.opened("inventory")).toBe(false);
    app.ui.inputDevice = 2;
    run();
    const tap = (key: number): void => {
      const node = ui.frame.find(key)!;
      const x = node.x + node.w / 2, y = node.y + node.h / 2;
      app.pointer(0, key, x, y, 0, 1);
      app.pointer(1, key, x, y, 0, 1);
      run();
    };
    const openCraft = (): void => {
      tap(KEY_FIELD_HUB);
      const craft = ui.frame.nodes.find((n) => n.key >= KEY_FIELD_LEAF && n.interactive && n.label === "Craft");
      expect(craft).toBeDefined();
      tap(craft!.key);
    };
    openCraft();
    expect(ui.opened("character")).toBe(true);
    expect(requests()).toBe(1);
    settle();
    await Promise.resolve();
    run();
    const survivor = ui.screen<panels.CharacterScreen>("character");
    expect(survivor.tab).toBe(TAB_MAKE);
    expect(ui.frame.find(KEY_CHAR_TITLE)).not.toBeNull();
    expect(ui.opened("inventory")).toBe(false);
    survivor.selectTab(TAB_STATS);
    app.key("Escape", true);
    app.ui.inputDevice = 2;
    run();
    openCraft();
    expect(survivor.tab).toBe(TAB_MAKE);
    expect(requests()).toBe(1);
  } finally {
    h.host.shutdown();
  }
});

test("a container closes while the inventory loads, and a failed load can retry", async () => {
  const { h, app, run, settle, fail, requests } = player();
  try {
    const box = h.host.records.create(h.reg.index.get("core:cache")!, "old cache");
    h.host.items.mint(box, h.reg.index.get("core:stone")!, 5);
    box.x = 256;
    box.z = 242;
    box.expiresAt = h.world.tick + 100_000;
    h.host.death.place(box);
    run(300);
    app.look(0, -Math.atan2(0.25 - 1.62, 2) / 0.0025);
    run(120);
    app.key("KeyE", true);
    run(100);
    app.key("KeyE", false);
    run(300);
    expect(app.session.open?.name).toBe("old cache");
    expect(app.ui.opened("inventory")).toBe(true);
    expect(requests()).toBe(1);
    app.key("Escape", true);
    run(300);
    expect(h.client(app.session)!.open).toBe(0);
    fail();
    await Promise.resolve();
    app.key("KeyI", true);
    expect(requests()).toBe(2);
    settle();
    await Promise.resolve();
    run();
    expect(app.ui.opened("inventory")).toBe(true);
    expect(app.ui.frame.find(KEY_INV_TITLE)!.text).toContain("Inventory");
    expect(app.session.open).toBeNull();
  } finally {
    h.host.shutdown();
  }
});
