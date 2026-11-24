import { expect, test } from "bun:test";
import { caughtStrikeTick } from "../../client/core/render/strike-contact.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { ACT_SWING, HOLD_TOOL, SWING_TICKS } from "../../shared/sim/weapon.ts";

test("a confirmed blow catches at its bite and recovers in time for the next swing", () => {
  const start = 254, st = new AnimState();
  st.setAction(ACT_SWING, HOLD_TOOL, start);
  for (const heard of [start + 4.5, start + 5, start + 7.5]) {
    const caught = Math.max(start + 5, heard);
    let previous = start;
    for (let tick = start; tick <= start + SWING_TICKS; tick += 0.25) {
      const at = caughtStrikeTick(st, tick, heard);
      expect(at).toBeGreaterThanOrEqual(previous);
      expect(at).toBeLessThanOrEqual(tick);
      if (tick <= caught) expect(at).toBe(tick);
      if (tick >= caught && tick <= caught + 1.25) expect(at).toBe(caught);
      previous = at;
    }
    expect(previous).toBe(start + SWING_TICKS);
  }
});

test("a miss or a late confirmation lets the arms finish their stroke", () => {
  const st = new AnimState();
  st.setAction(ACT_SWING, HOLD_TOOL, 273);
  for (const heard of [-Infinity, 263, 282]) {
    for (let tick = 273; tick <= 288; tick += 0.5) {
      expect(caughtStrikeTick(st, tick, heard)).toBe(tick);
    }
  }
});
