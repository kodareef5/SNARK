// What a world tells its clients the screens play (server/video/screens.ts): sent on a welcome and when the item changes,
// with the clip's start turned from the wall clock into the world's ticks.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VideoLibrary } from "../../server/video/library.ts";
import { ScreenFeed, startTick, worldNight } from "../../server/video/screens.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { OWN_SCREEN, S_OWN } from "../../shared/net/protocol.ts";
import { offsetForHour } from "../../shared/sim/clock.ts";
import type { Clip } from "../../shared/video/clip.ts";
import { NO_CLIP, SCREEN_FILL, SCREEN_SOUND, SCREEN_FACING, SHOW_SCENES, SHOW_VIDEO, readScreens, type ScreenState } from "../../shared/video/screen.ts";
import { Harness } from "../fixtures/net.ts";

const root = mkdtempSync(join(tmpdir(), "snark-video-screen-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const starter = (id: string, seconds: number): Clip => ({
  id, title: id, file: `/media/${id}.${id}.mp4`, poster: `/media/${id}.${id}.jpg`, width: 640, height: 360, seconds, bytes: 1, audio: false, rights: "public domain", starter: true, colours: "",
});
const A = "a1a1a1a1a1a1a1a1", B = "b2b2b2b2b2b2b2b2";

function library(now: () => number): VideoLibrary {
  const dir = mkdtempSync(join(root, "lib-"));
  mkdirSync(join(dir, "media"));
  writeFileSync(join(dir, "starter.json"), JSON.stringify({ clips: [starter(A, 10), starter(B, 20)], strip: [A, B] }));
  return new VideoLibrary({ db: ":memory:", media: join(dir, "media"), tmp: join(dir, "tmp"), starters: join(dir, "starter.json"), now });
}

/** The OWN_SCREEN messages the server sends over connection `i` from now on, read. */
function screensSent(h: Harness, i: number): ScreenState[][] {
  const got: ScreenState[][] = [];
  const peer = h.ends[i]!.peer, send = peer.send.bind(peer), r = new BitReader();
  peer.send = (channel, data) => {
    if (data[0] === S_OWN && data[1] === OWN_SCREEN) {
      const out: ScreenState[] = [];
      r.reset(data.subarray(2));
      readScreens(r, out);
      got.push(out);
    }
    send(channel, data);
  };
  return got;
}

test("a clip's start tick is the world's tick less the time it has played", () => {
  expect(startTick(1000, 50_000, 50_000)).toBe(1000);
  expect(startTick(1000, 52_500, 50_000)).toBe(1000 - 2.5 * TICK_RATE);
  // A clip that began before the world did starts at a tick before its first.
  expect(startTick(10, 60_000, 0)).toBe(10 - 60 * TICK_RATE);
});

test("the world sends the screens on a welcome and again only when the item changes", () => {
  let wall = 1_000_000;
  const lib = library(() => wall);
  const h = new Harness({}, 1, 30);
  const feed = new ScreenFeed(lib, h.world);
  feed.attach(h.server);
  feed.poll(wall, false);
  h.join("ada");
  const sent = screensSent(h, 0);
  h.run(400);
  // The orb is on the scenes until an admin picks something, set to fill the ball facing each viewer.
  expect(sent.length).toBe(1);
  const manifest = lib.view().manifestId;
  expect(sent[0]).toEqual([{ manifest, show: SHOW_SCENES, flags: SCREEN_FACING | SCREEN_FILL, clip: NO_CLIP, start: 0, next: NO_CLIP }]);

  lib.edit(null, (doc) => ((doc.screens[0] = { ...doc.screens[0]!, show: "strip", fill: true, sound: true }), null));
  wall += 3_000;
  feed.poll(wall, false);
  const at = h.world.tick;
  h.run(200);
  expect(sent.length).toBe(2);
  // The strip's epoch is the library's birth, three seconds ago, so A has played three seconds.
  expect(sent[1]![0]).toEqual({ manifest, show: SHOW_VIDEO, flags: SCREEN_FACING | SCREEN_FILL | SCREEN_SOUND, clip: 0, start: at - 3 * TICK_RATE, next: 1 });

  // The same item a few seconds on is no news, whatever the ticks did meanwhile.
  for (let s = 0; s < 5; s++) {
    wall += 1_000;
    feed.poll(wall, false);
    h.run(100);
  }
  expect(sent.length).toBe(2);
  // At A's end B plays, and the message says so once.
  wall = 1_000_000 + 10_500;
  feed.poll(wall, false);
  h.run(100);
  expect(sent.length).toBe(3);
  expect(sent[2]![0]).toMatchObject({ show: SHOW_VIDEO, clip: 1, next: 0 });

  // A session joining later is sent what plays now, with the same start.
  h.join("bea");
  const late = screensSent(h, 1);
  h.run(400);
  expect(late).toEqual([sent[2]!]);
  lib.close();
});

test("a play once runs its clip and returns to the channel", () => {
  let wall = 2_000_000;
  const lib = library(() => wall);
  const h = new Harness({}, 1, 30);
  const feed = new ScreenFeed(lib, h.world);
  lib.edit(null, (doc) => ((doc.screens[0] = { ...doc.screens[0]!, show: "strip", once: { clip: B, from: wall } }), null));
  feed.poll(wall, false);
  // B from its first second; the strip after it is in B too, ten seconds into its round.
  expect(feed.states[0]).toMatchObject({ show: SHOW_VIDEO, clip: 1, start: h.world.tick, next: 1 });
  wall += 20_001;
  feed.poll(wall, false);
  expect(feed.states[0]).toMatchObject({ show: SHOW_VIDEO, clip: 1, start: startTick(h.world.tick, wall, 2_010_000), next: 0 });
  lib.close();
});

test("a night-only screen shows the scenes by day, and night is the sun below the horizon", () => {
  const wall = 3_000_000;
  const lib = library(() => wall);
  const h = new Harness({}, 1, 30);
  const feed = new ScreenFeed(lib, h.world);
  lib.edit(null, (doc) => ((doc.screens[0] = { ...doc.screens[0]!, show: "strip", night: true, mode: "fixed" }), null));
  h.world.dayOffset = offsetForHour(h.world.tick, 12, h.world.clock);
  expect(worldNight(h.world)).toBe(false);
  feed.poll(wall);
  expect(feed.states[0]).toMatchObject({ show: SHOW_SCENES, flags: SCREEN_FILL, clip: NO_CLIP });
  const version = feed.version;
  h.world.dayOffset = offsetForHour(h.world.tick, 21, h.world.clock);
  expect(worldNight(h.world)).toBe(true);
  feed.poll(wall + 1_000);
  expect(feed.states[0]).toMatchObject({ show: SHOW_VIDEO, flags: SCREEN_FILL, clip: 0 });
  expect(feed.version).toBe(version + 1);
  lib.close();
});

test("the feed looks at the library's file only every two seconds", () => {
  let wall = 4_000_000, stamps = 0;
  const lib = library(() => wall);
  const counted = { stamp: () => (stamps++, lib.stamp()), view: () => lib.view(), sweep: () => lib.sweep() };
  const feed = new ScreenFeed(counted, new Harness({}, 1, 30).world);
  for (let s = 0; s < 6; s++, wall += 1_000) feed.poll(wall, false);
  expect(stamps).toBe(3);
  lib.close();
});
