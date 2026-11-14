// A chunk holds up to 256 resource nodes, and a client is sent which of them are used up.

import { expect, test } from "bun:test";
import { chunkAt } from "../../shared/coords.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

test("a chunk with all 256 of its nodes used up is shown bare, and with one fewer too: the count sent is not cut to a byte", () => {
  const map = writeMap(flatMap(2, { nodes: [{ seed: 9, perChunk: 256, kinds: [["core:bush", 1]], allowCell: 0, allow: null }] }));
  const h = new Harness({}, 1, 60, { dev: true, map });
  const ada = h.join("ada");
  h.run(500);
  const chunk = chunkAt(h.world.dims, ada.own.x, ada.own.z);
  const shown = (): number => ada.nodeField!.store.chunks[chunk]?.live ?? 0;
  expect(shown()).toBe(256);
  // Used up as a save holds them: slot, hits left, and the tick each grows back.
  const used = (n: number): Uint8Array => {
    const w = new BitWriter(16 + n * 12);
    w.varint(n);
    for (let i = 0; i < n; i++) (w.u8(i), w.varint(0), w.uint53(h.world.tick + 100000 + n));
    return w.bytes().slice();
  };
  h.host.harvest!.decode(chunk, used(255));
  h.run(200);
  expect(shown()).toBe(1);
  h.host.harvest!.decode(chunk, used(256));
  h.run(200);
  expect(shown()).toBe(0);
});
