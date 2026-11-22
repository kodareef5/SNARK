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

/** One function for each hook, which calls the rows that have it in the list's order. They are what GameServer's four tick hooks are set to. */
export function walk(systems: readonly System[]): Required<System> {
  const before = systems.filter((s) => s.beforeStep !== undefined);
  const steps = systems.filter((s) => s.step !== undefined);
  const feeds = systems.filter((s) => s.replicate !== undefined);
  const sent = systems.filter((s) => s.snapshot !== undefined);
  return {
    beforeStep: () => {
      for (let i = 0; i < before.length; i++) before[i]!.beforeStep!();
    },
    step: (tick) => {
      for (let i = 0; i < steps.length; i++) steps[i]!.step!(tick);
    },
    replicate: (c) => {
      for (let i = 0; i < feeds.length; i++) feeds[i]!.replicate!(c);
    },
    snapshot: (c, view) => {
      for (let i = 0; i < sent.length; i++) sent[i]!.snapshot!(c, view);
    },
  };
}
