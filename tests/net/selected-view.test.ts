import { expect, test } from "bun:test";
import { BitWriter } from "../../shared/net/codec.ts";
import { SentView, ViewRing, type ViewSelection, writeViewDelta } from "../../shared/net/view.ts";
import { EntityStore } from "../../shared/sim/entities.ts";

test("selected rows match a copied view through loss, budget deferral and swaps", () => {
  const store = new EntityStore({ chunksX: 1, chunksZ: 1 }, 128);
  const ids = Array.from({ length: 80 }, () => store.create(1, 0, 0, 0, 0));
  const shared = new SentView(), copied = new SentView();
  const selection: ViewSelection = { order: new Int16Array(80), extra: new SentView(), count: 0 };
  const reader = () => ({ ring: new ViewRing(() => new SentView()), writer: new BitWriter(2048), rotate: 0 });
  const a = reader(), b = reader();
  let ack = 0;
  for (let tick = 1; tick <= 150; tick++) {
    selection.count = selection.extra.count = shared.count = copied.count = 0;
    for (const id of ids) {
      const extra = (id + (tick >> 3)) % 13 === 0;
      const keep = extra || (id + (tick >> 2)) % 4 !== 0;
      const source = extra ? selection.extra : shared;
      const slot = source.count;
      source.push(id, 1, 1, id, 0, id % 2 ? tick : 0, 0, 0, 0, 0, id % 3 ? 0 : tick >> 1);
      source.urgent[slot] = id % 7 === 0 ? 1 : 0;
      if (keep) {
        selection.order[selection.count++] = extra ? ~slot : slot;
        copied.copyFrom(source, slot);
        copied.urgent[copied.count - 1] = source.urgent[slot]!;
      }
    }
    for (const r of [a, b]) {
      r.writer.reset();
      const base = r.ring.find(ack), next = r.ring.alloc(tick);
      r.rotate = writeViewDelta(r.writer, base, r === a ? shared : copied, next, 1400, r.rotate, store, ids[0]!, null, 80, r.ring, null, r === a ? selection : null);
      expect(r.writer.overflow).toBe(false);
    }
    expect(a.writer.bytes()).toEqual(b.writer.bytes());
    expect(a.rotate).toBe(b.rotate);
    if (tick % 5 === 0) ack = tick;
  }
});
