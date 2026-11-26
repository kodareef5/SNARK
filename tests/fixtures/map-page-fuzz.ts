// Seeded random runs of a page of the off-lattice map (map-page.ts), for tests/world/page-fuzz*.test.ts. The loader alone:
// moves, teleports, answers in any order, failures, damage, pauses, wants that come and go and sectors a reader waits
// for. And in the game, its session on a server: frames, teleports across sectors' edges and far off, the server's pieces
// taken, hurt and built near and far. After each run what the page holds is compared with the map read whole, with a
// page that took the same parts in order, and in the game with the server.

import type { Place } from "../../client/core/mapload.ts";
import { ROAD_REACH } from "../../client/core/map-want.ts";
import { CHUNK_SIZE, chunkAt } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { writeMap, type MapPart } from "../../shared/world/mapfile.ts";
import { checksOf } from "./map-page-checks.ts";
import { Link, PER, Page, differ, inside, offOf, pagedMap, serverOn, sessionInside, startLoader, turn, wantOf, type Wants } from "./map-page.ts";

const file = writeMap(pagedMap(36000));
const { head, reg, whole, wholeHf, sectorOf, mapRows, heldRows, reference, compare, books } = checksOf(file);
const SIZE = head.dims.chunksX * CHUNK_SIZE;

/** What one run found wrong, a line each; none is a pass. */
export interface LoaderRun {
  wrong: string[];
  events: number;
  asked: number;
  /** Parts asked for more than once, answers failed and damaged, and sectors, pages and overviews let go. */
  again: number;
  failed: number;
  let: number[];
}

/** One seeded run: `events` of them, then everything answered and the clock run until the page says it is settled. */
export async function fuzzLoader(seed: number, events: number): Promise<LoaderRun> {
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
  let drawn = false;
  void loader.follow((): Place => body, { want: () => wantOf(wants) }).then(() => (drawn = true));
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
        else (damaged.delete(url), link.answer(k));
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
    else if (r < 84) loader.held.once(rng.int(head.counts.length), () => {});
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
  return { wrong, events: done, asked: link.log.length, again: link.refetches().again, failed: failedAnswers, let: gone };
}

export interface GameRun {
  wrong: string[];
  frames: number;
  asked: number;
  edits: number;
  let: number;
  queued: number;
}

