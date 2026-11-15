// Far bases as blocks on a GPU (D257, D258), a check of tools/probe-lit.ts. Castles and a tower on hills, 300 m to 2 km
// off, drawn as blocks at medium and at low poly, are held to the software rasterizer at points on them. A castle in the
// last tenth of reach must keep the same share of its pixels through the dither as in the rasterizer, within 5%. After
// a lost context the tiles come back. With PROBE_PICTURES naming a folder, a sheet is written there: a base at 2 km, at
// 800 m and at the hand-over, from the ground and from a height, as blocks and in full, in the rasterizer and on the GPU.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { castle, farWorld, type FarWorld } from "../../tests/fixtures/farworld.ts";
import { buildCorePack } from "../pack/build.ts";
import { encodePng } from "../snap/png.ts";
import { PICK_FAR } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
/** A channel within this many levels of the rasterizer's is the same colour, as in the depth and terrain checks. */
const SAME = 6;
/** Of the block pixels compared, the share that may be more than SAME off. */
const MOST_OFF = 0.01;
/** A pixel differs from the frame with no blocks by more than this where the GPU kept a block's fragment. */
const SHOWN = 12;
/** Where the camera stands, and how far it looks along +x to each base. */
const AT = { x: 600, z: 2048 };
const BASES = [300, 800, 1300, 2000];
/** The edge's base: in the last tenth of medium's reach, near halfway through it. */
const EDGE = 1950;

/**
 * Low hills falling 25 m to the east over the 400 m round where the camera stands, so the bases can be seen from the
 * ground, and from 150 m east on, bumps 20 to 30 m across that the ground's coarse levels miss by metres, under the
 * bases, so a block's foot is seen to meet the ground as it is drawn there.
 */
function ground(x: number, z: number): number {
  const fall = Math.min(1, Math.max(0, (AT.x + 200 - x) / 400));
  const bumps = Math.min(1, Math.max(0, (x - AT.x - 150) / 100));
  return 40 + 4 * Math.sin(x / 300) * Math.cos(z / 260) + 25 * fall + 5 * bumps * Math.sin(x / 23 + z / 29);
}

/** The rasterizer's picture of a frame: colours and what is under each pixel. */
interface Picture {
  color: Uint8Array;
  kind: Uint8Array;
  id: Float64Array;
}

interface Held {
  key: string;
  frame: number;
  name: string;
  pic: Picture;
}

const made = {
  held: [] as Held[],
  /** The edge: frames with no blocks, with them unfaded, and faded, and the rasterizer's pictures of the last two. */
  edge: { key: "", frames: [-1, -1, -1], full: null as Picture | null, faded: null as Picture | null },
  /** The sheet's frames, by view: blocks and in full, each the GPU's frame and the rasterizer's picture. */
  sheet: [] as { name: string; frames: number[]; pics: Picture[] }[],
};

/** The middle of the chunk nearest `metres` along +x from where the camera stands and `side` metres across. */
const spot = (metres: number, side: number): [number, number] => [Math.round((AT.x + metres - 32) / 64) * 64 + 32, Math.round((AT.z + side - 32) / 64) * 64 + 32];
const SIDES = [-128, -64, 64, 128];
const TOWER = spot(1100, -256);

function worldFor(tier: string, bytes: Uint8Array): { w: FarWorld; chunks: number[] } {
  const w = farWorld({ chunks: 64, ground, tier: tierOf(tier), width: W, height: H, pack: parsePack(bytes) });
  // The rasterizer draws no haze (D264), so these frames carry none.
  w.scene.plainSky = true;
  const chunks: number[] = [];
  for (const [x, z] of [...BASES.map((d, k) => spot(d, SIDES[k]!)), spot(EDGE, 384)]) chunks.push(castle(w, x, z, w.hf.heightAt(x, z) - 0.5));
  // A narrow tower of pillars, 36 m tall.
  const pillar = w.id("core:pillar");
  for (let i = 0; i < 6; i++) w.server.add(pillar, TOWER[0], w.hf.heightAt(...TOWER) + 3 + i * 6, TOWER[1], 0, 9, 100);
  w.sendAll();
  return { w, chunks };
}

function picture(w: FarWorld): Picture {
  return { color: Uint8Array.from(w.raster.color), kind: w.raster.pickKind.slice(), id: w.raster.pickId.slice() };
}

/** Builds a frame into `shot` as the rasterizer draws it. */
function frame(w: FarWorld, shot: Shot, read: boolean): FramePacket {
  w.scene.now += 1000 / 60;
  const p = w.scene.build(w.cam, null);
  w.raster.render(p);
  shot.add(p, read);
  return p;
}

