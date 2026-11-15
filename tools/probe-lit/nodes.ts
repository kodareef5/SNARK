// Far trees, rocks and bushes on a GPU (D259, D260), a check of tools/probe-lit.ts. A forested hillside of the core
// content's kinds, seen at medium and at low poly from 30 m and 150 m over the canopy and at the edge of reach: far
// node pixels are held to the software rasterizer. Trees at medium's reach must keep the same share of their pixels
// through the dither as in the rasterizer, within 5%. With the camera still and the near field moved by a chunk, the
// GPU's picture must not change where the chunk's nodes go from far to near. After a lost context the tiles come back.
// With PROBE_PICTURES naming a folder, sheets are written there: the views in the rasterizer and on the GPU, hazed as a
// player sees them, and a walk into a wood across the join.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { CHUNK_SIZE, type MapDims } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { scatterNodes, type NodeForms, type NodeSource } from "../../shared/world/nodes.ts";
import { nodeWorld, type NodeWorld } from "../../tests/fixtures/nodeworld.ts";
import { buildCorePack } from "../pack/build.ts";
import { encodePng } from "../snap/png.ts";
import { PICK_FAR, PICK_STRUCTURE } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
/** A channel within this many levels of the rasterizer's is the same colour, as in the far blocks' check. */
const SAME = 6;
/** Of the node pixels compared, the share that may be more than SAME off. */
const MOST_OFF = 0.01;
/** A pixel differs from the frame without far trees by more than this where the GPU kept a far tree's fragment. */
const SHOWN = 12;
/** Where the body stands, and the hillside it looks east across. */
const AT = { x: 520, z: 2080 };
const KINDS = ["core:tree", "core:tree", "core:tree", "core:palm", "core:palm", "core:fig", "core:banyan", "core:mangrove", "core:rock", "core:rubble", "core:metal_rock", "core:bush", "core:palmetto", "core:fern", "core:seagrape"];

/** A valley the camera stands at the west end of, rising east into long hills, with folds that the far nodes stand on. */
function ground(x: number, z: number): number {
  const rise = Math.min(1, Math.max(0, (x - AT.x - 150) / 1400));
  return 22 + 70 * rise * rise + 18 * Math.sin(x / 260) * Math.cos(z / 230) + 6 * Math.sin(x / 90 + z / 110);
}

interface Picture {
  color: Uint8Array;
  kind: Uint8Array;
  /** 1 where the far fade's dither changes the pixel, which the GPU and the rasterizer may place a pixel apart. */
  dither: Uint8Array;
}

interface Held {
  key: string;
  frame: number;
  name: string;
  pic: Picture;
}

const made = {
  /** Frames held to the rasterizer at far node pixels. */
  held: [] as Held[],
  /** The edge: frames with no far trees, with them unfaded, and faded, and the rasterizer's pictures of the last two. */
  edge: { key: "", frames: [-1, -1, -1], full: null as Picture | null, faded: null as Picture | null },
  /** The hand-over: the frame with a chunk far and the frame with it near, the camera still, and the rasterizer's of the first. */
  hand: { key: "", frames: [-1, -1], pic: null as Picture | null },
  /** The sheets: each view hazed as a player sees it, on the GPU; and the walk, on the GPU, with which pixels were far. */
  views: [] as { key: string; frame: number; name: string; plain: Picture }[],
  walk: { key: "", frames: [] as number[], far: [] as Uint8Array[] },
};

/** A meadow round where the body stands, to 250 m east of it, where nothing grows; the wood begins past it. */
const meadow = (x: number): boolean => x > AT.x - 150 && x < AT.x + 250;

function worldFor(tier: Tier, bytes: Uint8Array): NodeWorld {
  const place = (dims: MapDims, hf: Heightfield, forms: NodeForms, kinds: number[]): NodeSource => scatterNodes(dims, hf, 0xbe7c, 96, forms, (x) => (meadow(x) ? null : kinds));
  const w = nodeWorld({ chunksX: 64, chunksZ: 64, ground, kinds: KINDS, place, tier, width: W, height: H, pack: parsePack(bytes) });
  w.scene.viewHeight = H;
  w.scene.nodesFar!.makes = Infinity;
  return w;
}

