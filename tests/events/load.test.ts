// The map events' holding reader (client/core/mapevent-load.ts), which is all of them the first frame carries: it keeps
// the newest feed each session was sent until the late file comes to read it, and asks for that file once there is an
// event to draw.

import { expect, test } from "bun:test";
import { FEED_MOST, askMapEvents, feedTold, holdsEvents, takeFeed } from "../../client/core/mapevent-load.ts";
import { MAPEVENT_BYTES, type MapEventFeed } from "../../shared/mapevent/wire.ts";
import { camp, drawn, screen } from "../kit/kit.ts";
import { STAND_IN_LOOK, craftRow, eventRow, feedBytes, hover, tell } from "../fixtures/mapevent.ts";

const EMPTY: MapEventFeed = { looks: [], rows: [] };
const feed = (start: number, x: number, z: number): MapEventFeed => ({ looks: [{ type: "craft", craft: STAND_IN_LOOK }], rows: [eventRow(start, [craftRow(hover(x, 60, z))])] });

test("the reader keeps only the newest feed, and nothing for a session told of no event", () => {
  const { h, ada, at } = camp();
  expect(FEED_MOST).toBe(MAPEVENT_BYTES);
  expect([holdsEvents(feedBytes(EMPTY)), holdsEvents(feedBytes(feed(0, 1, 1)))]).toEqual([false, true]);
  expect([feedTold(ada), takeFeed(ada)]).toEqual([false, undefined]);
  tell(h, ada, EMPTY);
  h.run(200);
  expect([feedTold(ada), takeFeed(ada)]).toEqual([false, undefined]);

  const first = feed(h.world.tick, at.x, at.z + 100), second = feed(h.world.tick, at.x + 50, at.z + 100);
  tell(h, ada, first);
  tell(h, ada, second);
  h.run(200);
  expect(feedTold(ada)).toBe(true);
  expect(takeFeed(ada)).toEqual(feedBytes(second));
  expect(takeFeed(ada)).toBeUndefined();
  // Once told of one, an empty feed is kept too: it says the events are over.
  tell(h, ada, EMPTY);
  h.run(200);
  expect(takeFeed(ada)).toEqual(feedBytes(EMPTY));
});

test("the late file is asked for once a feed holds an event, and the feed is drawn once it comes", async () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  h.run(300);
  expect([view.app.mapEvents.asked, view.app.scene!.mapEventPass, drawn(view, "core:event_disc")]).toEqual([false, null, 0]);
  // A feed of events that are over asks for nothing.
  tell(h, ada, EMPTY);
  h.run(300);
  expect(view.app.mapEvents.asked).toBe(false);

  tell(h, ada, feed(h.world.tick, at.x, at.z + 100));
  h.run(300);
  expect(view.app.mapEvents.asked).toBe(true);
  await askMapEvents();
  h.run(300);
  expect(drawn(view, "core:event_disc")).toBe(1);
  expect(view.app.scene!.mapEventPass!.craft).toBe(1);
  // An empty feed after it takes it away.
  tell(h, ada, EMPTY);
  h.run(300);
  expect(drawn(view, "core:event_disc")).toBe(0);
});
