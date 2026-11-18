// The survivor log's thread: it holds the store, writes the batches the tick thread sends and answers reads, so neither
// a disk write nor a long read ever waits in a tick.

import { LogStore } from "./store.ts";
import type { FromLog, ToLog } from "./log.ts";

declare const self: { onmessage: ((e: { data: ToLog }) => void) | null; postMessage(m: FromLog): void };

let store: LogStore | null = null;
let closed: Int32Array | null = null;
const say = (line: string): void => self.postMessage({ op: "say", line });
const told = (): void => {
  if (store) self.postMessage({ op: "span", span: store.span() });
};

self.onmessage = (e) => {
  const m = e.data;
  if (m.op === "open") {
    closed = m.closed;
    try {
      store = new LogStore(m.folder, m.cap, m.world, say);
    } catch (err) {
      say(`survivor log: ${m.folder} could not be opened (${err instanceof Error ? err.message : String(err)}), so nothing is logged`);
    }
    told();
  } else if (m.op === "close") {
    store?.close();
    store = null;
    if (closed) {
      Atomics.store(closed, 0, 1);
      Atomics.notify(closed, 0);
    }
  } else if (m.op === "read") {
    try {
      if (!store) throw new Error("the survivor log is not open");
      const fn = store[m.fn] as (...args: unknown[]) => unknown;
      self.postMessage({ op: "read", id: m.id, value: fn.apply(store, m.args) });
    } catch (err) {
      self.postMessage({ op: "read", id: m.id, error: err instanceof Error ? err.message : String(err) });
    }
  } else if (!store) return;
  else if (m.op === "batch") {
    store.write(m.batch);
    told();
  } else if (m.op === "cap") {
    store.setCap(m.bytes);
    told();
  } else if (m.op === "end") {
    store.end();
    told();
  }
};
