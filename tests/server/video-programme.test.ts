// What a screen plays (shared/video/programme.ts) and the message that tells a client (shared/video/screen.ts).
import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { COLOUR_PARTS, defaultScreen, trackColour, type Channel, type Screen } from "../../shared/video/clip.ts";
import { changesAt, channelAt, screenAt, type Timed } from "../../shared/video/programme.ts";
import { NO_CLIP, SCREEN_FILL, SCREEN_FACING, SHOW_VIDEO, newScreenState, readScreens, writeScreens } from "../../shared/video/screen.ts";

const clips = new Map<string, Timed>([
  ["a", { id: "a", seconds: 10 }],
  ["b", { id: "b", seconds: 20 }],
  ["c", { id: "c", seconds: 5 }],
]);
const channel = (items: string[], shuffle = false): Channel => ({ name: "strip", items, shuffle, epoch: 1_000_000 });

test("a channel plays its items in order and loops", () => {
  const ch = channel(["a", "b", "c"]);
  expect(channelAt(ch, clips, 1_000_000 + 5_000)).toEqual({ clip: "a", start: 1_000_000, next: "b" });
  expect(channelAt(ch, clips, 1_000_000 + 15_000)).toEqual({ clip: "b", start: 1_010_000, next: "c" });
  expect(channelAt(ch, clips, 1_000_000 + 32_000)).toEqual({ clip: "c", start: 1_030_000, next: "a" });
  // The second round starts where the first ended.
  expect(channelAt(ch, clips, 1_000_000 + 36_000)).toEqual({ clip: "a", start: 1_035_000, next: "b" });
});

test("a channel's place before its epoch is a round earlier", () => {
  expect(channelAt(channel(["a", "b", "c"]), clips, 1_000_000 - 1_000)?.clip).toBe("c");
});

test("items missing from the library are passed over, and an empty channel plays nothing", () => {
  expect(channelAt(channel(["gone", "b"]), clips, 1_000_000 + 1_000)).toEqual({ clip: "b", start: 1_000_000, next: "b" });
  expect(channelAt(channel(["gone"]), clips, 1_000_000)).toBeNull();
});

test("a shuffled round plays every item once, in an order each round keeps", () => {
  const many = new Map<string, Timed>();
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    ids.push(`k${i}`);
    many.set(`k${i}`, { id: `k${i}`, seconds: 1 });
  }
  const ch = channel(ids, true), round = (r: number): string[] => ids.map((_, i) => channelAt(ch, many, ch.epoch + r * 12_000 + i * 1000 + 500)!.clip);
  expect(round(0).slice().sort()).toEqual(ids.slice().sort());
  expect(round(0)).not.toEqual(ids);
  expect(round(0)).toEqual(round(0));
  expect(round(1)).not.toEqual(round(0));
  // The next item at a round's end is the next round's first.
  expect(channelAt(ch, many, ch.epoch + 11_500)!.next).toBe(round(1)[0]!);
});

test("a screen plays its one showing, then returns to its channel", () => {
  const channels = new Map([["strip", channel(["a", "b"])]]);
  const screen: Screen = { ...defaultScreen("orb"), show: "strip", once: { clip: "c", from: 2_000_000 } };
  expect(screenAt(screen, channels, clips, 2_000_000 + 1_000, true)).toEqual({ clip: "c", start: 2_000_000, next: channelAt(channels.get("strip")!, clips, 2_005_000)!.clip });
  expect(screenAt(screen, channels, clips, 2_005_000, true)?.clip).toBe(channelAt(channels.get("strip")!, clips, 2_005_000)!.clip);
  // On the scenes, a showing ends with nothing after it.
  const alone: Screen = { ...screen, show: "scenes" };
  expect(screenAt(alone, channels, clips, 2_001_000, true)).toEqual({ clip: "c", start: 2_000_000, next: null });
  expect(screenAt(alone, channels, clips, 2_006_000, true)).toBeNull();
});

test("a screen that plays by night shows its scenes by day", () => {
  const channels = new Map([["strip", channel(["a"])]]);
  const screen: Screen = { ...defaultScreen("orb"), show: "strip", night: true };
  expect(screenAt(screen, channels, clips, 1_000_000, false)).toBeNull();
  expect(screenAt(screen, channels, clips, 1_000_000, true)?.clip).toBe("a");
});

test("what plays changes when its clip ends", () => {
  expect(changesAt({ clip: "b", start: 100, next: "c" }, clips)).toBe(20_100);
  expect(changesAt(null, clips)).toBe(Infinity);
});

test("the screen message reads back what was written, in 8 bytes and 25 a type", () => {
  const s = newScreenState();
  s.manifest = "0123456789abcdef";
  s.show = SHOW_VIDEO;
  s.flags = SCREEN_FACING | SCREEN_FILL;
  s.clip = 3;
  s.start = -1234.5;
  s.next = NO_CLIP;
  s.scene = 4;
  s.channel = 2;
  s.epoch = -98765.25;
  const w = new BitWriter(64);
  writeScreens(w, [s]);
  const bytes = w.bytes();
  expect(bytes.length).toBe(8 + 1 + 25);
  const out = [newScreenState()];
  readScreens(new BitReader(bytes), out);
  expect(out).toEqual([s]);
});

test("a clip's colour track eases between its samples", () => {
  const track = new Uint8Array(2 * COLOUR_PARTS * 3);
  track[0] = 0;
  track[COLOUR_PARTS * 3] = 255;
  const out = [0, 0, 0];
  trackColour(track, 0.125, 0, out);
  expect(out[0]).toBeCloseTo(0.5, 5);
  trackColour(track, 99, 0, out);
  expect(out[0]).toBe(1);
  trackColour(new Uint8Array(0), 1, 0, out);
  expect(out).toEqual([0, 0, 0]);
});
