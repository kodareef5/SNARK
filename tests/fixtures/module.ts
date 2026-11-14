// A module written against the contract alone, for the tests of the contract. It hears what it is told to, and keeps
// what it heard.

import type { HandlerOptions, ModuleContext, ModuleDef, ModuleEvent } from "../../server/api/module.ts";

export interface Heard {
  readonly lines: string[];
  /** Set by a test, to act inside a handler. */
  each: ((e: ModuleEvent) => void) | null;
  context: ModuleContext | null;
}

/** A module that hears `events` and records each as "name: data". */
export function listener(name: string, events: readonly (string | [event: string, o: HandlerOptions])[], more: (m: ModuleContext) => void = () => {}): { def: ModuleDef; heard: Heard } {
  const heard: Heard = { lines: [], each: null, context: null };
  const def: ModuleDef = {
    name,
    api: 1,
    setup(m) {
      heard.context = m;
      for (const ev of events) {
        const [event, o] = typeof ev === "string" ? [ev, {}] : ev;
        m.on(
          event,
          (e) => {
            heard.lines.push(`${e.name}: ${JSON.stringify(e.data)}`);
            heard.each?.(e);
          },
          o,
        );
      }
      more(m);
    },
  };
  return { def, heard };
}
