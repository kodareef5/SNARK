// How each type of part is drawn and heard. An event is made of parts whose look travels as data, so this table is
// keyed by the type of part and never by an event's kind: a kind a module adds is drawn and heard by its parts.

import type { EventKit } from "../render/passes/map-events.ts";
import { hearCraft, hearSite, type EventEars } from "../sound/mapevent.ts";
import { drawCraft, findCraft, wantCraft } from "./craft.ts";
import type { ShownCraft, ShownPart, ShownSite } from "./shown.ts";
import { drawSite, wantSite } from "./site.ts";

export interface PartView<P extends ShownPart> {
  /** Finds the meshes it draws with in the pack, each time a message comes. */
  find(k: EventKit, part: P): void;
  /** Says what art it may draw is wanted, each frame from the moment it is told of. */
  want(k: EventKit, part: P, tick: number): void;
  draw(k: EventKit, part: P, tick: number): void;
  hear(h: EventEars, part: P, tick: number): void;
}

const nothing = (): void => {};

export const PART_VIEWS: { readonly craft: PartView<ShownCraft>; readonly site: PartView<ShownSite> } = {
  craft: { find: findCraft, want: wantCraft, draw: drawCraft, hear: hearCraft },
  site: { find: nothing, want: wantSite, draw: drawSite, hear: hearSite },
};
