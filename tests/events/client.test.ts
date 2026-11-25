// A map event as a client draws it (client/core/mapevent/): a feed sent to a real client is read, and each part is drawn
// by its type's view at the tick the remote bodies are shown at.

import { expect, test } from "bun:test";
import "../../client/core/mapevent-late.ts";
import { MAPEVENT_LIVE } from "../../shared/mapevent/wire.ts";
import { camp, drawn, screen } from "../kit/kit.ts";
import { UFO_LOOK, craftRow, eventRow, hover, tell } from "../fixtures/mapevent.ts";

test("a craft told to a client is drawn in its pieces, with its beam on a low pass", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  const tick = h.world.tick;
  const craft = craftRow(hover(at.x, 60, at.z + 120, true));
  tell(h, ada, { looks: [{ type: "craft", craft: UFO_LOOK }], rows: [eventRow(tick, [craft], { state: MAPEVENT_LIVE })] });
  h.run(500);
  const pass = view.app.scene!.mapEventPass!;
  expect([pass.craft, pass.beams, drawn(view, "core:event_cone")]).toEqual([1, 1, 1]);
});