/** The rasterizer's last frame, and where the dither changed it: the same packet drawn again with no fade. */
function picture(w: NodeWorld, p: FramePacket): Picture {
  const pic = { color: Uint8Array.from(w.raster.color), kind: w.raster.pickKind.slice(), dither: new Uint8Array(W * H) };
  const share = p.frame[FRAME.fade]!;
  p.frame[FRAME.fade] = 0;
  w.raster.render(p);
  p.frame[FRAME.fade] = share;
  const unfaded = Uint8Array.from(w.raster.color);
  for (let at = 0; at < W * H; at++) pic.dither[at] = off(pic.color, unfaded, at) > 0 ? 1 : 0;
  w.raster.render(p);
  return pic;
}

/** Builds a frame into `shot`, drawn by the rasterizer with the ground. */
function frame(w: NodeWorld, shot: Shot, read: boolean): FramePacket {
  const p = w.frame(true, true);
  shot.add(p, read);
  return p;
}

/** The camera at (x, z), `up` metres over the ground there, looking along +x and `pitch` down, through `fov` degrees high. */
function view(w: NodeWorld, x: number, z: number, up: number, pitch: number, fov = 50): void {
  w.cam.fovY = (fov * Math.PI) / 180;
  w.look(x, w.hf.heightAt(x, z) + up, z, Math.PI / 2, -pitch);
}

/** The camera at (x, z), `up` metres over the ground there, looking at the crowns `ahead` metres along +x. */
function aim(w: NodeWorld, x: number, z: number, up: number, ahead: number, fov: number): void {
  const drop = w.hf.heightAt(x, z) + up - (w.hf.heightAt(x + ahead, z) + 5);
  view(w, x, z, up, Math.atan2(drop, ahead), fov);
}

const off = (a: Uint8Array, b: Uint8Array, at: number, bt = at): number => Math.max(...[0, 1, 2].map((c) => Math.abs(a[at * 4 + c]! - b[bt * 4 + c]!)));

/**
 * Far node pixels whose 3 by 3 neighbours are far node pixels of one colour, undithered, in the rasterizer and of one
 * colour on the GPU: how many, and how many the GPU has more than SAME off. A crown's top seen edge-on is often less
 * than a pixel tall far off, which the GPU's samples catch and the rasterizer's one a pixel misses; such a row is
 * not of one colour on the GPU.
 */
function nodePixels(gpu: Uint8Array, pic: Picture): { n: number; bad: number; worst: number } {
  const out = { n: 0, bad: 0, worst: 0 };
  for (let y = 1; y < H - 1; y++) {
    next: for (let x = 1; x < W - 1; x++) {
      const at = y * W + x;
      if (pic.kind[at] !== PICK_FAR) continue;
      for (let dy = -W; dy <= W; dy += W) {
        for (let dx = -1; dx <= 1; dx++) if (pic.kind[at + dy + dx] !== PICK_FAR || pic.dither[at + dy + dx] || off(pic.color, pic.color, at + dy + dx, at) > 2 || off(gpu, gpu, at + dy + dx, at) > 3) continue next;
      }
      const o = off(gpu, pic.color, at);
      out.n++;
      if (o > SAME) {
        out.bad++;
        if (process.env.DEBUG_NODES) console.log("off at", x, y, [...gpu.subarray(at * 4, at * 4 + 3)], [...pic.color.subarray(at * 4, at * 4 + 3)]);
      }
      out.worst = Math.max(out.worst, o);
    }
  }
  return out;
}

/** Pictures side by side, a row of them a line, with a gap of 4 pixels, each `w` by `h`. */
function sheet(rows: Uint8Array[][], w = W, h = H): Uint8Array {
  const cols = Math.max(...rows.map((r) => r.length));
  const [sw, sh] = [cols * (w + 4) - 4, rows.length * (h + 4) - 4];
  const out = new Uint8Array(sw * sh * 4).fill(255);
  rows.forEach((row, r) => row.forEach((px, c) => {
    for (let y = 0; y < h; y++) out.set(px.subarray(y * w * 4, (y + 1) * w * 4), ((r * (h + 4) + y) * sw + c * (w + 4)) * 4);
  }));
  return encodePng(sw, sh, out);
}

