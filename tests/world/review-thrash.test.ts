// A second opinion on what the page fetches again: a body that jitters on the corner of four sectors, a map screen
// panned back and forth, a scope flicked on and off and swept, on a link that answers at once. Each minute's requests are
// counted, and those of parts that had come before.
//
// On the review map by default. On a built city with the tiers' own reaches:
//   REVIEW_MAP=/path/miami.snmap REVIEW_AT=7520,5280 bun test tests/world/review-thrash.test.ts

import { expect, test } from "bun:test";
import { existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FOCUS_STATICS, KEEP_PAST, ROAD_REACH, tierWant } from "../../client/core/map-want.ts";
import { Rng } from "../../shared/rng.ts";
import { partsFolder, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { Link, reviewMap, startLoader, wantOf, type Wants } from "./review-rig.ts";

const CITY = process.env.REVIEW_MAP;
const [AX, AZ] = (process.env.REVIEW_AT ?? "").split(",").map(Number);

/** A link to the review map, or to a built city's file read a part at a time, and the bytes each part is on the wire. */
function linkOf(): { link: Link; wire: (url: string) => number } {
  if (!CITY) {
    const link = new Link(writeMap(reviewMap(36000)));
    return { link, wire: (url) => link.read(url)?.length ?? 0 };
  }
  const fd = openSync(CITY, "r");
  const first = new Uint8Array(1 << 22);
  readSync(fd, first, 0, first.length, 0);
  const head = readHead(first, false), folder = partsFolder(CITY);
  const where = new Map([[`map/${head.name}`, { at: 0, length: head.bytes }], ...head.parts.map((p): [string, { at: number; length: number }] => [`map/${p.name}`, p])]);
  const read = (url: string): Uint8Array | null => {
    const w = where.get(url);
    if (!w) return null;
    const bytes = new Uint8Array(w.length);
    readSync(fd, bytes, 0, w.length, w.at);
    return bytes;
  };
  const link = new Link(first.subarray(0, head.bytes), read);
  return { link, wire: (url) => { const copy = join(folder, `${url.slice(4)}.br`); return existsSync(copy) ? statSync(copy).size : (where.get(url)?.length ?? 0); } };
}

interface Minute {
  asked: number;
  again: number;
  mb: number;
  kinds: string;
}

/** A page settled with the body at `at`, and a minute of `drive` on it: the requests, those of parts come before, and their megabytes on the wire. */
async function minutes(at: { x: number; z: number }, base: Partial<Wants>, drives: Record<string, (t: number, body: { x: number; z: number; vx: number; vz: number; dead?: boolean }, wants: Wants) => void>): Promise<Record<string, Minute>> {
  const { link, wire } = linkOf();
  const loader = await startLoader(link);
  const body: { x: number; z: number; vx: number; vz: number; dead?: boolean } = { x: at.x, z: at.z, vx: 0, vz: 0 };
  const medium = tierWant(tierOf("medium"));
  const wants: Wants = CITY ? { view: medium.view, statics: medium.statics, budget: medium.budget!, ground: medium.ground!, camera: null, focus: null, screen: null, ...base } : { view: 1500, statics: 700, camera: null, focus: null, screen: null, ...base };
  let drawn = false;
  // A session whose survivor is dead has no place (ClientSession.place), as one before its welcome has none.
  void loader.follow(() => (body.dead ? null : body), { want: () => wantOf(wants) }).then(() => (drawn = true));
  for (let k = 0; k < 2000 && !drawn; k++) await link.drain(0, 1);
  const settle = async (): Promise<void> => {
    for (let k = 0, quiet = 0; k < 4000 && quiet < 12; k++) {
      await link.drain(250, 1);
      quiet = loader.progress().settled && loader.progress().roads === 0 && link.waiting.length === 0 ? quiet + 1 : 0;
    }
  };
  await settle();
  const out: Record<string, Minute> = {};
  for (const [name, drive] of Object.entries(drives)) {
    // Back to rest between two drives, so each minute starts from the same page.
    [body.x, body.z, body.vx, body.vz, body.dead] = [at.x, at.z, 0, 0, false];
    [wants.camera, wants.focus, wants.screen] = [base.camera ?? null, base.focus ?? null, base.screen ?? null];
    await settle();
    const from = link.log.length;
    const before = new Set(link.log.slice(0, from).map((l) => l.url));
    for (let t = 0; t < 60_000; t += 100) {
      drive(t, body, wants);
      await link.drain(100, 1);
    }
    const asked = link.log.slice(from), kinds = new Map<string, number>();
    let again = 0, bytes = 0;
    for (const l of asked) {
      if (before.has(l.url)) again++;
      before.add(l.url);
      bytes += wire(l.url);
      const kind = l.url.slice(4).split(".")[0]!;
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    out[name] = { asked: asked.length, again, mb: Math.round(bytes / 1e4) / 100, kinds: [...kinds].map(([k, n]) => `${k} ${n}`).join(", ") };
  }
  return out;
}

const size = CITY ? 16320 : 5120;
/** The corner of four sectors nearest the middle of the map, or the place given. */
const corner = CITY ? { x: AX || 7680, z: AZ || 5120 } : { x: 2560, z: 2560 };

test("a body jittering on the corner of four sectors, standing or turning at speed, asks again for nothing", async () => {
  const rng = new Rng(11);
  const got = await minutes(corner, {}, {
    "a few metres of jitter": (_t, body) => void ([body.x, body.z] = [corner.x + rng.range(-5, 5), corner.z + rng.range(-5, 5)]),
    "its way turned about at 80 m/s": (t, body) => void ([body.vx, body.vz] = [80 * Math.cos(t / 700), 80 * Math.sin(t / 700)]),
    "a camera circling 300 m off": (t, _body, wants) => void (wants.camera = { x: corner.x + 300 * Math.cos(t / 900), z: corner.z + 300 * Math.sin(t / 900) }),
  });
  console.log("corner", got);
  expect(got["a few metres of jitter"]!.asked).toBe(0);
  for (const m of Object.values(got)) expect(m.again).toBe(0);
}, 3_600_000);

test("a body jittering at the edge of its statics budget asks again for nothing", async () => {
  const rng = new Rng(12);
  // Budgets a few sectors smaller than the reaches ask for.
  const tight = CITY ? { budget: 12e6, ground: 9e6 } : { budget: 70e3, ground: 3.5e6 };
  const got = await minutes(corner, tight, {
    "a few metres of jitter": (_t, body) => void ([body.x, body.z] = [corner.x + rng.range(-5, 5), corner.z + rng.range(-5, 5)]),
    "walking a 60 m square": (t, body) => void ([body.x, body.z] = [corner.x + 30 * Math.sign(Math.cos(t / 3000)), corner.z + 30 * Math.sign(Math.sin(t / 3000))]),
    "its way turned about at 80 m/s": (t, body) => void ([body.vx, body.vz] = [80 * Math.cos(t / 700), 80 * Math.sin(t / 700)]),
  });
  console.log("budget", got);
  for (const m of Object.values(got)) expect(m.again).toBe(0);
}, 3_600_000);

test("a map screen panned away and back, and a scope flicked on and off, ask again for nothing they held a moment before", async () => {
  // The scope looks at a place 3 km off; the map screen is panned to one 7 km off on a city.
  const home = CITY ? corner : { x: 400, z: 400 };
  const seen = CITY ? { x: corner.x - 2100, z: corner.z + 2100 } : { x: size - 400, z: size - 400 };
  const far = CITY ? { x: corner.x - 5000, z: corner.z + 5000 } : seen;
  const got = await minutes(home, CITY ? {} : { view: 1400 }, {
    // The screen open on a window 1.2 km across over the far place, 3 s there and 3 s over the body.
    "the map screen panned every 3 s": (t, body, wants) => void (wants.screen = { x: Math.floor(t / 3000) % 2 === 0 ? far.x : body.x, z: Math.floor(t / 3000) % 2 === 0 ? far.z : body.z, half: 850 }),
    // A scope on a place far off for 1.5 s, then down for 1.5 s.
    "a scope flicked every 1.5 s": (t, _body, wants) => void (wants.focus = Math.floor(t / 1500) % 2 === 0 ? { x: seen.x, z: seen.z } : null),
    // A scope held up and swept along a street far off at 150 m/s, 3 km and back.
    "a scope swept at 150 m/s": (t, _body, wants) => void (wants.focus = { x: seen.x + (Math.abs(((t / 1000) * 150) % 6000 - 3000) - 1500) * (CITY ? 1 : 0.3), z: seen.z }),
    // A scope up but for 0.4 s in every 3 s: less than the second between two looks.
    "a scope down for 0.4 s in every 3 s": (t, _body, wants) => void (wants.focus = t % 3000 < 400 ? null : { x: seen.x, z: seen.z }),
  });
  console.log("screen and scope", got, { ROAD_REACH, FOCUS_STATICS, KEEP_PAST });
  // A part let go the moment its centre goes has no time to be wanted again: each of these is asked for again and again.
  expect(Object.fromEntries(Object.entries(got).map(([name, m]) => [name, m.again]))).toEqual({ "the map screen panned every 3 s": 0, "a scope flicked every 1.5 s": 0, "a scope swept at 150 m/s": 0, "a scope down for 0.4 s in every 3 s": 0 });
}, 3_600_000);

test("a survivor dead for 10 s in every 30, its camera over where it fell, asks for nothing", async () => {
  // Far from the map's first spawn point: the far corner of the review map, downtown on a city.
  const home = CITY ? corner : { x: 4600, z: 700 };
  const got = await minutes(home, { camera: { x: home.x, z: home.z } }, {
    "dead for 10 s in every 30": (t, body) => void (body.dead = t % 30000 >= 10000 && t % 30000 < 20000),
  });
  console.log("dead", got);
  expect(got["dead for 10 s in every 30"]!.asked).toBe(0);
}, 3_600_000);
