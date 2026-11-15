import { expect, test } from "bun:test";
import { BitReader, BitWriter, fitBytes } from "../../shared/net/codec.ts";
import { MAX_PLACE_NAME_BYTES } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";

test("mixed fields survive a round trip at arbitrary bit offsets", () => {
  const rng = new Rng(11);
  const w = new BitWriter(4096);
  const log: [string, number | string][] = [];
  for (let i = 0; i < 400; i++) {
    switch (rng.int(8)) {
      case 0: { const n = 1 + rng.int(32); const v = n === 32 ? rng.u32() : rng.u32() % 2 ** n; w.bits(v, n); log.push(["bits" + n, v]); break; }
      case 1: { const v = rng.u32(); w.varint(v); log.push(["varint", v]); break; }
      case 2: { const v = (rng.u32() | 0) >> rng.int(31); w.svarint(v); log.push(["svarint", v]); break; }
      case 3: { const v = Math.fround(rng.range(-1e6, 1e6)); w.f32(v); log.push(["f32", v]); break; }
      case 4: { const v = rng.range(-1e12, 1e12); w.f64(v); log.push(["f64", v]); break; }
      case 5: { const v = Math.floor(rng.float() * 2 ** 53); w.uint53(v); log.push(["uint53", v]); break; }
      case 6: { const v = rng.int(2048) - 1024; w.sbits(v, 11); log.push(["sbits", v]); break; }
      default: { const v = ["", "survivor", "dodo é中🦖"][rng.int(3)]!; w.string(v); log.push(["string", v]); }
    }
  }
  expect(w.overflow).toBe(false);
  const r = new BitReader(w.bytes());
  for (const [kind, v] of log) {
    let got: number | string;
    if (kind.startsWith("bits")) got = r.bits(Number(kind.slice(4)));
    else if (kind === "varint") got = r.varint();
    else if (kind === "svarint") got = r.svarint();
    else if (kind === "f32") got = r.f32();
    else if (kind === "f64") got = r.f64();
    else if (kind === "uint53") got = r.uint53();
    else if (kind === "sbits") got = r.sbits(11);
    else got = r.string(64);
    expect(got).toBe(v);
  }
  expect(r.overflow).toBe(false);
});

test("truncated and oversized input is flagged, never thrown", () => {
  const w = new BitWriter(4);
  w.u32(1);
  w.u8(2);
  expect(w.overflow).toBe(true);

  const r = new BitReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
  expect(r.varint()).toBe(0);
  expect(r.overflow).toBe(true);

  const s = new BitReader(new Uint8Array([200, 1, 65]));
  expect(s.string(16)).toBe("");
  expect(s.overflow).toBe(true);
});

test("rewind discards later writes and reset leaves a clean buffer", () => {
  const w = new BitWriter(16);
  w.bits(0b101, 3);
  const mark = w.pos;
  w.u32(0xffffffff);
  w.rewind(mark);
  w.bits(0, 5);
  expect([...w.bytes()]).toEqual([0b101]);
  w.reset();
  w.u16(0);
  expect([...w.bytes()]).toEqual([0, 0]);
});

test("a place a survivor rises at keeps a long name: San Francisco's 30-byte spawn point reads back, and a longer one is cut whole", () => {
  const w = new BitWriter(256);
  const long = "Golden Gate Bridge Vista Point";
  const longer = "Größe ".repeat(12);
  w.string(fitBytes(long, MAX_PLACE_NAME_BYTES));
  w.string(fitBytes(longer, MAX_PLACE_NAME_BYTES));
  const r = new BitReader(w.bytes());
  const [a, b] = [r.string(MAX_PLACE_NAME_BYTES), r.string(MAX_PLACE_NAME_BYTES)];
  expect([a, r.overflow]).toEqual([long, false]);
  expect(new TextEncoder().encode(b).length).toBeLessThanOrEqual(MAX_PLACE_NAME_BYTES);
  expect(longer.startsWith(b) && b.length > 0).toBe(true);
  expect(fitBytes("ab", 1)).toBe("a");
});
