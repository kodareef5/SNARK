// A second opinion on the page's bounded map loader: seeded random interleavings of moves, teleports, answers in any
// order, failures, damage, pauses, wants that come and go and sectors a reader waits for, on a map of 36 sectors; then
// what the page holds is compared with the map read whole and with a page that took the same parts in order.
//
//   REVIEW_SEEDS=200 REVIEW_FROM=1 REVIEW_EVENTS=400 bun test tests/world/review-fuzz.test.ts

import { expect, test } from "bun:test";
import type { Place } from "../../client/core/mapload.ts";
import { ROAD_REACH } from "../../client/core/map-want.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { writeMap, type MapPart } from "../../shared/world/mapfile.ts";
import { checksOf } from "./review-checks.ts";
import { Link, PER, inside, offOf, reviewMap, startLoader, turn, wantOf, type Wants } from "./review-rig.ts";

const file = writeMap(reviewMap(36000));
const { head, reg, wholeHf, sectorOf, mapRows, heldRows, reference, compare, books } = checksOf(file);
const SIZE = head.dims.chunksX * CHUNK_SIZE;

const SEEDS = Number(process.env.REVIEW_SEEDS ?? 12);
const FROM = Number(process.env.REVIEW_FROM ?? 1);
const EVENTS = Number(process.env.REVIEW_EVENTS ?? 300);

/** What one run found wrong, a line each; none is a pass. */
interface Run {
  wrong: string[];
  events: number;
  asked: number;
  /** Parts asked for more than once, answers failed and damaged, and sectors, pages and overviews let go. */
  again: number;
  failed: number;
  let: number[];
}

