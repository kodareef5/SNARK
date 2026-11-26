// The map events as the sounds hear them each frame (sound/sounds.ts SoundProducer): an event's notice when it is called
// and its going when it is over with nothing of it brought down, then each part by its type's view (views.ts).

import { TICK_RATE } from "../../../shared/coords.ts";
import { MAPEVENT_NOTICE, type MapEventRow } from "../../../shared/mapevent/wire.ts";
import { EVENT_OWNER, EventEars, K, NOTICE_FRESH } from "../sound/mapevent.ts";
import type { Hear } from "../sound/bodies.ts";
import type { Ear } from "../sound/mixer.ts";
import type { OwnedLoop, SoundProducer } from "../sound/sounds.ts";
import type { MapEventsShown, ShownPart } from "./shown.ts";
import { PART_VIEWS, type PartView } from "./views.ts";

/** What an event was last heard as: whether it was heard while it was in the world, and whether its going was. */
interface EventHeard {
  owner: number;
  live: boolean;
  over: boolean;
}

const brought = (row: MapEventRow): boolean => {
  for (let i = 0; i < row.parts.length; i++) {
    const p = row.parts[i]!;
    if (p.type === "craft" && p.down > 0) return true;
  }
  return false;
};

export class MapEventHearing implements SoundProducer {
  private readonly from: { readonly shown: MapEventsShown | null };
  private readonly ears = new EventEars();
  private readonly events = new Map<number, EventHeard>();
  private last: MapEventsShown | null = null;

  /** `from` holds the events as last read (mapevent/part.ts). */
  constructor(from: { readonly shown: MapEventsShown | null }) {
    this.from = from;
  }

  update(ear: Readonly<Ear>, owner: (id: string) => number, hear: Hear, loop: OwnedLoop): void {
    const shown = this.from.shown;
    if (!shown) return;
    if (shown !== this.last) {
      this.last = shown;
      // What is kept of an event or a part goes with it.
      const ids = new Set(shown.feed.rows.map((r) => r.id)), keys = new Set(shown.parts.map((p) => p.key));
      for (const id of [...this.events.keys()]) if (!ids.has(id)) this.events.delete(id);
      for (const key of [...this.ears.heard.keys()]) if (!keys.has(key)) this.ears.heard.delete(key);
    }
    const h = this.ears, tick = shown.tick;
    h.ear = ear;
    h.owner = owner;
    h.hear = hear;
    h.loop = loop;
    const rows = shown.feed.rows;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      let was = this.events.get(row.id);
      if (!was) {
        was = { owner: owner(row.sound || EVENT_OWNER), live: false, over: false };
        this.events.set(row.id, was);
        // Just told of it: its notice is heard if it was only now called, and nothing it did before is.
        if (row.state === MAPEVENT_NOTICE && tick - row.called < NOTICE_FRESH * TICK_RATE) hear(was.owner, K.notice, -1, 0, 0, 0, 0, 1, true);
        if (row.ended > 0 && tick >= row.ended) was.over = true;
      }
      if (was.over) continue;
      if (row.ended > 0 && tick >= row.ended) {
        was.over = true;
        if (was.live && !brought(row)) hear(was.owner, K.gone, -1, 0, 0, 0, 0, 1, true);
      } else if (tick >= row.start) was.live = true;
    }
    const parts = shown.parts;
    for (let i = 0; i < parts.length; i++) (PART_VIEWS[parts[i]!.type] as PartView<ShownPart>).hear(h, parts[i]!, tick);
  }
}
