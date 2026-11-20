// What a dense wood costs to draw, tree by tree, worked out on the CPU: Miami's own trees round a dense wood, drawn on
// high by the software rasterizer (tools/snap/raster.ts), every triangle and every pixel of the picture put to the tree
// it belongs to. It is how tree changes are judged before the GPU route (planning/workstreams/trees.md): run it before
// and after, and compare.
//
//   bun tools/bench/grove.ts [--place 1|2] [--spots -40,-20,0,20,40,80] [--headings 8] [--leaves half|solid]
//                            [--squeeze 0] [--cells 4] [--cover from,per,most] [--against before.json] [--out name]
//   bun tools/bench/grove.ts --sum file.json
//
// A place is a dense wood the tool finds on the map: the densest 3 by 3 chunks of broadleaf trees within 4 km of South
// Beach (1), or the densest more than 1.5 km from that one (2). Spots lie on the line from the wood's middle toward
// South Beach, metres past the point 80 m short of the middle; at each, the eye stands 1.7 m over the ground and turns
// through the headings. The budget is held at the squeeze given (0: off), so levels are as distance asks. Levels are
// chosen as on a 1920 by 1080 canvas and the picture is drawn at half that a side; pixel counts are given at 1080p.
//
// The art's textures are not on the rasterizer's card. Every map is a stand-in: `solid` (a leaf card hides all behind
// it) or `half` (each card a 4 by 4 checker of cut-out texels, about as see-through as foliage). The trees' own opaque
// crown meshes do most of the hiding either way. Each tree also gets the number of other crowns, from the map, that the
// line from the eye to its crown's middle passes through, which a cover grid's count can be judged against.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { decodeTexture } from "../../client/core/render/cpu-texture.ts";
import { DRAW_CUTOUT, DRAW_PULLED, DRAW_RANGED, DRAW_TEXTURED } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { mapHeightfield, mapNodes, parseMap } from "../../shared/world/mapfile.ts";
import { SIZE_UNITS, type NodeSource } from "../../shared/world/nodes.ts";
import { nodeWorld, type NodeWorld } from "../../tests/fixtures/nodeworld.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { PICK_STRUCTURE } from "../snap/raster.ts";

const ROOT = resolve(import.meta.dir, "../..");
const MAP = process.env.CITY_MAP ?? join(ROOT, "var/maps/miami.snmap");
const OUT = join(ROOT, "var/bench/grove");
const BEACH = [1180, 5682] as const;
/** Chunks a side round the station the tool's world holds, which covers high's near field from any spot. */
const SIDE = 12;
const EYE = 1.7;
const BANDS = [0, 10, 20, 30, 45, 60, 80, 110, 150, 200, 260];
/** Crowns between a tree and the sun, by the grid's count, at which the cast triangles are split. */
const SUN_BINS = [0, 2, 4, 6, 8, 12, 20];

/** A drawn tree: its kind, how far its foot is, its crown's level, its triangles, its pixels, and what stands in its way. */
export interface Tree {
  id: string;
  at: number;
  level: number;
  leaf: number;
  bark: number;
  px: number;
  /** Other crowns the line from the eye to its crown's middle passes through; -1 for what is not a tree. */
  crossed: number;
  /** Whether its crown's box is in the camera's view at all. */
  inView: boolean;
  /** Its 16 m cell, as x * 4096 + z in cells of the tool's world. */
  cell: number;
  /** The crowns in its way as the scene's grid counts them (client/core/render/cover.ts), where the grid was made; -1 if not. */
  grid: number;
  /** Its node, chunk * 65536 + slot, the same from run to run. */
  key: number;
}

/** A crown as the map places it: a disc round the trunk from a third of the tree's height to its top. */
interface Crown {
  key: number;
  x: number;
  z: number;
  r: number;
  base: number;
  top: number;
}

