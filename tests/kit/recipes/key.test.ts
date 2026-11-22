import { expect, test } from "bun:test";
import { KEY_INV_SLOT } from "../../../client/core/ui/inventory.ts";
import { camp, node, screen, tap } from "../kit.ts";

test("I opens the inventory and I again closes it, the body's keys still its own", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  expect([view.app.ui.inventory.open, node(view, KEY_INV_SLOT)]).toEqual([false, null]);

  tap(h, view, "KeyI");
  expect(view.app.ui.inventory.open).toBe(true);
  expect(node(view, KEY_INV_SLOT)).not.toBeNull();
  view.app.key("KeyW", true);
  h.run(1000);
  view.app.key("KeyW", false);
  expect(ada.own.z).toBeGreaterThan(at.z + 2);

  tap(h, view, "KeyI");
  expect([view.app.ui.inventory.open, node(view, KEY_INV_SLOT)]).toEqual([false, null]);
});