/** `pixels` with those marked in `far` tinted magenta, to show which store drew what. */
function tinted(pixels: Uint8Array, far: Uint8Array): Uint8Array {
  const out = Uint8Array.from(pixels);
  for (let i = 0; i < W * H; i++) {
    if (!far[i]) continue;
    out[i * 4] = Math.min(255, out[i * 4]! * 0.5 + 128);
    out[i * 4 + 2] = Math.min(255, out[i * 4 + 2]! * 0.5 + 128);
  }
  return out;
}

export const nodesCheck: LitCheck = {
  name: "far trees, rocks and bushes (D259, D260)",

  shots(): Shot[] {
    const bytes = buildCorePack();
    const shots: Shot[] = [];
    for (const name of ["medium", "lowpoly"]) {
      const w = worldFor(tierOf(name), bytes);
      w.stand(AT.x, AT.z);
      const shot = new Shot(`nodes-${name}`, W, H, w.hf, bytes);
      // From 30 m and 150 m over the canopy and at the edge of reach: once with a plain sky to hold to the rasterizer,
      // once hazed under the dome as a player sees it. The first frame sets the tier's reach.
      view(w, AT.x, AT.z, 40, 0.12, 50);
      frame(w, shot, false);
      const reach = w.scene.nodesFar!.reachOf(w.kind("core:tree"));
      const looks: [string, () => void][] = [
        ["30 m over the canopy", () => view(w, AT.x, AT.z, 40, 0.12, 50)],
        ["150 m over the canopy", () => view(w, AT.x, AT.z, 160, 0.3, 50)],
        [`the trees' edge of reach, ${reach.toFixed(0)} m`, () => aim(w, AT.x, AT.z, 80, reach * 0.9, 16)],
      ];
      for (const [what, look] of looks) {
        look();
        w.scene.plainSky = true;
        frame(w, shot, false);
        const pic = picture(w, frame(w, shot, true));
        made.held.push({ key: shot.key, frame: shot.frames.length - 1, name: `${name}: ${what}`, pic });
        w.scene.plainSky = false;
        frame(w, shot, true);
        made.views.push({ key: shot.key, frame: shot.frames.length - 1, name: `${name}: ${what}`, plain: pic });
      }
      shots.push(shot);
    }

    // Medium's trees at their reach: none, every one unfaded, and the tier's fade.
    const w = worldFor(tierOf("medium"), bytes);
    w.stand(AT.x, AT.z);
    w.scene.plainSky = true;
    const edge = new Shot("nodes-edge", W, H, w.hf, bytes);
    const medium = tierOf("medium");
    frame(w, edge, false);
    const reach = w.scene.nodesFar!.reachOf(w.kind("core:tree"));
    aim(w, AT.x, AT.z, 150, reach * 0.95, 4);
    for (const [k, trees] of [[0, 0], [1, 8000], [2, medium.reach.trees]] as const) {
      w.scene.assets.tier = { ...medium, reach: { ...medium.reach, trees, rocks: 0, bushes: 0 } };
      frame(w, edge, false);
      const p = frame(w, edge, true);
      made.edge.frames[k] = edge.frames.length - 1;
      if (k === 1) made.edge.full = picture(w, p);
      if (k === 2) made.edge.faded = picture(w, p);
    }
    made.edge.key = edge.key;
    shots.push(edge);

    // The hand-over: the camera still a chunk ahead of the body, the near field moved a chunk east, so the chunk 132 to
    // 196 m ahead of the camera, within every kind's reach, goes near.
    w.scene.assets.tier = medium;
    const hand = new Shot("nodes-hand", W, H, w.hf, bytes);
    w.scene.resetUploads();
    aim(w, AT.x + CHUNK_SIZE, AT.z, 6, 220, 24);
    for (const [k, x] of [[0, AT.x], [1, AT.x + CHUNK_SIZE]] as const) {
      w.stand(x, AT.z);
      frame(w, hand, false);
      const p = frame(w, hand, true);
      made.hand.frames[k] = hand.frames.length - 1;
      if (k === 0) made.hand.pic = picture(w, p);
    }
    made.hand.key = hand.key;
    shots.push(hand);

    // A walk across the meadow into the wood, hazed: 300 m at 3 m a frame, the near field following the body.
    const walk = new Shot("nodes-walk", W, H, w.hf, bytes);
    w.scene.resetUploads();
    w.scene.plainSky = false;
    for (let x = AT.x, k = 0; x <= AT.x + 300; x += 3, k++) {
      w.stand(x, AT.z);
      view(w, x, AT.z, 1.7, -0.02, 50);
      const read = k % 12 === 0;
      frame(w, walk, read);
      if (!read) continue;
      made.walk.frames.push(walk.frames.length - 1);
      made.walk.far.push(w.raster.pickKind.map((kind) => (kind === PICK_FAR ? 1 : 0)));
    }
    made.walk.key = walk.key;
    shots.push(walk);

    // A lost context: the tiles go on the card again.
    const lost = new Shot("nodes-lost", W, H, w.hf, bytes);
    w.scene.resetUploads();
    w.scene.plainSky = true;
    view(w, AT.x, AT.z, 45, 0.12, 50);
    frame(w, lost, false);
    frame(w, lost, false);
    lost.loseAt = 2;
    w.scene.resetUploads();
    const p = frame(w, lost, true);
    made.held.push({ key: lost.key, frame: lost.frames.length - 1, name: "after a lost context", pic: picture(w, p) });
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
      const b = nodePixels(gpu, h.pic);
      const pass = b.n >= 30 && b.bad <= b.n * MOST_OFF;
      ok &&= pass;
      lines.push(`${h.name}: ${b.n - b.bad} of ${b.n} far node pixels within ${SAME} of the rasterizer, the worst ${b.worst} off  ${pass ? "ok" : "FAIL"}`);
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
      lines.push(`trees at medium's reach: the GPU keeps ${(gpuShare * 100).toFixed(1)}% of their ${region} pixels, the rasterizer ${(rasterShare * 100).toFixed(1)}% of ${count(e.full!)}  ${pass ? "ok" : "FAIL"}`);
    }

    const [before, after] = made.hand.frames.map((f) => back.pixels(made.hand.key, f));
    if (!before || !after) {
      lines.push("the hand-over: NO PICTURE");
      ok = false;
    } else {
      // Pixels of nodes the rasterizer drew far before, which the GPU must show the same once they are near.
      let [n, changed] = [0, 0];
      const pic = made.hand.pic!;
      for (let at = 0; at < W * H; at++) {
        if (pic.kind[at] !== PICK_FAR && pic.kind[at] !== PICK_STRUCTURE) continue;
        n++;
        if (off(before, after, at) > SAME) changed++;
      }
      const pass = n > 2000 && changed <= n * MOST_OFF;
      ok &&= pass;
      lines.push(`a chunk handed from far to near, the camera still: ${changed} of ${n} node pixels changed on the GPU by more than ${SAME}  ${pass ? "ok" : "FAIL"}`);
    }

    const folder = process.env.PROBE_PICTURES;
    if (folder) {
      const blank = new Uint8Array(W * H * 4);
      mkdirSync(folder, { recursive: true });
      // Each view: the rasterizer, the GPU with a plain sky, and the GPU hazed.
      const rows = made.views.map((v) => {
        const plain = made.held.find((h) => h.key === v.key && h.name === v.name)!;
        return [v.plain.color, back.pixels(plain.key, plain.frame) ?? blank, back.pixels(v.key, v.frame) ?? blank];
      });
      writeFileSync(join(folder, "f3-views.png"), sheet(rows));
      const walk = made.walk.frames.map((f, k) => {
        const gpu = back.pixels(made.walk.key, f) ?? blank;
        return [gpu, tinted(gpu, made.walk.far[k]!)];
      });
      writeFileSync(join(folder, "f3-walk.png"), sheet(walk));
      writeFileSync(join(folder, "f3-edge.png"), sheet([[e.full!.color, full ?? blank], [e.faded!.color, faded ?? blank]]));
      writeFileSync(join(folder, "f3-hand.png"), sheet([[before ?? blank, after ?? blank, tinted(before ?? blank, made.hand.pic!.kind.map((k) => (k === PICK_FAR ? 1 : 0)))]]));
      lines.push(`pictures in ${folder}: f3-views.png (by row ${made.views.map((v) => v.name).join("; ")}; the rasterizer, the GPU with a plain sky, the GPU hazed), f3-walk.png (every 36 m of a walk east across the meadow into the wood, the GPU, and the same with far nodes tinted), f3-edge.png (trees at medium's reach unfaded and faded, rasterizer and GPU), f3-hand.png (a chunk far, then near, then far tinted)`);
    }
    return { ok, lines };
  },
};
