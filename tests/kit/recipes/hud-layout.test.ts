import { expect, test } from "bun:test";
import { KEY_AMMO, KEY_VITAL } from "../../../client/core/ui/hud.ts";
import { takeInHand } from "../../fixtures/gather.ts";
import { WINDOWS, camp, fits, id, resize, screen, shown, until } from "../kit.ts";

test("the ammunition line and the health bar fit a desktop, an ultrawide and a phone", () => {
  const { h, ada } = camp({ screen: true, gear: ["pistol"] });
  const view = screen(h, ada);
  takeInHand(h, ada, id("pistol"));
  expect(until(h, () => ada.own.rounds > 0, 10)).toBe(true);
  for (const [name, width, height] of WINDOWS) {
    resize(h, view, width, height);
    expect(shown(view, KEY_AMMO), name).toBe("pistol round  6 / 54");
    expect(fits(view, KEY_AMMO), name).toBe(true);
    expect(fits(view, KEY_VITAL + 1), name).toBe(true);
  }
});