/** The densest 3 by 3 chunks of broadleaf trees: within 4 km of South Beach, or more than 1.5 km from `away`. */
function densest(nodes: NodeSource, dims: { chunksX: number; chunksZ: number }, defs: readonly ({ id: string } | null)[], away: readonly [number, number] | null): [number, number] {
  const broad = /^core:(oak|fig|banyan|tree)$/;
  const count = new Uint16Array(dims.chunksX * dims.chunksZ);
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  for (let c = 0; c < count.length; c++) {
    for (let i = 0; i < nodes.perChunk; i++) {
      nodes.at(c, i, spot);
      if (spot.kind && broad.test(defs[spot.kind]?.id ?? "")) count[c]!++;
    }
  }
  let best: [number, number] = [0, 0], most = -1;
  for (let cz = 1; cz + 1 < dims.chunksZ; cz++) {
    for (let cx = 1; cx + 1 < dims.chunksX; cx++) {
      const [x, z] = [(cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE];
      if (away ? Math.hypot(x - away[0], z - away[1]) < 1500 : Math.hypot(x - BEACH[0], z - BEACH[1]) > 4000) continue;
      let n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) n += count[(cz + j) * dims.chunksX + cx + i]!;
      if (n > most) [best, most] = [[x, z], n];
    }
  }
  console.error(`a wood at ${best[0]}, ${best[1]}: ${most} broadleaf trees in 3 by 3 chunks`);
  return best;
}

export interface Options {
  place: number;
  spots: number[];
  headings: number;
  leaves: "half" | "solid";
  squeeze: number;
  cells: number;
  /** The hour of the day, for the sun's height. */
  hour: number;
  /** Cells of trees behind this many crowns or more drawn as if farther (Tier.nodes.cover); none if not given. */
  cover?: { from: number; per: number; most: number };
  /** A change to the world before it is drawn: what a phase turns on, for a before and after. */
  setup?: (w: NodeWorld) => void;
}

