import { expect, test } from "bun:test";
import { SLICE, Turns, type Waiting } from "../../tools/map/link.ts";

test("the trip's line gives a game socket of small messages all it has within a round of turns, beside six downloads that fill it", () => {
  // 20 Mbit/s, in bytes a millisecond of the line's own clock.
  const rate = 20e6 / 8 / 1000;
  const turns = new Turns<Waiting>();
  const put = (p: Waiting, bytes: Uint8Array): void => void (p.down.push(bytes), (p.queued += bytes.length));
  const downloads = Array.from({ length: 6 }, (): Waiting => ({ down: [], queued: 0 }));
  const socket: Waiting = { down: [], queued: 0 };
  turns.pipes.push(...downloads, socket);
  // The socket is sent 330 bytes 30 times a second, 10 KB/s, each message's bytes its number; the downloads always have more.
  const MESSAGE = 330;
  let now = 0, turn = 0, sent = 0, slices = 0;
  const queuedAt: number[] = [], waited: number[] = [], got: number[] = [];
  while (now < 3000) {
    for (const d of downloads) while (d.queued < 4 * SLICE) put(d, new Uint8Array(4344));
    for (; (sent * 1000) / 30 <= now; sent++) {
      put(socket, new Uint8Array(MESSAGE).fill(sent & 255));
      queuedAt.push(turn);
    }
    const next = turns.next()!;
    turn++;
    if (next.pipe === socket) {
      for (const b of next.slice) got.push(b);
      for (let k = waited.length; k < Math.floor(got.length / MESSAGE); k++) waited.push(turn - queuedAt[k]!);
    } else slices++;
    now += next.slice.length / rate;
  }
  // Whole and in order, and each message on the line by the socket's turn in the round it came in.
  expect(got.length).toBe(waited.length * MESSAGE);
  expect(got.every((b, i) => b === (Math.floor(i / MESSAGE) & 255))).toBe(true);
  expect(waited.length).toBeGreaterThanOrEqual(sent - 1);
  expect(Math.max(...waited)).toBeLessThanOrEqual(downloads.length + 1);
  // The downloads have the rest of the line.
  expect(slices * SLICE).toBeGreaterThan(0.95 * 3000 * rate - sent * MESSAGE);
});