/** Looks from `up` metres over the ground `metres` short of (x, z) along +x, through a lens `span` metres high there. */
function view(w: FarWorld, x: number, z: number, metres: number, up: number, span: number): void {
  w.cam.fovY = 2 * Math.atan(span / 2 / metres);
  w.look(x, w.hf.heightAt(x, z) + 18, z, metres, Math.PI / 2, up);
}

/** The most a channel of pixel `at` of `a` differs from pixel `bt` of `b`. */
const off = (a: Uint8Array, b: Uint8Array, at: number, bt = at): number => Math.max(...[0, 1, 2].map((c) => Math.abs(a[at * 4 + c]! - b[bt * 4 + c]!)));

/** Block pixels whose 3 by 3 neighbours are of one block face in the rasterizer: how many, and how many the GPU has more than SAME off. */
function blocks(gpu: Uint8Array, pic: Picture): { n: number; bad: number; worst: number } {
  const out = { n: 0, bad: 0, worst: 0 };
  for (let y = 1; y < H - 1; y++) {
    next: for (let x = 1; x < W - 1; x++) {
      const at = y * W + x;
      if (pic.kind[at] !== PICK_FAR) continue;
      for (let dy = -W; dy <= W; dy += W) for (let dx = -1; dx <= 1; dx++) if (pic.kind[at + dy + dx] !== PICK_FAR || off(pic.color, pic.color, at + dy + dx, at) > 2) continue next;
      const o = off(gpu, pic.color, at);
      out.n++;
      if (o > SAME) out.bad++;
      out.worst = Math.max(out.worst, o);
    }
  }
  return out;
}

/** Pictures side by side, a row of them a line, with a gap of 4 pixels. */
function sheet(rows: Uint8Array[][]): Uint8Array {
  const cols = Math.max(...rows.map((r) => r.length));
  const [sw, sh] = [cols * (W + 4) - 4, rows.length * (H + 4) - 4];
  const out = new Uint8Array(sw * sh * 4).fill(255);
  rows.forEach((row, r) => row.forEach((px, c) => {
    for (let y = 0; y < H; y++) out.set(px.subarray(y * W * 4, (y + 1) * W * 4), ((r * (H + 4) + y) * sw + c * (W + 4)) * 4);
  }));
  return encodePng(sw, sh, out);
}

