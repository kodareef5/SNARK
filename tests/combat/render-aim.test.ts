// Aiming at what the renderer draws of a body: a ray through each pixel showing it finds its zone, in every pose and
// from every side. Apart from render.test.ts, whose frames it would wait behind, so the two run side by side. Slider
// extremes and random looks are in render-aim-male.slow.test.ts and render-aim-female.slow.test.ts.

import { expect, test } from "bun:test";
import { HUMAN_ZONE_COUNT, ZONE_NAMES } from "../../shared/anim/human.ts";
import { defaultLook, LOOK_SEX } from "../../shared/anim/look.ts";
import { AIM_FEMALE, AIM_MALE, aimAudit, aimShares, aimView, type AimHeld } from "../fixtures/aim-audit.ts";
import { artTest } from "../fixtures/needs-art.ts";

function holds(look: Uint8Array | null, held: AimHeld): void {
  const c = aimAudit(aimView(), look), s = aimShares(c);
  for (let z = 1; z < HUMAN_ZONE_COUNT; z++) {
    // Every zone is seen, and a ray through its pixels mostly finds it. Each bone has one generous capsule, and where two
    // meet (a wrist, an ankle, an armpit) the nearer one wins, which accounts for the rest.
    expect(c.drawn[z]!).toBeGreaterThan(150);
    if (c.agreed[z]! / c.drawn[z]! < held.zone) throw new Error(`${ZONE_NAMES[z]}: only ${c.agreed[z]} of ${c.drawn[z]} drawn pixels are hit`);
  }
  // The head matters most. A ray through a drawn head must be a headshot.
  expect(s.head).toBeGreaterThan(held.head);
  expect(s.body).toBeGreaterThan(held.body);
  // Almost no drawn pixel misses every capsule, so aiming at the body hits the body.
  expect(s.missed).toBeLessThan(held.missed);
  // The capsules are generous, so some hits land a little outside the drawn body, but not much more than its rim.
  expect(s.spill).toBeLessThan(held.spill);
  expect(c.empty).toBeGreaterThan(c.drawn.reduce((a, b) => a + b, 0));
  expect(c.unlike).toBe(0);
}

test("aiming at what is drawn of a body hits it, in the zone drawn: in every pose, from every side", () => {
  holds(null, AIM_MALE);
});

artTest("aiming at the female body hits it, in the zone drawn, to her own measured shares", () => {
  const look = defaultLook();
  look[LOOK_SEX] = 1;
  holds(look, AIM_FEMALE);
});
