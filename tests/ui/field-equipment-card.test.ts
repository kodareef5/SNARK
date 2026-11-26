import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { CARD, EquipmentCard } from "../../client/core/ui/equipment-card.ts";
import { KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { FIELD_EQUIPMENT, FIELD_ICONS, FIELD_TOUCH, installFieldIcons } from "../../client/core/ui/field-icons.ts";
import { K_IMAGE, UiFrame } from "../../client/core/ui/nodes.ts";
import { CMD_MOVE, RESULT_DENIED, RESULT_OK } from "../../shared/net/protocol.ts";
import { GEAR_SLOTS, Inventory } from "../../shared/sim/items.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

test("Assigning from the item card waits for the server before equipping", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("bag", { latencyMs: 40 }, { manual: true }), h.reg, corePack());
  const run = (ms = 100) => h.run(ms, now => app.frame(now, 1280, 720));
  run(600);
  for (const line of ["enablecheats", "give pick 1"]) { app.session.text(line); run(320); }
  const id = h.reg.index.get("core:pick")!, inv = app.session.inventory!;
  const source = inv.item.indexOf(id), dest = 7;
  expect(source).toBeGreaterThanOrEqual(0);
  app.key("KeyI", true);
  run();
  const press = (key: number) => {
    const node = app.ui.frame.find(key);
    expect(node?.interactive).toBe(true);
    app.pointer(0, key, node!.x + 5, node!.y + 5, 0);
    app.pointer(1, key, node!.x + 5, node!.y + 5, 0);
  };
  press(KEY_INV_SLOT + 3 * source);
  run();
  press(CARD);
  run();
  expect(app.ui.frame.find(CARD + 5)?.text.toLowerCase()).toContain("pick");
  press(CARD + 3);
  run();
  const before = app.session.held;
  press(CARD + 20 + dest * 3);
  expect(app.session.held).toBe(before);
  run(500);
  expect(app.session.inventory!.item[inv.hotbar + dest]).toBe(id);
  expect(app.session.held).toBe(dest);
  expect(app.ui.opened("inventory")).toBe(false);
});

test("Field items and touch contacts keep the remaining catalogue pictures", () => {
  const frame = new UiFrame();
  frame.icons = { place(n, id) { if (id !== "mod:boot") return false; n.image = 101; return true; } };
  installFieldIcons(frame, { icons: "dock.webp", equipment: "equipment.webp", parts: "parts.webp", touch: "contacts.webp" });
  const image = (id: string) => frame.picture(1, 0, 0, 48, 48, 0, id);
  expect(image("core:pick")?.image).toBe(FIELD_ICONS.image);
  const detail = frame.picture(2, 0, 0, 150, 150, 0, "ui:inspect/core:pick")!;
  expect(frame.images[detail.image]?.url).toBe("equipment.webp");
  expect(detail.sw).toBe(FIELD_EQUIPMENT.cell);
  expect(image("ui:glass-touch-look")?.kind).toBe(K_IMAGE);
  expect(image("ui:glass-touch-look")?.sx).toBe(FIELD_TOUCH.cell);
  expect(image("ui:glass-health")?.sy).toBeGreaterThan(0);
  expect(image("mod:boot")?.image).toBe(101);
  expect(image("ui:inspect/mod:boot")?.image).toBe(101);
  expect(image("mod:missing")).toBeNull();
});

test("A canceled swipe or rejected assignment keeps the held item", () => {
  const h = new Harness();
  const session = h.join("bag");
  const inv = session.inventory = new Inventory(25 + GEAR_SLOTS, 25);
  const pick = h.reg.index.get("core:pick")!;
  inv.item[0] = pick;
  inv.count[0] = 1;
  const sent: number[] = [];
  session.command = (op) => { sent.push(op); return sent.length; };
  const card = new EquipmentCard();
  const touch = (kind: number, key: number, y: number) => card.input(kind, key, y, 1, 0, session);
  touch(0, CARD + 1, 100);
  touch(3, CARD + 1, 30);
  expect(card.depth).toBe(0);
  for (const key of [CARD, CARD + 3, CARD + 20, CARD + 20]) touch(0, key, 0);
  expect(sent).toEqual([CMD_MOVE]);
  expect(card.answer(77, RESULT_OK, session)).toBe(false);
  expect(card.answer(1, RESULT_DENIED, session)).toBe(false);
  expect(card.depth).toBe(2);
  inv.item[0] = 0;
  touch(0, CARD + 20, 0);
  expect(sent).toEqual([CMD_MOVE]);
  expect(card.depth).toBe(0);
});
