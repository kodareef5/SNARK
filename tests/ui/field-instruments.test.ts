import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { HudModel } from "../../client/core/hud.ts";
import { tintChartRelief } from "../../client/core/chart-streets.ts";
import { ReliefTiles } from "../../client/core/tactical.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { buildHud, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { StreetSectors, heldSide } from "../../shared/world/streets.ts";
import { ChatState } from "../../client/core/ui/chat.ts";
import { KEY_MINIMAP } from "../../client/core/ui/hud.ts";
import { KEY_MAP_CLOSE, KEY_MAP_IMAGE, KEY_MAP_MARK_TOOL, KEY_MAP_PRIVATE, KEY_MAP_SAVE, KEY_MAP_SURFACE, KEY_MAP_TOOLS } from "../../client/core/ui/screens.ts";
import { TEXT_GLOBAL, TEXT_LOCAL } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

test("A corner chart owns its gestures and saves only a confirmed private pin", () => {
  const game = new Harness({}, 1, 60, { dev: true });
  const app = new App(game.join("Chart", {}, { manual: true }), game.reg, parsePack(corePackBytes()));
  const step = (ms = 64) => game.run(ms, now => app.frame(now, 1440, 810));
  step(600);
  const frame = app.ui.frame;
  const click = (key: number) => {
    const box = frame.find(key)!;
    expect(box.interactive).toBe(true);
    app.pointer(0, key, box.x + box.w / 2, box.y + box.h / 2, 0, 1);
    app.pointer(1, key, box.x + box.w / 2, box.y + box.h / 2, 0, 1);
    step();
  };
  const compact = frame.find(KEY_MINIMAP)!;
  const right = compact.x + compact.w, initialWidth = compact.w;
  click(KEY_MAP_TOOLS);
  const chart = frame.find(KEY_MAP_IMAGE)!;
  expect(chart.x + chart.w).toBe(right);
  expect(chart.w).toBeGreaterThan(initialWidth);
  expect(app.ui.wantsPointerLock).toBe(false);
  expect(app.ui.captureKeyboard).toBe(false);
  const start = app.session.own.z;
  app.key("KeyW", true);
  step(420);
  app.key("KeyW", false);
  expect(app.session.own.z).toBeGreaterThan(start);
  click(KEY_MAP_SURFACE);
  expect(app.hud.privateU).toBe(-1);
  click(KEY_MAP_TOOLS);
  click(KEY_MAP_MARK_TOOL);
  expect(frame.find(KEY_MAP_SAVE)?.interactive).toBe(false);
  const hit = frame.find(KEY_MAP_SURFACE)!;
  const x = hit.x + hit.w / 2, y = hit.y + hit.h / 2;
  app.pointer(0, KEY_MAP_SURFACE, x, y, 0, 11);
  app.pointer(3, KEY_MAP_SURFACE, x, y, 0, 11);
  app.pointer(1, KEY_MAP_SURFACE, x, y, 0, 11);
  step();
  expect(frame.find(KEY_MAP_SAVE)?.interactive).toBe(false);
  click(KEY_MAP_SURFACE);
  expect(app.hud.privateU).toBe(-1);
  click(KEY_MAP_SAVE);
  expect(app.hud.privateU).toBeCloseTo(.5, 1);
  expect(frame.find(KEY_MAP_PRIVATE)).not.toBeNull();
  click(KEY_MAP_CLOSE);
  expect(frame.find(KEY_MAP_SURFACE)).toBeNull();
  expect(app.ui.wantsPointerLock).toBe(true);
  app.key("KeyM", true);
  step();
  expect(frame.find(KEY_MAP_PRIVATE)).not.toBeNull();
});

test("Radio recalls each channel’s own messages and keeps its unfinished draft", () => {
  const radio = new ChatState();
  radio.begin(TEXT_GLOBAL, null);
  radio.edit("Meet at the bridge");
  radio.cycle(null);
  expect(radio.channel).toBe(TEXT_LOCAL);
  expect(radio.input).toBe("");
  radio.edit("Incoming");
  radio.submit(null);
  radio.begin(TEXT_GLOBAL, null);
  expect(radio.input).toBe("Meet at the bridge");
  radio.close();
  radio.begin(TEXT_LOCAL, null);
  radio.edit("East");
  radio.recall(-1);
  expect(radio.input).toBe("Incoming");
  radio.recall(1);
  expect(radio.input).toBe("East");
  radio.close();
  radio.begin(TEXT_GLOBAL, null);
  expect(radio.input).toBe("Meet at the bridge");
});

test("The field chart distinguishes open water from light and shaded land", () => {
  const relief = Uint32Array.of(0xff975b2a, 0xff356247, 0xff88bd96);
  tintChartRelief(relief);
  const [water, shade, light] = relief;
  expect((water! >>> 16 & 255) - (water! & 255)).toBeGreaterThan(50);
  expect((shade! >>> 16 & 255) - (shade! & 255)).toBeLessThan(50);
  expect(light! & 255).toBeGreaterThan(shade! & 255);
});

test("Map tiles repaint a street when its sector arrives or leaves", () => {
  const hf = buildProvingHeightfield();
  const tiles = new ReliefTiles(hf, new Uint8Array(256 * 4));
  tiles.tile(0, 0, 0);
  tiles.step();
  const tile = tiles.tile(0, 0, 0)!;
  const side = heldSide(4, 1.5, 2, 0);
  const north = hf.sizeZ * .5, middle = tile.size * (tile.size / 2) + tile.size / 2;
  const initial = tile.rgba[middle]!;
  hf.streets = new StreetSectors();
  hf.streets.put(0, { x0: 0, z0: 0, corners: [], stretches: [{
    type: 1, flags: 0, seed: 53, sides: [side, side],
    xz: Float64Array.of(hf.sizeX * .25, north, hf.sizeX * .75, north),
  }] }, 0, 0, 16, 16);
  tiles.step();
  expect(tile.rgba[middle]).not.toBe(initial);
  const drawn = tiles.version;
  tiles.step();
  expect(tiles.version).toBe(drawn);
  hf.streets.drop(0);
  tiles.step();
  expect(tile.rgba[middle]).toBe(initial);
});

test("Reserves distinguish low, depleted and recovering values at a glance", () => {
  const hud = new HudModel(), frame = new UiFrame();
  hud.vitals[0]!.fraction = .14;
  hud.vitals[3]!.fraction = 0;
  hud.vitals[2]!.fraction = .4;
  hud.vitals[2]!.recoveringUntil = 16;
  hud.vitalTick = 1;
  const draw = () => { frame.begin(16 / 9); buildHud(frame, hud); };
  draw();
  const states = () => frame.nodes.slice(0, frame.count).map(n => n.text);
  expect(states()).toContain("!");
  expect(states()).toContain("×");
  expect(states()).toContain("↗");
  expect(frame.find(KEY_VITAL + 1)?.label).toBe("Health 14%");
  hud.vitalTick = 17;
  draw();
  expect(states()).not.toContain("↗");
});