/** Every view of the walk, and its trees. */
export function walk(o: Options): { middle: [number, number]; rows: { cast: number; castBySun: number[]; buildMs: number; steppedMs: number; spot: number; heading: number; frame: number; far: number; treePx: number; pixels: number; draws: number; trees: Tree[] }[] } {
  const map = parseMap(new Uint8Array(readFileSync(MAP)), false);
  const reg = compileContent(CORE_CONTENT).registry!;
  const mhf = mapHeightfield(map);
  const nodes = mapNodes(map, mhf, reg)!;
  const first = densest(nodes, map.dims, reg.defs, null);
  const middle = o.place === 2 ? densest(nodes, map.dims, reg.defs, first) : first;
  const toward = Math.hypot(BEACH[0] - middle[0], BEACH[1] - middle[1]);
  const [ux, uz] = [(middle[0] - BEACH[0]) / toward, (middle[1] - BEACH[1]) / toward];
  const [ex, ez] = [middle[0] - ux * 80, middle[1] - uz * 80];
  const ox = Math.floor(ex / CHUNK_SIZE) - SIDE / 2, oz = Math.floor(ez / CHUNK_SIZE) - SIDE / 2;
  const w = nodeWorld({
    chunksX: SIDE, chunksZ: SIDE, kinds: ["core:oak"], pack: corePack(), tier: tierOf("high"), width: 960, height: 540,
    ground: (x, z) => mhf.heightAt(x + ox * CHUNK_SIZE, z + oz * CHUNK_SIZE),
    place: () => ({
      perChunk: nodes.perChunk,
      at(chunk, i, out) {
        nodes.at((Math.floor(chunk / SIDE) + oz) * map.dims.chunksX + (chunk % SIDE) + ox, i, out);
        out.x -= ox * CHUNK_SIZE;
        out.z -= oz * CHUNK_SIZE;
      },
    }),
  });
  const scene = w.scene;
  scene.chunkCells = o.cells;
  scene.hour = o.hour;
  // Stand-in maps on the rasterizer's card, pictures smallest first as mips are.
  const picture = (side: number): Uint8Array => {
    const texels: number[] = [];
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) texels.push(110, 140, 90, o.leaves === "solid" ? 255 : side === 1 ? 128 : (i + j) % 2 === 0 ? 255 : 0);
    return new Uint8Array(texels);
  };
  const stand = decodeTexture("base", [picture(1), picture(2), picture(4)]);
  const held = (w.raster as unknown as { textures: Map<number, unknown> }).textures;
  const got = held.get.bind(held);
  held.get = (k: number) => got(k) ?? stand;
  // Every level drawn with its materials, as on a desktop holding the wood's textures.
  const sections = scene.assets.table.sections;
  (scene.assets as unknown as { textured: (mesh: number, level: number) => boolean }).textured = (mesh, level) => (sections[mesh]![level]?.length ?? 0) > 0;
  scene.viewHeight = 1080;
  scene.budget.on = o.squeeze !== 0;
  scene.budget.held = true;
  scene.budget.squeeze = o.squeeze;
  if (o.cover) scene.assets.tier = { ...scene.assets.tier, nodes: { ...scene.assets.tier.nodes, cover: o.cover } };
  o.setup?.(w);
  const table = scene.assets.table, tris = table.tris;

  // Every crown in the tool's world, and the drawn trees' own.
  const crowns: Crown[] = [];
  const byKey = new Map<number, Crown>();
  const meshOfForm = (scene as unknown as { meshOfForm: Uint16Array }).meshOfForm;
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  for (let chunk = 0; chunk < SIDE * SIDE; chunk++) {
    for (let slot = 0; slot < w.source.perChunk; slot++) {
      w.source.at(chunk, slot, spot);
      const def = reg.defs[spot.kind] as { type?: string; material?: string } | undefined;
      if (!def || def.type !== "node" || def.material !== "wood") continue;
      const mesh = meshOfForm[spot.form]!, k = w.field.forms.size[spot.form]! / SIZE_UNITS;
      if (mesh >= table.count) continue;
      const height = (table.high[mesh]! - Math.max(0, table.low[mesh]!)) * k;
      const c = { key: chunk * 65536 + slot, x: spot.x, z: spot.z, r: (table.side[mesh]! / Math.SQRT2) * k, base: spot.y + height / 3, top: spot.y + height };
      crowns.push(c);
      byKey.set(c.key, c);
    }
  }
  const crossed = (ex: number, ey: number, ez: number, target: Crown): number => {
    const [dx, dy, dz] = [target.x - ex, (target.base + target.top) / 2 - ey, target.z - ez];
    const len2 = dx * dx + dz * dz;
    let n = 0;
    for (const c of crowns) {
      if (c === target) continue;
      const s = Math.max(0, Math.min(1, ((c.x - ex) * dx + (c.z - ez) * dz) / len2));
      const [px, pz] = [ex + dx * s - c.x, ez + dz * s - c.z];
      if (px * px + pz * pz > c.r * c.r) continue;
      const h = ey + dy * s;
      if (h >= c.base && h <= c.top && s > 0.02 && s < 0.98) n++;
    }
    return n;
  };

  const rows: ReturnType<typeof walk>["rows"] = [];
  for (const step of o.spots) {
    const [sx, sz] = [ex + ux * step - ox * CHUNK_SIZE, ez + uz * step - oz * CHUNK_SIZE];
    w.stand(sx, sz);
    const eye = w.hf.heightAt(sx, sz) + EYE;
    // Settled at the spot first, as a player who walked there would be, past any change of level still fading.
    w.look(sx, eye, sz, 0, 0);
    // The last 20 timed: the scene's frame build alone, the rasterizer apart, once the spot's changes are in.
    let built = 0;
    for (let f = 0; f < 30; f++) {
      const t0 = performance.now();
      // The rasterizer takes what each frame uploads, but draws nothing of these.
      const p = w.frame(false), [draws, casters, tiles] = [p.drawCount, p.casterCount, p.tileCount];
      if (f >= 10) built += performance.now() - t0;
      [p.drawCount, p.casterCount, p.tileCount] = [0, 0, 0];
      w.raster.render(p);
      [p.drawCount, p.casterCount, p.tileCount] = [draws, casters, tiles];
    }
    // A frame after the eye moves a step, which counts every cell in view again (Scene.coverCells).
    w.look(sx + 1.5, eye, sz, 0, 0);
    const t0 = performance.now();
    const step1 = w.frame(false);
    const stepped = performance.now() - t0;
    [step1.drawCount, step1.casterCount, step1.tileCount] = [0, 0, 0];
    w.raster.render(step1);
    for (let k = 0; k < o.headings; k++) {
      const heading = (k / o.headings) * Math.PI * 2;
      w.look(sx, eye, sz, heading, 0);
      w.frame(true);
      const p = w.frame(true);
      const trees = new Map<number, Tree>();
      let far = 0;
      for (let d = 0; d < p.drawCount; d++) {
        const buffer = p.drawBuffer[d]!, flags = p.drawFlags[d]!, n = p.drawInstances[d]!;
        const each = (flags & (DRAW_TEXTURED | DRAW_RANGED | DRAW_PULLED)) !== 0 ? p.drawIndexCount[d]! / 3 : tris[p.drawMesh[d]!]![p.drawLod[d]!]!;
        if ((flags & DRAW_PULLED) !== 0) far += each * n;
        if (buffer < NODE_BUFFERS || buffer >= NODE_BUFFERS * 2) continue;
        const card = w.card.get(buffer)!, view = new DataView(card.data.buffer, card.data.byteOffset);
        for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + n; i++) {
          const chunk = buffer - NODE_BUFFERS, slot = card.slots[i]!, key = chunk * 65536 + slot;
          let t = trees.get(key);
          if (!t) {
            const at0 = i * INSTANCE_BYTES;
            const at = Math.hypot(view.getFloat32(at0, true) + p.drawOffset[d * 3]!, view.getFloat32(at0 + 4, true) + p.drawOffset[d * 3 + 1]!, view.getFloat32(at0 + 8, true) + p.drawOffset[d * 3 + 2]!);
            const own = byKey.get(key);
            const inView = own ? w.cam.boxVisible(own.x - own.r - sx, own.base - (own.top - own.base) / 2 - eye, own.z - own.r - sz, own.x + own.r - sx, own.top - eye, own.z + own.r - sz) : true;
            t = { key, id: reg.defs[w.field.kindAt(chunk, slot)]?.id ?? "?", at, level: 0, leaf: 0, bark: 0, px: 0, crossed: own ? crossed(sx, eye, sz, own) : -1, grid: own && scene.cover.crowns > 0 ? scene.cover.count(sx, eye, sz, own.x, (own.base + own.top) / 2, own.z, own.r) : -1, inView, cell: own ? Math.floor(own.x / 16) * 4096 + Math.floor(own.z / 16) : -1 };
            trees.set(key, t);
          }
          if ((flags & DRAW_CUTOUT) !== 0) t.leaf += each;
          else t.bark += each;
          // A cell changing level draws its old level too, fading out (packet.ts drawSwap): its level is the new one.
          if (p.drawSwap[d]! >= 0) t.level = Math.max(t.level, p.drawLod[d]!);
        }
      }
      const { pickKind, pickId } = w.raster;
      let treePx = 0;
      for (let i = 0; i < pickKind.length; i++) {
        if (pickKind[i] !== PICK_STRUCTURE) continue;
        const id = pickId[i]!, buffer = Math.floor(id / 65536);
        if (buffer < NODE_BUFFERS || buffer >= NODE_BUFFERS * 2) continue;
        const t = trees.get((buffer - NODE_BUFFERS) * 65536 + (id % 65536));
        if (t) (t.px++, treePx++);
      }
      // What the trees cast into the sun's maps, each tree's into every map it reaches, by how many crowns stand between it
      // and the sun (from 300 m toward the sun down to its crown's middle, its own left out), where the grid is made.
      const sun = (scene as unknown as { sunAt: Float64Array }).sunAt;
      const castBySun = SUN_BINS.map(() => 0);
      let cast = 0;
      for (let e = 0; e < p.casterCount; e++) {
        const buffer = p.casterBuffer[e]!, flags = p.casterFlags[e]!, n = p.casterInstances[e]!, c = p.casterCascades[e]!;
        const maps = (c & 1) + ((c >> 1) & 1) + ((c >> 2) & 1) + ((c >> 3) & 1);
        const each = ((flags & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? p.casterIndexCount[e]! / 3 : tris[p.casterMesh[e]!]![p.casterLod[e]!]!) * maps;
        if (buffer < NODE_BUFFERS || buffer >= NODE_BUFFERS * 2) continue;
        const card = w.card.get(buffer);
        if (!card) continue;
        for (let i = p.casterFirst[e]!; i < p.casterFirst[e]! + n; i++) {
          const own = byKey.get((buffer - NODE_BUFFERS) * 65536 + card.slots[i]!);
          cast += each;
          if (!own || scene.cover.crowns === 0) continue;
          const y = (own.base + own.top) / 2;
          const count = scene.cover.count(own.x + sun[0]! * 300, y + sun[1]! * 300, own.z + sun[2]! * 300, own.x, y, own.z, own.r);
          castBySun[SUN_BINS.findLastIndex((b) => count >= b)]! += each;
        }
      }
      rows.push({ cast, castBySun, buildMs: built / 20, steppedMs: stepped, spot: step, heading: Math.round((heading * 180) / Math.PI), frame: p.triangles, far, treePx, pixels: pickKind.length, draws: p.drawCount, trees: [...trees.values()] });
    }
  }
  return { middle, rows };
}