/** One seeded game: `events` of them, then everything answered and the game run until the page says it is settled. */
export async function fuzzGame(seed: number, events: number): Promise<GameRun> {
  const rng = new Rng(seed * 7919);
  const h = serverOn(file, seed);
  const wrong: string[] = [];
  const say = (line: string): void => void (wrong.length < 14 && wrong.push(line));
  try {
    const tight = seed % 3;
    const wants: Wants = { view: 1400 + rng.int(800), statics: 500 + rng.int(500), camera: null, focus: null, screen: null, ...(tight === 1 ? { budget: 60e3 + rng.int(60e3), ground: 3.5e6 } : tight === 2 ? { budget: 900e3, ground: 6e6 } : {}) };
    const page = await Page.open(h, file, "ada", wants);
    const { link, loader, session: s } = page;
    const li = inside(loader), si = sessionInside(s);
    const structs = h.world.structs, wall = h.reg.index.get("core:wall")!;
    const statics = whole.statics;
    s.askFar(4000, 4000);
    // A sector's statics are not let go while the near store holds or keeps a chunk of it.
    let gone = 0;
    const drop = loader.held.drop.bind(loader.held);
    loader.held.drop = (part: MapPart) => {
      if (loader.held.has(part)) {
        gone++;
        const near = [...s.world!.structs.held, ...si.parked.keys()].filter((c) => loader.held.partOf(c) === part);
        if (near.length > 0) say(`sector ${part.col},${part.row} was let go while the near store held its chunks ${near.slice(0, 4).join(", ")}`);
      }
      drop(part);
    };
    link.eager = false;
    const clamp = (v: number): number => Math.max(2, Math.min(SIZE - 2, v));
    const homes = [[2600, 2600], [520, 520], [1536, 1536], [4600, 700], [2560, 4090], [3075, 3069], [60, 5000], [1540, 620]];
    let at = { x: 2600, z: 2600 };
    const damaged = new Set<string>();
    let edits = 0, queued = 0;
    /** One of the map's pieces within `reach` chunks of the body's chunk, as its reference, or -1. */
    const pick = (reach: number): number => {
      for (let tries = 0; tries < 20; tries++) {
        const cx = Math.floor(clamp(at.x + rng.range(-reach, reach) * CHUNK_SIZE) / CHUNK_SIZE), cz = Math.floor(clamp(at.z + rng.range(-reach, reach) * CHUNK_SIZE) / CHUNK_SIZE);
        const c = cz * head.dims.chunksX + cx, n = statics.first[c + 1]! - statics.first[c]!;
        if (n === 0) continue;
        const slot = rng.int(n);
        if (structs.chunks[c]!.kind[slot] !== 0) return c * 65536 + slot;
      }
      return -1;
    };
    for (let e = 0; e < events; e++) {
      const r = rng.int(100);
      if (r < 24) {
        if (link.waiting.length > 0) {
          const k = rng.int(link.waiting.length), url = link.waiting[k]!.url, how = rng.int(20);
          if (how === 0) link.answer(k, "fail");
          else if (how === 1 && !damaged.has(url)) (damaged.add(url), link.answer(k, "damage"));
          else (damaged.delete(url), link.answer(k));
        }
      } else if (r < 34) {
        if (link.pauses.length > 0) link.step(rng.int(link.pauses.length));
      } else if (r < 64) await page.run(rng.int(12) * 17 + 17);
      else if (r < 72) {
        // A few metres, across the nearest edge often.
        at = { x: clamp(at.x + rng.range(-40, 40)), z: clamp(at.z + rng.range(-40, 40)) };
        page.tp(at.x, at.z);
      } else if (r < 76) {
        const home = homes[rng.int(homes.length)]!;
        at = rng.int(3) === 0 ? { x: clamp(rng.int(SIZE)), z: clamp(rng.int(SIZE)) } : { x: home[0]! + rng.range(-5, 5), z: home[1]! + rng.range(-5, 5) };
        page.tp(at.x, at.z);
      } else if (r < 83) {
        // A piece of the map taken or hurt, near or far; or a wall built.
        const ref = pick(rng.int(2) === 0 ? 3 : 40), how = rng.int(4);
        if (how === 0) (structs.add(wall, clamp(at.x + rng.range(-150, 150)), 40 + rng.int(20), clamp(at.z + rng.range(-150, 150)), rng.int(65536), 7, 100), edits++);
        else if (ref >= 0 && how === 1) (structs.damage(ref, 3), edits++);
        else if (ref >= 0) (structs.remove(ref), edits++);
      } else if (r < 87) wants.focus = wants.focus ? null : { x: clamp(at.x + rng.range(-3000, 3000)), z: clamp(at.z + rng.range(-3000, 3000)) };
      else if (r < 91) wants.screen = wants.screen ? null : { x: clamp(rng.int(SIZE)), z: clamp(rng.int(SIZE)), half: 300 + rng.int(2500) };
      else if (r < 94) wants.camera = wants.camera ? null : { x: clamp(at.x + rng.range(-300, 300)), z: clamp(at.z + rng.range(-300, 300)) };
      else loader.look();
      queued = Math.max(queued, si.waitingRows.length);
      if (s.state !== "active") {
        say(`event ${e}: the session is ${s.state}`);
        break;
      }
    }
    if (process.env.PAGE_SAY) {
      // Each change of the statics wanted from here on, with what may have changed them.
      const look = loader.look.bind(loader);
      let was = "";
      loader.look = () => {
        look();
        const now = [...li.want.parts.keys()].filter((q) => q.kind === "statics").map((q) => `${q.col}-${q.row}${loader.held.has(q) ? "" : "?"}`).sort().join(" ");
        if (now !== was) console.log(`t ${Math.round(link.now)} body ${s.own.x.toFixed(2)}, ${s.own.z.toFixed(2)} v ${s.own.vx.toFixed(2)}, ${s.own.vz.toFixed(2)} place ${s.place ? "alive" : "none"} needed ${[...loader.held.needed].map((q) => `${q.col}-${q.row}`).join(" ")} held ${loader.held.bytes} of ${wants.budget}: wants ${now}; holds ${loader.held.parts.filter((q) => loader.held.has(q)).map((q) => `${q.col}-${q.row}${loader.held.keep!(q) ? "k" : ""}`).join(" ")}`);
        was = now;
      };
    }
    // Everything is answered and the game runs until the page has been settled, with nothing waiting, for a second and a half.
    link.eager = true;
    let rounds = 0, quiet = 0;
    for (; rounds < 800 && quiet < 6; rounds++) {
      await page.run(250);
      await link.drain(0, 1);
      const p = loader.progress();
      quiet = p.settled && p.roads === 0 && link.waiting.length === 0 && si.waitingRows.length === 0 ? quiet + 1 : 0;
    }
    const p = loader.progress();
    if (quiet < 6) say(`not settled after ${rounds} rounds: ${p.left} of ${p.parts} left, roads ${p.roads}, ${li.going.size} going, ${li.waiting.size} waiting, ${si.waitingRows.length} chunk messages kept, needed ${loader.held.needed.size}, broken ${li.broken.size}`);
    // Four seconds more for the far lists, and nothing more is asked of the link.
    const asked = link.log.length;
    for (let k = 0; k < 16; k++) (await page.run(250), await link.drain(0, 1));
    if (link.log.length !== asked) {
      // A minute more, to tell a late straggler from a page that never stops asking.
      const first = link.log.slice(asked).map((l) => `${l.url.slice(4, 22)}@${Math.round(l.at - link.log[asked]!.at)}`);
      const then = link.log.length;
      for (let k = 0; k < 240; k++) (await page.run(250), await link.drain(0, 1));
      const names = new Map<string, number>();
      for (const l of link.log.slice(then)) names.set(l.url.slice(4, 22), (names.get(l.url.slice(4, 22)) ?? 0) + 1);
      say(`settled and still, it asked for ${then - asked} more in 4 s (${first.slice(0, 8).join(" ")}) and ${link.log.length - then} in the minute after: ${[...names].map(([k, n]) => `${k} x${n}`).slice(0, 10).join(", ")}; budget ${wants.budget}, ground ${wants.ground}, holds ${loader.held.bytes} bytes of statics in ${loader.held.size} sectors, ${loader.staged.hf.bytes} of ground in ${loader.staged.hf.count} pages; body ${s.own.x.toFixed(0)}, ${s.own.z.toFixed(0)} camera ${JSON.stringify(wants.camera)} focus ${JSON.stringify(wants.focus)} screen ${JSON.stringify(wants.screen)} view ${wants.view} statics ${wants.statics}`);
    }
    for (const line of page.unsound.slice(0, 3)) say(line);
    if (si.waitingRows.length > 0 || si.unbased.size > 0 || loader.held.needed.size > 0) say(`${si.waitingRows.length} chunk messages are kept, ${si.unbased.size} chunks lack their map slots, ${loader.held.needed.size} sectors are needed`);
    for (const line of books(loader)) say(line);
    // What the server has sent whole, the page holds as the server does, and says it holds whole.
    const c = page.client, mine = s.world!.structs;
    const sent = page.whole().filter((k) => !loader.held.brokenAt(k));
    const off = sent.filter((k) => differ(structs, mine, [k]) > 0);
    if (off.length > 0) say(`${off.length} of ${sent.length} chunks sent whole differ from the server's: ${off.slice(0, 5).map((k) => `${k} (${differ(structs, mine, [k])} slots, its sector ${loader.held.find(k) ? "held" : "not held"})`).join(", ")}`);
    const partial = sent.filter((k) => si.whole[k] === 0);
    if (partial.length > 0) say(`${partial.length} chunks the server sent whole are not whole to the page: ${partial.slice(0, 6).join(", ")}`);
    // What the page says it holds whole, the server believes it holds.
    const ghosts: number[] = [];
    for (let k = 0; k < si.whole.length; k++) if (si.whole[k] !== 0 && c.known[k] === 0) ghosts.push(k);
    if (ghosts.length > 0) say(`${ghosts.length} chunks are whole to the page and dropped by the server: ${ghosts.slice(0, 6).join(", ")}`);
    if (sent.length === 0) say("the server sent no chunk whole");
    // The lists of pieces gone, where the page was told the server's newest, are the server's.
    const far = h.host.tactical as unknown as { gone: (Uint16Array | null)[]; goneVersion: Uint32Array };
    let lists = 0, stale = 0;
    const here = chunkAt(head.dims, s.own.x, s.own.z), [hx, hz] = [here % head.dims.chunksX, Math.floor(here / head.dims.chunksX)];
    for (let k = 0; k < far.gone.length; k++) {
      const told = s.gone.lists.get(k), truth = far.gone[k] ?? new Uint16Array(0);
      const near = Math.hypot((k % head.dims.chunksX) - hx, Math.floor(k / head.dims.chunksX) - hz) * CHUNK_SIZE < 3500;
      if (told && s.gone.told[k] === far.goneVersion[k] && (told.length !== truth.length || told.some((v, i) => v !== truth[i]))) lists++;
      if (near && truth.length > 0 && (!told || s.gone.told[k] !== far.goneVersion[k])) stale++;
    }
    if (lists > 0) say(`${lists} lists of pieces gone differ from the server's at the same version`);
    if (stale > 0) say(`${stale} chunks within 3.5 km have pieces gone the page was not told of`);
    // Standing still on ground it holds, the body is predicted where the server has it.
    const b = h.world.ents, ent = h.ent(s);
    if (ent >= 0 && Math.hypot(b.x[ent]! - s.own.x, b.z[ent]! - s.own.z) > 1) say(`the body is at ${s.own.x.toFixed(1)}, ${s.own.z.toFixed(1)}, the server's at ${b.x[ent]!.toFixed(1)}, ${b.z[ent]!.toFixed(1)}`);
    if (!s.predicting) say("settled, the body is not predicted");
    const city = s.world!.city?.statics;
    if (!city?.byParts) say("the session's city does not follow the sectors held");
    else for (const line of compare(loader, city, reference(loader))) say(line);
    return { wrong, frames: page.frames, asked: link.log.length, edits, let: gone, queued };
  } finally {
    h.host.shutdown();
  }
}

/** Seeds `from` to `from + seeds` of `run`, each of `events`: the seeds found wrong, their lines under each. */
export async function wrongSeeds(run: (seed: number, events: number) => Promise<{ wrong: string[] }>, from: number, seeds: number, events: number): Promise<string[]> {
  const failed: string[] = [];
  for (let seed = from; seed < from + seeds; seed++) {
    const r = await run(seed, events);
    if (r.wrong.length > 0) failed.push(`seed ${seed}:\n  ${r.wrong.join("\n  ")}`);
  }
  return failed;
}
