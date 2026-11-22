import { expect, test } from "bun:test";
import { camp, drawn, look, put, screen, tame } from "../kit.ts";

test("a raptor is in the frame once while it is in view, and not when it is behind", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  expect(view.packet!.drawCount).toBeGreaterThan(0);
  expect(drawn(view, "core:raptor")).toBe(0);

  tame(h, ada, "raptor");
  h.run(300);
  expect(drawn(view, "core:raptor")).toBe(1);

  put(h, ada, { x: at.x, z: at.z - 100 });
  look(h, ada, { x: at.x, z: at.z - 200 });
  h.run(1000);
  expect(drawn(view, "core:raptor")).toBe(0);
});
