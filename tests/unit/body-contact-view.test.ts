import { expect, test } from "bun:test";
import { AnimState } from "../../shared/anim/pose.ts";
import { stoodInViews } from "../../shared/net/body-contact.ts";
import { SentView, ViewRing } from "../../shared/net/view.ts";

test("standing qualification survives lost snapshots, but not startup, eviction, movement or handle reuse", () => {
  const history = new ViewRing(() => new SentView()), pose = new AnimState(); pose.grounded = true;
  const push = (tick: number, x = 100, gen = 1) => {
    const view = history.alloc(tick); view.push(4, gen, 5, x, 0, 100, 0, 1, pose.pack()); return view;
  };
  expect(stoodInViews(push(1), 0, history)).toBe(false);
  push(2); push(4); const latest = push(8);
  expect(stoodInViews(latest, 0, history)).toBe(true);
  history.alloc(4); expect(stoodInViews(latest, 0, history)).toBe(false);
  push(4, 101); expect(stoodInViews(latest, 0, history)).toBe(false);
  push(4, 100, 2); expect(stoodInViews(latest, 0, history)).toBe(false);
  push(4); pose.speed = 1; push(6); expect(stoodInViews(latest, 0, history)).toBe(false);
  pose.speed = 0; push(6); expect(stoodInViews(latest, 0, history)).toBe(true);
  expect(stoodInViews(push(24), 0, history)).toBe(false);
});
