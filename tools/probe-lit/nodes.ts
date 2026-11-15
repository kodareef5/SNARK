// Far trees, rocks and bushes on a GPU (D259, D260), a check of tools/probe-lit.ts. A forested hillside of the core
// content's kinds, seen at medium and at low poly from 30 m and 150 m over the canopy and at the edge of reach: far
// node pixels are held to the software rasterizer. Trees at medium's reach must keep the same share of their pixels
// through the dither as in the rasterizer, within 5%.
//
// The hand-over (render/hand.ts): a chunk changes hands where play has it, as the body steps over a chunk border, the
// camera at its eye. With the camera still, the GPU's picture must not change where the chunk's nodes are, on medium and
// on low poly; and walking over the border a metre a frame, the step over it must change no more of the nodes' pixels
// than the steps either side do. Each has a control with the band past the near field, as it was before the band, which
// must show the chunk pop. After a lost context the tiles come back. With PROBE_PICTURES naming a folder, sheets are
// written there: the views in the rasterizer and on the GPU, hazed as a player sees them, the hand-overs, and a walk into
// a wood across the join.

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
  /**
   * The hand-overs: the frame before the body steps over a border and the frame after, the camera still, and the
   * rasterizer's pictures of them; then frames a metre apart walking over it, with what the rasterizer drew where. A
   * control has the band past the near field.
   */
  hands: [] as { name: string; control: boolean; key: string; frames: number[]; pics: Picture[]; walk: number[]; kinds: Uint8Array[] }[],
  /** The sheets: each view hazed as a player sees it, on the GPU; and the walk, on the GPU, with which pixels were far. */
  views: [] as { key: string; frame: number; name: string; plain: Picture }[],
  walk: { key: "", frames: [] as number[], far: [] as Uint8Array[] },
};

/** A meadow round where the body stands, to 250 m east of it, where nothing grows; the wood begins past it. */
const meadow = (x: number): boolean => x > AT.x - 150 && x < AT.x + 250;
/** The chunk border the body steps over, the first east of AT: the chunk the near field takes is 192 to 256 m ahead, in the wood. */
const BORDER = Math.ceil(AT.x / CHUNK_SIZE) * CHUNK_SIZE;
/** The steps of the walk over the border: where the body and the camera stand. The border is between the fourth and the fifth. */
const STEPS = [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5];

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

    // The hand-overs, on medium and low poly, and with the band past the near field as the control.
    for (const [name, tier, control] of [["medium", medium, false], ["low poly", tierOf("lowpoly"), false], ["medium, the band past the near field", { ...medium, nodes: { ...medium.nodes, band: [10000, 10001] as const } }, true]] as const) {
      const hw = worldFor(tier, bytes);
      hw.scene.plainSky = true;
      const shot = new Shot(`nodes-hand-${made.hands.length}`, W, H, hw.hf, bytes);
      const hand = { name, control, key: shot.key, frames: [] as number[], pics: [] as Picture[], walk: [] as number[], kinds: [] as Uint8Array[] };
      // The camera still at the eye over the border, the body half a metre short of it and then half a metre past it.
      aim(hw, BORDER, AT.z, 1.7, 224, 24);
      for (const x of [BORDER - 0.5, BORDER + 0.5]) {
        hw.stand(x, AT.z);
        frame(hw, shot, false);
        const p = frame(hw, shot, true);
        hand.frames.push(shot.frames.length - 1);
        hand.pics.push(picture(hw, p));
      }
      // Walking over it a metre a frame, the camera at the body's eye.
      for (const step of STEPS) {
        hw.stand(BORDER + step, AT.z);
        aim(hw, BORDER + step, AT.z, 1.7, 224, 24);
        frame(hw, shot, true);
        hand.walk.push(shot.frames.length - 1);
        hand.kinds.push(hw.raster.pickKind.slice());
      }
      made.hands.push(hand);
      shots.push(shot);
    }

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

    // Node pixels: where the rasterizer drew a node in either picture.
    const node = (kind: number): boolean => kind === PICK_FAR || kind === PICK_STRUCTURE;
    for (const h of made.hands) {
      const [before, after] = h.frames.map((f) => back.pixels(h.key, f));
      const walk = h.walk.map((f) => back.pixels(h.key, f));
      if (!before || !after || walk.some((p) => !p)) {
        lines.push(`${h.name}, the hand-over: NO PICTURE`);
        ok = false;
        continue;
      }
      // The camera still: what of the nodes' pixels the body's step over the border changed.
      let [n, changed] = [0, 0];
      for (let at = 0; at < W * H; at++) {
        if (!node(h.pics[0]!.kind[at]!) && !node(h.pics[1]!.kind[at]!)) continue;
        n++;
        if (off(before, after, at) > SAME) changed++;
      }
      // Walking: what of them each step changed, the step over the border the fourth.
      const steps = walk.slice(1).map((p, k) => {
        let moved = 0;
        for (let at = 0; at < W * H; at++) if ((node(h.kinds[k]![at]!) || node(h.kinds[k + 1]![at]!)) && off(walk[k]!, p!, at) > SAME) moved++;
        return moved;
      });
      const over = steps[3]!;
      const others = Math.max(...steps.filter((_, k) => k !== 3));
      // A chunk that pops changes most of what it shows, and changes it in the one step; the rest change by the camera's metre.
      const pass = h.control ? n > 2000 && changed > n * 0.25 && over > others * 1.5 : n > 2000 && changed <= n * MOST_OFF && over <= others * 1.25 + n * MOST_OFF;
      ok &&= pass;
      lines.push(`${h.name}: a chunk handed from far to near as the body steps over a border, the camera still at its eye: ${changed} of ${n} node pixels changed on the GPU by more than ${SAME}; walking over it a metre a frame, the step over the border changed ${over} and the most of the others ${others}${h.control ? ", the pop the check must see" : ""}  ${pass ? "ok" : "FAIL"}`);
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
      // Each hand-over: before the step, after it, where they differ by more than SAME in white, and before with far pixels tinted.
      const hands = made.hands.map((h) => {
        const [before, after] = h.frames.map((f) => back.pixels(h.key, f) ?? blank) as [Uint8Array, Uint8Array];
        const differ = new Uint8Array(W * H * 4).fill(255);
        for (let at = 0; at < W * H; at++) if (off(before, after, at) <= SAME) differ.fill(0, at * 4, at * 4 + 3);
        return [before, after, differ, tinted(before, h.pics[0]!.kind.map((k) => (k === PICK_FAR ? 1 : 0)))];
      });
      writeFileSync(join(folder, "f3-hand.png"), sheet(hands));
      writeFileSync(join(folder, "f3-step.png"), sheet(made.hands.map((h) => h.walk.slice(2, 6).map((f) => back.pixels(h.key, f) ?? blank))));
      lines.push(`pictures in ${folder}: f3-views.png (by row ${made.views.map((v) => v.name).join("; ")}; the rasterizer, the GPU with a plain sky, the GPU hazed), f3-walk.png (every 36 m of a walk east across the meadow into the wood, the GPU, and the same with far nodes tinted), f3-edge.png (trees at medium's reach unfaded and faded, rasterizer and GPU), f3-hand.png (by row ${made.hands.map((h) => h.name).join("; ")}: before the body's step over the border, after it, where they differ, and before with far pixels tinted), f3-step.png (the same rows, the walk's four steps about the border)`);
    }
    return { ok, lines };
  },
};
