// What the frame's code calls while the debug bar times it (debug/spans.ts makes one). Without the bar it is null,
// and timing costs one null check.

export interface Probe {
  /** The page's clock, in ms. */
  now(): number;
  /** The slot named `name` under `parent` (-1 for none), made the first time it is asked for. */
  slot(name: string, parent: number): number;
  /** Starts the frame's row of times. `at` is the frame's start on the page's clock. */
  begin(at: number): void;
  /** Slot `slot` ran from `from` to `to` on the page's clock. A slot that runs twice in a frame adds up. */
  add(slot: number, from: number, to: number): void;
}