/** The walk's numbers in lines: where its triangles go and what they show, a heading's mean. */
export function summary(g: ReturnType<typeof walk>): string[] {
  const out: string[] = [];
  const H = g.rows.length, PX = 4;
  const all = g.rows.flatMap((r) => r.trees);
  const tri = (t: Tree): number => t.leaf + t.bark;
  const sum = <T>(list: readonly T[], f: (t: T) => number): number => list.reduce((s, t) => s + f(t), 0);
  const m = (n: number): string => (n / H / 1e6).toFixed(2);
  const T = sum(all, tri), P = sum(all, (t) => t.px);
  const pct = (n: number, of: number): string => `${((100 * n) / Math.max(1, of)).toFixed(0)}%`;
  const wood = all.filter((t) => t.crossed >= 0);
  const off = wood.filter((t) => !t.inView), hidden = wood.filter((t) => t.inView && t.px === 0), shown = wood.filter((t) => t.px > 0);
  const W = sum(wood, tri);
  out.push(`${H} views: a view ${m(sum(g.rows, (r) => r.frame))} M triangles, near trees ${m(T)} M (leaves ${m(sum(all, (t) => t.leaf))} M), far trees ${m(sum(g.rows, (r) => r.far))} M, ${(all.length / H).toFixed(0)} near trees, ${(sum(g.rows, (r) => r.draws) / H).toFixed(0)} draws; trees cover ${pct(sum(g.rows, (r) => r.treePx), sum(g.rows, (r) => r.pixels))} of the picture`);
  out.push(`the scene builds a frame in ${(sum(g.rows, (r) => r.buildMs ?? 0) / H).toFixed(2)} ms on this machine, ${(sum(g.rows, (r) => r.steppedMs ?? 0) / H).toFixed(2)} ms after the eye moves a step`);
  out.push(`trees (wood kinds) ${m(W)} M: shown ${pct(sum(shown, tri), W)}, in view but hidden ${pct(sum(hidden, tri), W)}, off screen ${pct(sum(off, tri), W)}`);
  const castAll = sum(g.rows, (r) => r.cast ?? 0);
  if (castAll > 0) {
    out.push(`trees cast ${m(castAll)} M triangles a view into the sun's maps; by crowns between the tree and the sun (the grid's count): ` + SUN_BINS.map((b, k) => `${b}+ ${pct(sum(g.rows, (r) => r.castBySun?.[k] ?? 0), castAll)}`).join(", "));
  }
  out.push("", "band         trees  shown  tris M  hidden tris  px (1080p) k  tris a px");
  for (let b = 0; b + 1 < BANDS.length; b++) {
    const ts = all.filter((t) => t.at >= BANDS[b]! && t.at < BANDS[b + 1]!);
    if (ts.length === 0) continue;
    const tr = sum(ts, tri), px = sum(ts, (t) => t.px) * PX;
    out.push(`${`${BANDS[b]}-${BANDS[b + 1]} m`.padEnd(12)} ${(ts.length / H).toFixed(0).padStart(5)}  ${(ts.filter((t) => t.px > 0).length / H).toFixed(0).padStart(5)}  ${m(tr).padStart(6)}  ${pct(sum(ts.filter((t) => t.px === 0), tri), tr).padStart(11)}  ${(px / H / 1e3).toFixed(0).padStart(12)}  ${(tr / Math.max(1, px)).toFixed(1).padStart(9)}`);
  }
  out.push("", "level  trees  tris M  share  tris a tree k");
  for (let l = 0; l < 8; l++) {
    const ts = all.filter((t) => t.level === l);
    if (ts.length) out.push(`${String(l).padStart(5)}  ${(ts.length / H).toFixed(0).padStart(5)}  ${m(sum(ts, tri)).padStart(6)}  ${pct(sum(ts, tri), T).padStart(5)}  ${(sum(ts, tri) / ts.length / 1e3).toFixed(1).padStart(12)}`);
  }
  // By cell, as the engine chooses levels: the fewest crowns in the way of any tree of the cell in view.
  const cells: { tris: number; px: number; crossed: number }[] = [];
  for (const r of g.rows) {
    const by = new Map<number, Tree[]>();
    for (const t of r.trees) if (t.crossed >= 0) by.set(t.cell, [...(by.get(t.cell) ?? []), t]);
    for (const ts of by.values()) cells.push({ tris: sum(ts, tri), px: sum(ts, (t) => t.px), crossed: Math.min(...ts.filter((t) => t.inView).map((t) => t.crossed), 1e9) });
  }
  out.push("", `cells of trees: ${(cells.length / H).toFixed(0)} a view; none of whose trees shows: ${pct(sum(cells.filter((c) => c.px === 0), (c) => c.tris), W)} of the trees' triangles`);
  out.push("crowns in the way, at least  cells a view  triangles  tree pixels");
  for (const n of [3, 5, 8, 10, 15]) {
    const cs = cells.filter((c) => c.crossed >= n);
    out.push(`${String(n).padStart(27)}  ${(cs.length / H).toFixed(0).padStart(12)}  ${pct(sum(cs, (c) => c.tris), W).padStart(9)}  ${((100 * sum(cs, (c) => c.px)) / Math.max(1, P)).toFixed(2).padStart(10)}%`);
  }
  return out;
}

