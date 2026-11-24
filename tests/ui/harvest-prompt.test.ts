// Gathering tells the player which control can reach the resource.
import { expect, test } from "bun:test";
import { KEY_PROMPT } from "../../client/core/hud/prompt.ts";
import { nodesOf, standFacing, takeInHand } from "../fixtures/gather.ts";
import { ScreenHarness, screen, shown } from "../kit/screen.ts";

test("the gathering prompt follows strike reach and the player's input", () => {
  const h = new ScreenHarness({}, 3, 60, { dev: true, wild: false });
  try {
    const ada = h.open("ada");
    h.run(600);
    h.say(ada, "enablecheats");
    const view = screen(h, ada), pilot = h.pilots[0]!;
    const tree = nodesOf(h, "core:tree", 256, 225)
      .find((at) => standFacing(h, ada, pilot, at, 1.9));
    expect(tree).toBeDefined();
    for (const [device, button] of [[0, "LMB"], [1, "RT"], [2, "Attack"]] as const) {
      view.app.ui.inputDevice = device;
      h.run(100);
      expect(shown(view, KEY_PROMPT)).toBe(`Hold ${button} to gather from tree`);
    }
    expect(standFacing(h, ada, pilot, tree!, 3.2)).toBe(true);
    expect(shown(view, KEY_PROMPT)).toBe("Move closer to gather from tree");
    const rifle = h.reg.index.get("core:rifle")!;
    h.host.items.mint(h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!, rifle, 1);
    h.run(250);
    takeInHand(h, ada, rifle);
    expect(standFacing(h, ada, pilot, tree!, 1.9)).toBe(true);
    expect(shown(view, KEY_PROMPT)).toBeNull();
  } finally {
    h.host.shutdown();
  }
});
