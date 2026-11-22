// What a system asks of the tick. The host keeps one ordered list of these (`systems` in server/host.ts) and walks it
// once for each hook, so a system's place in the list is its place in the tick. A class with a `step(tick)` of this shape
// is a row as it is; one whose call takes other arguments is given a row that makes the call.

import type { Client } from "./game.ts";
import type { SentView } from "../shared/net/view.ts";

export interface System {
  /** Once a tick before bodies move, to apply what was queued outside the step. */
  beforeStep?(): void;
  /** Once a tick after bodies move and commands run. */
  step?(tick: number): void;
  /** For each connected session just before its snapshot: the system's own feed to it. */
  replicate?(c: Client): void;
  /** For each session whose snapshot was written, with the view it was sent. */
  snapshot?(c: Client, view: SentView): void;
}

/** The rows that take part in each hook, in the list's order. */
export interface Tick {
  readonly beforeStep: readonly System[];
  readonly step: readonly System[];
  readonly replicate: readonly System[];
  readonly snapshot: readonly System[];
}

export function tickOf(systems: readonly System[]): Tick {
  return {
    beforeStep: systems.filter((s) => s.beforeStep !== undefined),
    step: systems.filter((s) => s.step !== undefined),
    replicate: systems.filter((s) => s.replicate !== undefined),
    snapshot: systems.filter((s) => s.snapshot !== undefined),
  };
}