/**
 * A run against one before it of the same walk: the trees' triangles saved, and of the tree pixels before, the share
 * that were trees now drawn at coarser levels, and those now drawn finer.
 */
export function against(before: ReturnType<typeof walk>, now: ReturnType<typeof walk>): string[] {
  const tri = (t: Tree): number => t.leaf + t.bark;
  let [was, is, px, coarser, finer, trees, moved, lost] = [0, 0, 0, 0, 0, 0, 0, 0];
  before.rows.forEach((r, k) => {
    const then = new Map(now.rows[k]!.trees.map((t) => [t.key, t]));
    was += r.trees.reduce((s, t) => s + tri(t), 0);
    is += now.rows[k]!.trees.reduce((s, t) => s + tri(t), 0);
    for (const t of r.trees) {
      const n = then.get(t.key);
      px += t.px;
      trees++;
      if (!n) {
        lost += t.px;
        continue;
      }
      if (n.level > t.level) (coarser += t.px, moved++);
      if (n.level < t.level) finer += t.px;
    }
  });
  const H = before.rows.length;
  return [
    `near trees ${(was / H / 1e6).toFixed(2)} M a view before, ${(is / H / 1e6).toFixed(2)} M now: ${((100 * (was - is)) / was).toFixed(0)}% fewer`,
    `${((100 * moved) / trees).toFixed(0)}% of the trees drawn coarser, showing ${((100 * coarser) / px).toFixed(2)}% of the trees' pixels before; ${((100 * finer) / px).toFixed(2)}% drawn finer; ${((100 * lost) / px).toFixed(3)}% on trees no longer drawn`,
  ];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  if (value("--sum")) console.log(summary(JSON.parse(readFileSync(value("--sum")!, "utf8"))).join("\n"));
  else {
    const o: Options = {
      place: Number(value("--place") ?? 1),
      spots: (value("--spots") ?? "-40,-20,0,20,40,80").split(",").map(Number),
      headings: Number(value("--headings") ?? 8),
      leaves: value("--leaves") === "solid" ? "solid" : "half",
      squeeze: Number(value("--squeeze") ?? 0),
      cells: Number(value("--cells") ?? 4),
      hour: Number(value("--hour") ?? 12),
      ...(value("--cover") ? { cover: ((c) => ({ from: c[0]!, per: c[1]!, most: c[2]! }))(value("--cover")!.split(",").map(Number)) } : {}),
    };
    const g = walk(o);
    mkdirSync(OUT, { recursive: true });
    const file = join(OUT, `${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}-place${o.place}${value("--out") ? `-${value("--out")}` : ""}.json`);
    writeFileSync(file, JSON.stringify(g));
    console.log(summary(g).join("\n"));
    if (value("--against")) console.log(["", ...against(JSON.parse(readFileSync(value("--against")!, "utf8")), g)].join("\n"));
    console.log(`kept in ${file}`);
  }
}
