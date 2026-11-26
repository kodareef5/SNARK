import { expect, test } from "bun:test";
import "../../server/corpses.ts";
import { corpseWardrobe } from "../../server/corpses.ts";
import { EntityRecord } from "../../server/records.ts";
import { SAVED, type Coding } from "../../server/saved.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { WARDROBE_SLOTS } from "../../shared/sim/items.ts";

const row = SAVED.find((s) => s.name === "corpse-wardrobe")!;
const same = Uint16Array.from({ length: 64 }, (_, i) => i);
const coding = (): Coding => ({ toSaved: same, toRuntime: same, split: new Map(), blob: new Uint8Array(), refused: false, stale: false, refs: [], styles: [], item: (s) => s, burn: () => {} });

test("a body's wardrobe reads back as it was saved", () => {
  const w = new BitWriter(256);
  for (let k = 0; k < WARDROBE_SLOTS; k++) (w.varint(k + 1), w.varint(100 + k), w.varint(0x010203 + k));
  const rec = new EntityRecord(7, 1);
  row.read(rec, new BitReader(w.bytes()), coding());
  const kept = corpseWardrobe(rec)!;
  for (let k = 0; k < WARDROBE_SLOTS; k++) expect([...kept.slice(k * 3, k * 3 + 3)]).toEqual([k + 1, 100 + k, 0x010203 + k]);
  const again = new BitWriter(256);
  row.write(rec, again, coding());
  const back = new EntityRecord(8, 1);
  row.read(back, new BitReader(again.bytes()), coding());
  expect([...corpseWardrobe(back)!]).toEqual([...kept]);
});