/** One seeded run: `events` of them, then everything answered and the clock run until the page says it is settled. */
async function run(seed: number, events: number): Promise<Run> {
  const rng = new Rng(seed);
  const link = new Link(file);
  const loader = await startLoader(link);
  const li = inside(loader), parts = loader.staged.head.parts;
  const wrong: string[] = [];
  const say = (line: string): void => void (wrong.length < 12 && wrong.push(line));
  // A few places the body comes back to, so what was let go is asked for again; some on sectors' corners.
  const homes = [[2600, 2600], [520, 520], [1536, 1536], [4600, 700], [2560, 4090], [3072 + 3, 3072 - 3], [60, 5000]];
  const body = { x: 2600, z: 2600, vx: 0, vz: 0 };
  const tight = seed % 3;
  const wants: Wants = { view: 1400 + rng.int(800), statics: 500 + rng.int(500), camera: null, focus: null, screen: null, ...(tight === 1 ? { budget: 60e3 + rng.int(60e3), ground: 3.5e6 } : tight === 2 ? { budget: 900e3, ground: 6e6 } : {}) };
  const city = loader.held.follow(reg);
  // A reader of the city as the renderers follow it: the squares it believes held.
  const seen = new Uint32Array(city.size), believed = new Set<string>();
  const read = (): void => city.news(seen, (sq, held) => void (held ? believed.add(`${sq.cx0},${sq.cz0}`) : believed.delete(`${sq.cx0},${sq.cz0}`)));
  let keep = new Set<MapPart>();
  loader.held.keep = (p) => keep.has(p);
  let handed = 0, once = 0, answered = 0;
  let drawn = false;
  void loader.follow((): Place => body, { arriving: function* () { handed++; }, want: () => wantOf(wants) }).then(() => (drawn = true));
  for (let k = 0; k < 200 && !drawn; k++) await link.drain(0, 1);
  if (!drawn) return { wrong: ["the first frame never came"], events: 0, asked: 0, again: 0, failed: 0, let: [0, 0, 0] };
  // Counts what is let go: a sector's statics, a page of ground, an overview.
  const gone = [0, 0, 0];
  const [dropStatics, dropGround, release] = [loader.held.drop.bind(loader.held), loader.staged.drop.bind(loader.staged), loader.staged.release.bind(loader.staged)];
  loader.held.drop = (q) => (loader.held.has(q) && gone[0]!++, dropStatics(q));
  loader.staged.drop = (sq) => (loader.staged.hf.holds(sq) && gone[1]!++, dropGround(sq));
  // An overview is let go a band a pause, apart from what the page waits for: `releasing` are under way.
  let releasing = 0;
  loader.staged.release = function* (col, row) {
    gone[2]!++;
    releasing++;
    try {
      yield* release(col, row);
    } finally {
      releasing--;
    }
  };
  let failedAnswers = 0;
  link.eager = false;
  const damaged = new Set<string>();
  const clamp = (v: number): number => Math.max(1, Math.min(SIZE - 1, v));
  const statics = loader.held.parts;
  let done = 0;
  for (; done < events; done++) {
    const r = rng.int(100);
    if (r < 30) {
      if (link.waiting.length > 0) {
        const k = rng.int(link.waiting.length), url = link.waiting[k]!.url, how = rng.int(20);
        if (how === 0) (failedAnswers++, link.answer(k, "fail"));
        else if (how === 1 && !damaged.has(url)) (failedAnswers++, damaged.add(url), link.answer(k, "damage"));
        else (damaged.delete(url), link.answer(k), answered++);
      }
    } else if (r < 42) {
      if (link.pauses.length > 0) link.step(rng.int(link.pauses.length));
    } else if (r < 57) {
      // A few metres, often across the nearest sector's edge and back.
      const [dx, dz] = [rng.range(-40, 40), rng.range(-40, 40)];
      [body.x, body.z, body.vx, body.vz] = [clamp(body.x + dx), clamp(body.z + dz), dx * 2, dz * 2];
    } else if (r < 62) {
      const h = homes[rng.int(homes.length)]!;
      [body.x, body.z, body.vx, body.vz] = rng.int(3) === 0 ? [clamp(rng.int(SIZE)), clamp(rng.int(SIZE)), 0, 0] : [h[0]! + rng.range(-5, 5), h[1]! + rng.range(-5, 5), 0, 0];
    } else if (r < 67) wants.focus = wants.focus ? null : { x: clamp(body.x + rng.range(-3000, 3000)), z: clamp(body.z + rng.range(-3000, 3000)) };
    else if (r < 72) wants.screen = wants.screen ? null : { x: clamp(rng.int(SIZE)), z: clamp(rng.int(SIZE)), half: 300 + rng.int(2500) };
    else if (r < 76) wants.camera = wants.camera ? null : { x: clamp(body.x + rng.range(-300, 300)), z: clamp(body.z + rng.range(-300, 300)) };
    else if (r < 81) loader.held.need(rng.int(head.counts.length));
    else if (r < 84) loader.held.once(rng.int(head.counts.length), () => once++);
    else if (r < 87) keep = new Set(statics.filter(() => rng.int(8) === 0));
    else if (r < 91) loader.look();
    else await link.advance(rng.int(1300));
    await turn();
    if (done % 7 === 0) read();
    if (done % 16 !== 0) continue;
    // While it runs: a page held is the map's, the chunks said to be the map's own are those of pages held, and a page
    // that says it is settled waits for nothing.
    const hf = loader.staged.hf;
    let bytes = 0;
    for (const p of parts) {
      if (p.kind !== "ground") continue;
      const sq = sectorOf(p), holds = hf.holds(sq);
      if (holds) bytes += ((sq.cx1 - sq.cx0) * PER + 1) * ((sq.cz1 - sq.cz0) * PER + 1) * 3 + ((sq.cx1 - sq.cx0) * PER / 2 + 1) * ((sq.cz1 - sq.cz0) * PER / 2 + 1);
      for (let k = 0; k < 6; k++) {
        const [i, j] = [sq.cx0 * PER + rng.int((sq.cx1 - sq.cx0) * PER + 1), sq.cz0 * PER + rng.int((sq.cz1 - sq.cz0) * PER + 1)];
        if (holds && (hf.stepsAt(i, j) !== wholeHf.stepsAt(i, j) || hf.tintOf(i, j) !== wholeHf.tintOf(i, j))) say(`event ${done}: sample ${i}, ${j} of a page held is not the map's`);
      }
      const c = sq.cz0 * head.dims.chunksX + sq.cx0;
      if ((hf.exact[c] === 1) !== holds) say(`event ${done}: sector ${p.col},${p.row} is ${holds ? "" : "not "}held and its chunk says ${hf.exact[c]}`);
    }
    if (bytes !== hf.bytes) say(`event ${done}: pages counted ${hf.bytes}, held ${bytes}`);
    const c = rng.int(head.counts.length), rows = heldRows(loader.held, c);
    if (rows !== null && rows !== mapRows(c)) say(`event ${done}: chunk ${c}'s statics held are not the map's`);
    const p = loader.progress();
    if (p.settled) {
      const waits = [...li.want.parts.keys()].filter((q) => !li.came.has(q));
      // The roads' and streets' parts are counted apart (MapProgress.roads), and an overview being let go is waited for by nothing.
      const requests = link.waiting.filter((w) => !/\/(road|streets)\./.test(w.url)).length;
      if (requests > 0 || link.pauses.length > releasing || waits.length > 0 || p.left > 0) say(`event ${done}: settled with ${requests} requests, ${link.pauses.length} pauses (${releasing} of overviews let go) and ${waits.length} wanted parts waiting`);
    }
    for (const line of books(loader)) if (!li.going.size && link.pauses.length === 0) say(`event ${done}: ${line}`);
  }
  // Everything is answered, and the clock runs until the page says it is settled.
  link.eager = true;
  keep = new Set();
  // Settled is taken once it has said so, with its roads in, for a second and a half: a look a second (LOOK_EVERY).
  let rounds = 0, quiet = 0;
  for (; rounds < 600 && quiet < 6; rounds++) {
    await link.drain(250, 2);
    const q = loader.progress();
    quiet = q.settled && q.roads === 0 && link.waiting.length === 0 ? quiet + 1 : 0;
  }
  const p = loader.progress();
  if (!p.settled) say(`not settled after ${rounds} rounds: ${p.left} of ${p.parts} left, ${li.going.size} going, ${li.waiting.size} waiting, handing ${li.handing}, handed at ${li.handedAt} of ${loader.held.version}; needed ${loader.held.needed.size}, broken ${li.broken.size}`);
  // Five seconds more: nothing is asked for by a page that is settled and stands still.
  const asked = link.log.length;
  for (let k = 0; k < 20; k++) await link.drain(250, 1);
  if (link.log.length !== asked) say(`settled and still, it asked for ${link.log.length - asked} more in 5 s: ${link.log.slice(asked, asked + 12).map((l) => l.url.slice(4, 22)).join(" ")}`);
  if (!loader.progress().settled) say("it is no longer settled 5 s on");
  for (const line of books(loader)) say(line);
  // Every part within its reach of the body is held, and the ground round the body, the camera and a focus.
  for (const q of parts) {
    const off = offOf(head, q, body.x, body.z);
    if (q.kind === "overview" && off <= wants.view && !li.came.has(q)) say(`overview ${q.col},${q.row} ${off.toFixed(0)} m off is not held`);
    if (q.kind === "ground") {
      const near = Math.min(off, wants.camera ? offOf(head, q, wants.camera.x, wants.camera.z) : Infinity, wants.focus ? offOf(head, q, wants.focus.x, wants.focus.z) : Infinity);
      if (near <= ROAD_REACH && !loader.staged.hf.holds(sectorOf(q))) say(`ground ${q.col},${q.row} ${near.toFixed(0)} m from the body, the camera or a focus is not held`);
    }
    if (q.kind === "statics" && wants.budget === undefined && off <= wants.statics && !loader.held.has(q) && !li.broken.has(q)) say(`statics ${q.col},${q.row} ${off.toFixed(0)} m off are not held`);
    if ((q.kind === "road" || q.kind === "streets") && off <= ROAD_REACH && !li.roadsHeld.has(q)) say(`${q.kind} ${q.col},${q.row} ${off.toFixed(0)} m off are not held`);
  }
  if (p.roads !== 0) say(`${p.roads} roads' parts within reach are not held`);
  // The streets held are those the loader's book says, and no other.
  const streets = loader.staged.hf.streets!;
  for (const q of parts) {
    if (q.kind !== "streets") continue;
    const sq = sectorOf(q), held = streets.heldIn(sq.cx0 * CHUNK_SIZE + 1, sq.cz0 * CHUNK_SIZE + 1, sq.cx1 * CHUNK_SIZE - 1, sq.cz1 * CHUNK_SIZE - 1);
    if (held !== li.roadsHeld.has(q)) say(`streets ${q.col},${q.row}: held ${held}, its book ${li.roadsHeld.has(q)}`);
  }
  if (wants.budget !== undefined && loader.held.bytes > wants.budget && [...statics].filter((q) => loader.held.has(q)).length > 1) say(`statics hold ${loader.held.bytes} bytes over a budget of ${wants.budget}, in ${loader.held.size} sectors, ${loader.held.needed.size} needed`);
  // The city's reader believes held just the squares that are.
  read();
  const truly = new Set<string>();
  statics.forEach((q, n) => city.square(n) && truly.add(`${sectorOf(q).cx0},${sectorOf(q).cz0}`));
  if (believed.size !== truly.size || [...believed].some((k) => !truly.has(k))) say(`a reader of the city believes ${believed.size} squares held, and ${truly.size} are`);
  statics.forEach((q, n) => {
    if ((city.square(n) !== null) !== loader.held.has(q)) say(`sector ${q.col},${q.row}: the city's square ${city.square(n) !== null}, the store ${loader.held.has(q)}`);
  });
  if (loader.held.asked.size > 0 && [...loader.held.asked.keys()].some((q) => !li.broken.has(q))) say(`${loader.held.asked.size} sectors asked for once never came`);
  for (const line of compare(loader, city, reference(loader))) say(line);
  void handed;
  return { wrong, events: done, asked: link.log.length, again: link.refetches().again, failed: failedAnswers, let: gone };
}

test(`${SEEDS} seeded interleavings of ${EVENTS} events leave the page holding what a page that took the same parts in order holds`, async () => {
  const failed: string[] = [];
  let events = 0, asked = 0, again = 0, fails = 0;
  const gone = [0, 0, 0];
  for (let seed = FROM; seed < FROM + SEEDS; seed++) {
    const r = await run(seed, EVENTS);
    events += r.events;
    asked += r.asked;
    again += r.again;
    fails += r.failed;
    r.let.forEach((n, k) => (gone[k]! += n));
    if (r.wrong.length > 0) failed.push(`seed ${seed}:\n  ${r.wrong.join("\n  ")}`);
  }
  console.log(`${SEEDS} seeds from ${FROM}: ${events} events, ${asked} requests (${again} of parts asked before, ${fails} answers failed or damaged), let go ${gone[0]} sectors' statics, ${gone[1]} pages, ${gone[2]} overviews; ${failed.length} seeds wrong`);
  if (failed.length > 0) console.log(failed.slice(0, 8).join("\n"));
  expect(failed.length).toBe(0);
}, 3_600_000);
