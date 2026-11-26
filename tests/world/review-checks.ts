// What a page holds of its map against the map read whole, and against a page that took the same parts in order
// (tests/world/review-*.test.ts).

import { MapLoader, StagedMap } from "../../client/core/mapload.ts";
import { HeldStatics } from "../../client/core/map-statics.ts";
import { SECTOR_CHUNKS } from "../../shared/coords.ts";
import type { CityStatics } from "../../shared/world/city.ts";
import { mapHeightfield, parseMap, readHead, readPart, squareOf, type MapPart, type MapPiece, type StaticsPiece, type TopsPiece } from "../../shared/world/mapfile.ts";
import { denseOf, nodesOf } from "../fixtures/paged-ground.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { PER, inside } from "./review-rig.ts";

const finish = <T>(steps: Generator<void, T>): T => {
  for (let s = steps.next(); ; s = steps.next()) if (s.done) return s.value;
};

/** The checks of a page of the map `file`. */
export function checksOf(file: Uint8Array) {
  const whole = parseMap(file);
  const head = readHead(file);
  const reg = coreRegistry();
  const wholeHf = mapHeightfield(whole);
  const pieceOf = (p: MapPart): MapPiece => readPart(head, p, file.subarray(p.at, p.at + p.length));
  const sectorOf = (p: MapPart) => squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;

  /** The rows the map holds in `chunk`, as text. */
  function mapRows(chunk: number): string {
    const s = whole.statics;
    const out: string[] = [];
    for (let r = s.first[chunk]!; r < s.first[chunk + 1]!; r++) out.push(`${s.kinds[s.kind[r]!]} ${s.yaw[r]} ${s.x[r]} ${s.y[r]} ${s.z[r]}`);
    return out.join("|");
  }

  /** The rows a store of statics holds in `chunk`, as text, or null where its sector is not held. */
  function heldRows(held: HeldStatics, chunk: number): string | null {
    const r = held.find(chunk);
    if (!r) return null;
    const out: string[] = [];
    for (let k = r.from; k < r.to; k++) out.push(`${held.kinds[r.kind[k]!]} ${r.yaw[k]} ${r.x[k]} ${r.y[k]} ${r.z[k]}`);
    return out.join("|");
  }

  /** The rows a city holds in `chunk`, as text with content kinds' ids, or null where none holds them. */
  function cityRows(city: CityStatics, chunk: number): string | null {
    const t = city.rows(chunk);
    if (!t) return null;
    const out: string[] = [];
    for (let k = t.from(chunk); k < t.to(chunk); k++) out.push(`${reg.defs[t.kind[k]!]!.id} ${t.yaw[k]} ${t.x[k]} ${t.y[k]} ${t.z[k]}`);
    return out.join("|");
  }

  /** Every chunk's bound holds every sample it reads, its edges among them. */
  function boundsWrong(staged: StagedMap): number {
    const hf = staged.hf, b = hf.bounds!, { chunksX, chunksZ } = head.dims;
    const all = hf.window(0, 0, hf.nx - 1, hf.nz - 1);
    let wrong = 0;
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        let lo = 65535, hi = 0;
        for (let j = cz * PER; j <= cz * PER + PER; j++) {
          for (let i = cx * PER; i <= cx * PER + PER; i++) {
            const q = all[j * hf.nx + i]!;
            if (q < lo) lo = q;
            if (q > hi) hi = q;
          }
        }
        const c = cz * chunksX + cx;
        if (lo < b[c * 2]! || hi > b[c * 2 + 1]!) wrong++;
      }
    }
    return wrong;
  }

  /** A page that took in order just the parts `loader` holds: what it should hold now, however they came and went. */
  function reference(loader: MapLoader): { staged: StagedMap; held: HeldStatics; city: CityStatics } {
    const staged = new StagedMap(head), held = new HeldStatics(head), city = held.follow(reg);
    const li = inside(loader), parts = loader.staged.head.parts;
    // Its own parts by name: a page's head is its own reading of the file.
    const mine = new Map(held.parts.map((p) => [p.name, p]));
    for (const p of parts) if (p.kind === "overview" && loader.staged.overviews.at(p.col, p.row)) staged.take(pieceOf(p));
    for (const p of parts) if (p.kind === "ground" && loader.staged.hf.holds(sectorOf(p))) staged.take(pieceOf(p));
    for (const p of parts) if (p.kind === "tops" && li.came.has(p)) staged.take(pieceOf(p));
    for (const p of parts) if (p.kind === "statics" && loader.held.has(p)) finish(held.set(mine.get(p.name)!, pieceOf(p) as StaticsPiece));
    return { staged, held, city };
  }

  /** How the two differ, a line each. */
  function compare(loader: MapLoader, city: CityStatics, ref: ReturnType<typeof reference>): string[] {
    const wrong: string[] = [];
    const a = denseOf(loader.staged.hf), b = denseOf(ref.staged.hf);
    const count = (x: ArrayLike<number>, y: ArrayLike<number>): number => {
      let n = 0;
      for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) n++;
      return n + Math.abs(x.length - y.length);
    };
    for (const col of ["heights", "tint", "ground"] as const) {
      const n = count(a[col], b[col]);
      if (n > 0) wrong.push(`${n} ${col} differ from a page that took the same parts in order`);
    }
    // Where a chunk is the map's own, its samples are the map's.
    const hf = loader.staged.hf, { chunksX, chunksZ } = head.dims;
    let own = 0, exact = 0;
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        if (hf.exact[cz * chunksX + cx] === 0) continue;
        exact++;
        for (let j = cz * PER; j <= cz * PER + PER; j++) for (let i = cx * PER; i <= cx * PER + PER; i++) if (a.heights[j * hf.nx + i] !== wholeHf.heights[j * hf.nx + i] || a.tint[j * hf.nx + i] !== wholeHf.tint[j * hf.nx + i]) own++;
      }
    }
    if (own > 0) wrong.push(`${own} samples of chunks said to be the map's own are not the map's`);
    if (count(hf.exact, ref.staged.hf.exact) > 0) wrong.push("the chunks said to be the map's own differ");
    if (hf.count * 1 !== ref.staged.hf.count || hf.bytes !== ref.staged.hf.bytes) wrong.push(`pages counted ${hf.count} of ${hf.bytes} bytes, in order ${ref.staged.hf.count} of ${ref.staged.hf.bytes}`);
    const bw = boundsWrong(loader.staged);
    if (bw > 0) wrong.push(`${bw} chunks' bounds do not hold their samples`);
    const [wa, wb] = [hf.water!, ref.staged.hf.water!];
    if (count(wa.squares, wb.squares) > 0 || count(wa.chunks(), wb.chunks()) > 0) wrong.push("the water differs");
    const [na, nb] = [nodesOf(hf, reg, loader.staged.nodes), nodesOf(ref.staged.hf, reg, ref.staged.nodes)];
    if (na.length !== nb.length || na.some((s, k) => s !== nb[k])) wrong.push(`the nodes differ: ${na.length} and ${nb.length}`);
    let tops = 0, rows = 0, mine = 0, cityWrong = 0;
    for (let c = 0; c < chunksX * chunksZ; c++) {
      const [ta, tb] = [loader.staged.tops.top(c), ref.staged.tops.top(c)];
      if ((ta === null) !== (tb === null) || (ta && tb && count(ta, tb) > 0)) tops++;
      const r = heldRows(loader.held, c);
      if (r !== heldRows(ref.held, c)) rows++;
      if (r !== null && r !== mapRows(c)) mine++;
      if (cityRows(city, c) !== cityRows(ref.city, c)) cityWrong++;
    }
    if (tops > 0) wrong.push(`${tops} chunks' tops differ`);
    if (rows > 0) wrong.push(`${rows} chunks' statics differ from a page that took the same sectors`);
    if (mine > 0) wrong.push(`${mine} chunks' statics held are not the map's`);
    if (cityWrong > 0) wrong.push(`${cityWrong} chunks' city rows differ`);
    if (loader.held.bytes !== ref.held.bytes) wrong.push(`statics counted ${loader.held.bytes} bytes, in order ${ref.held.bytes}`);
    if (exact === 0) wrong.push("no chunk is the map's own");
    return wrong;
  }

  /** What the loader's books say against what it holds. */
  function books(loader: MapLoader): string[] {
    const wrong: string[] = [];
    const li = inside(loader);
    for (const p of loader.staged.head.parts) {
      const came = li.came.has(p);
      if (p.kind === "statics" && came !== loader.held.has(p)) wrong.push(`statics ${p.col},${p.row}: its book says ${came}, the store ${loader.held.has(p)}`);
      if (p.kind === "ground") {
        const sq = sectorOf(p), has = loader.staged.hf.holds(sq) || loader.staged.waits(sq);
        if (came !== has) wrong.push(`ground ${p.col},${p.row}: its book says ${came}, the pages ${has}`);
      }
      if (p.kind === "overview") {
        const b = loader.staged.overviews.at(p.col, p.row);
        const full = b !== null && b.from === b.sq.cz0 && b.to === b.sq.cz1 && b.nodes;
        if (came !== full) wrong.push(`overview ${p.col},${p.row}: its book says ${came}, its block ${b ? `${b.from}..${b.to} of ${b.sq.cz0}..${b.sq.cz1}, nodes ${b.nodes}` : "none"}`);
      }
      if (p.kind === "tops") {
        const piece = pieceOf(p) as TopsPiece;
        const has = Array.from(piece.chunks).some((c) => loader.staged.tops.top(c) !== null);
        if (piece.chunks.length > 0 && came !== has) wrong.push(`tops ${p.col},${p.row}: its book says ${came}, the tops ${has}`);
      }
    }
    return wrong;
  }
  return { whole, head, reg, wholeHf, pieceOf, sectorOf, mapRows, heldRows, cityRows, boundsWrong, reference, compare, books };
}