export const farCheck: LitCheck = {
  name: "far blocks (D257, D258)",

  shots(): Shot[] {
    const bytes = buildCorePack();
    const shots: Shot[] = [];
    const hold = (w: FarWorld, shot: Shot, name: string): void => {
      frame(w, shot, true);
      made.held.push({ key: shot.key, frame: shot.frames.length - 1, name, pic: picture(w) });
    };

    // Medium: the bases from a hill 60 m up, through 30 degrees; each through a long lens; then the edge.
    const { w, chunks } = worldFor("medium", bytes);
    const lit = new Shot("far-medium", W, H, w.hf, bytes);
    w.scene.resetUploads();
    w.cam.fovY = (30 * Math.PI) / 180;
    w.look(AT.x + 1200, w.hf.heightAt(AT.x + 1200, AT.z) + 10, AT.z, 1200, Math.PI / 2, 60);
    frame(w, lit, false);
    hold(w, lit, "the bases from a hill, 30 degrees");
    // The one at 2 km is in the last tenth of reach, which the edge holds to the rasterizer.
    for (const [k, d] of BASES.slice(0, 3).entries()) {
      view(w, ...spot(d, SIDES[k]!), d, 30, 80);
      hold(w, lit, `a castle ${d} m off`);
    }
    view(w, ...TOWER, 1100, 2, 60);
    hold(w, lit, "a tower 1.1 km off");
    // The edge: no blocks, every block, and the tier's fade.
    const reach = w.scene.assets.tier.reach;
    view(w, ...spot(EDGE, 384), EDGE, 20, 50);
    const e = made.edge;
    e.key = lit.key;
    for (const [k, bases] of [[0, 0], [1, 4000], [2, reach.bases]] as const) {
      w.scene.assets.tier = { ...w.scene.assets.tier, reach: { ...reach, bases } };
      frame(w, lit, false);
      frame(w, lit, true);
      e.frames[k] = lit.frames.length - 1;
      if (k === 1) e.full = picture(w);
      if (k === 2) e.faded = picture(w);
    }
    shots.push(lit);

    // A base at 2 km, at 800 m and at the hand-over, from the ground and from 100 m up, as blocks and in full.
    const sheetShot = new Shot("far-sheet", W, H, w.hf, bytes);
    w.scene.resetUploads();
    for (const [k, name] of [[3, "2 km"], [1, "800 m"], [0, "the hand-over, 300 m"]] as const) {
      for (const up of [1.6, 100]) {
        view(w, ...spot(BASES[k]!, SIDES[k]!), BASES[k]!, up, 70);
        const s = { name: `${name}, ${up > 2 ? "100 m up" : "from the ground"}`, frames: [] as number[], pics: [] as Picture[] };
        for (const whole of [false, true]) {
          if (whole) w.rows(chunks[k]!);
          frame(w, sheetShot, true);
          s.frames.push(sheetShot.frames.length - 1);
          s.pics.push(picture(w));
          if (whole) w.drop(chunks[k]!);
        }
        made.sheet.push(s);
      }
    }
    shots.push(sheetShot);

    // Low poly, FLAT with the fade: the bases within its kilometre.
    const low = worldFor("lowpoly", bytes).w;
    const flat = new Shot("far-lowpoly", W, H, low.hf, bytes);
    view(low, ...spot(800, SIDES[1]!), 800, 30, 80);
    frame(low, flat, false);
    hold(low, flat, "low poly: a castle 800 m off");
    shots.push(flat);

    // A lost context: the tiles go on the card again.
    const lost = new Shot("far-lost", W, H, w.hf, bytes);
    w.scene.resetUploads();
    w.cam.fovY = (30 * Math.PI) / 180;
    w.look(AT.x + 1200, w.hf.heightAt(AT.x + 1200, AT.z) + 10, AT.z, 1200, Math.PI / 2, 60);
    frame(w, lost, false);
    frame(w, lost, false);
    lost.loseAt = 2;
    w.scene.resetUploads();
    hold(w, lost, "after a lost context");
    shots.push(lost);
    return shots;
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    for (const h of made.held) {
      const gpu = back.pixels(h.key, h.frame);
      if (!gpu) {
        lines.push(`${h.name}: NO PICTURE`);
        ok = false;
        continue;
      }
      const b = blocks(gpu, h.pic);
      const pass = b.n >= 30 && b.bad <= b.n * MOST_OFF;
      ok &&= pass;
      lines.push(`${h.name}: ${b.n - b.bad} of ${b.n} block pixels within ${SAME} of the rasterizer, the worst ${b.worst} off  ${pass ? "ok" : "FAIL"}`);
    }

    const e = made.edge;
    const [none, full, faded] = e.frames.map((f) => back.pixels(e.key, f));
    const count = (p: Picture): number => p.kind.reduce((n, k) => n + (k === PICK_FAR ? 1 : 0), 0);
    if (!none || !full || !faded) {
      lines.push("the edge: NO PICTURE");
      ok = false;
    } else {
      let [region, kept] = [0, 0];
      for (let at = 0; at < W * H; at++) {
        if (off(full, none, at) <= SHOWN) continue;
        region++;
        if (off(faded, none, at) > SHOWN) kept++;
      }
      const [gpuShare, rasterShare] = [kept / Math.max(1, region), count(e.faded!) / Math.max(1, count(e.full!))];
      const pass = region > 2000 && Math.abs(gpuShare - rasterShare) <= 0.05;
      ok &&= pass;
      lines.push(`a castle ${EDGE} m off, in the last tenth of reach: the GPU keeps ${(gpuShare * 100).toFixed(1)}% of its ${region} pixels, the rasterizer ${(rasterShare * 100).toFixed(1)}% of ${count(e.full!)}  ${pass ? "ok" : "FAIL"}`);
    }

    const folder = process.env.PROBE_PICTURES;
    if (folder) {
      const blank = new Uint8Array(W * H * 4);
      mkdirSync(folder, { recursive: true });
      const rows = made.sheet.map((s) => [s.pics[0]!.color, back.pixels("far-sheet", s.frames[0]!) ?? blank, s.pics[1]!.color, back.pixels("far-sheet", s.frames[1]!) ?? blank]);
      writeFileSync(join(folder, "far-sheet.png"), sheet(rows));
      const held = made.held.map((h) => [h.pic.color, back.pixels(h.key, h.frame) ?? blank]);
      writeFileSync(join(folder, "far-views.png"), sheet(held));
      writeFileSync(join(folder, "far-edge.png"), sheet([[e.full!.color, full ?? blank], [e.faded!.color, faded ?? blank]]));
      lines.push(`pictures in ${folder}: far-sheet.png (by row ${made.sheet.map((s) => s.name).join("; ")}; rasterizer and GPU as blocks, then in full), far-views.png (${made.held.map((h) => h.name).join("; ")}; rasterizer, GPU), far-edge.png`);
    }
    return { ok, lines };
  },
};
