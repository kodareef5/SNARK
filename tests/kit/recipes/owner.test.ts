import { expect, test } from "bun:test";
import { KEY_VITAL } from "../../../client/core/ui/hud.ts";
import { V_HEALTH } from "../../../shared/sim/vitals.ts";
import { camp, node, screen, survivor } from "../kit.ts";

// The bars are keyed KEY_VITAL + 1, + 3, + 5 in the order shown; health is the first.
const HEALTH = KEY_VITAL + 1;

test("a hurt survivor's own screen shows its health; another's shows only theirs", () => {
  const { h, ada, at } = camp({ screen: true });
  const bob = survivor(h, "bob", { screen: true, at: { x: at.x + 2, z: at.z } });
  expect(node(screen(h, ada), HEALTH)!.label).toBe("Health 100%");

  h.say(ada, "hurt 30");
  h.run(300);
  expect(node(screen(h, ada), HEALTH)!.label).toBe("Health 70%");
  expect(node(screen(h, ada), HEALTH)!.value).toBeCloseTo(0.7, 2);
  expect(node(screen(h, bob), HEALTH)!.label).toBe("Health 100%");
  expect(bob.vitals.at(V_HEALTH, bob.latestSnapshot) / bob.vitals.max[V_HEALTH]!).toBe(1);
});
