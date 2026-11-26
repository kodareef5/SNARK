// A second opinion on the page's bounded map loader, in the game: a page's loader and its session on a server, through
// seeded interleavings of frames, teleports across sectors' edges and far off, answers in any order, failures, pauses,
// the server's pieces taken, hurt and built near and far, and wants that come and go. Then the page is settled and held
// to the server and to the map.
//
//   REVIEW_SEEDS=60 REVIEW_FROM=1 REVIEW_EVENTS=500 bun test tests/world/review-fuzz-game.test.ts

import { expect, test } from "bun:test";
import { CHUNK_SIZE, chunkAt } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { writeMap, type MapPart } from "../../shared/world/mapfile.ts";
import { checksOf } from "./review-checks.ts";
import { Page, differ, inside, reviewMap, serverOn, sessionInside, type Wants } from "./review-rig.ts";

const file = writeMap(reviewMap(36000));
const { head, whole, compare, reference, books } = checksOf(file);
const SIZE = head.dims.chunksX * CHUNK_SIZE;

const SEEDS = Number(process.env.REVIEW_SEEDS ?? 6);
const FROM = Number(process.env.REVIEW_FROM ?? 1);
const EVENTS = Number(process.env.REVIEW_EVENTS ?? 400);

interface Run {
  wrong: string[];
  frames: number;
  asked: number;
  edits: number;
  let: number;
  queued: number;
}

async function run(seed: number, events: number): Promise<Run> {
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
    if (process.env.REVIEW_SAY) {
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

test(`${SEEDS} seeded games of ${EVENTS} events leave the page holding what the server and the map hold`, async () => {
  const failed: string[] = [];
  const sum = { frames: 0, asked: 0, edits: 0, let: 0, queued: 0 };
  for (let seed = FROM; seed < FROM + SEEDS; seed++) {
    const r = await run(seed, EVENTS);
    sum.frames += r.frames;
    sum.asked += r.asked;
    sum.edits += r.edits;
    sum.let += r.let;
    sum.queued = Math.max(sum.queued, r.queued);
    if (r.wrong.length > 0) failed.push(`seed ${seed}:\n  ${r.wrong.join("\n  ")}`);
  }
  console.log(`${SEEDS} seeds from ${FROM}: ${sum.frames} frames, ${sum.asked} requests, ${sum.edits} pieces changed on the server, ${sum.let} sectors' statics let go, ${sum.queued} chunk messages kept at most; ${failed.length} seeds wrong`);
  if (failed.length > 0) console.log(failed.slice(0, 10).join("\n"));
  expect(failed.length).toBe(0);
}, 3_600_000);
