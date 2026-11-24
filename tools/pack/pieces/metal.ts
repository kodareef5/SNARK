// The metal tier's recipe: steel panels bolted side by side. Each piece is a frame of heavy bevelled section round
// recessed plate, stiffened by ribs on a 0.75 m grid, with gusset plates in its corners and square nuts where members
// meet. Floors are deck plate on beams, the foundation a raft with a channel round it on footings, the pillar a box
// section between base and cap plates, the door a framed leaf with strap hinges and a sight slot.
//
// It has no pictures. Every level is flat: the plate's faces are colour region 0, the instance's colour, which wears
// the "plate" material where the card makes recipes (content/texgen/materials.ts) and is the tier's steel grey where it
// does not; frame, bolts and nosings are fixed palette colours, so the piece is two-toned steel on every client. The
// material's sheets are 0.75 m square with rivets inside their edges, the grid the ribs stand on.
//
// Levels: 0 is everything; 1 has no nuts and no small fittings; 2 is the frame as plain boxes; then plain solids. It
// works in the frame the other tiers do: x along the piece, z up, the front at -y.

import { REGION_BASE, defaultPalette, nearestColour } from "../../../shared/pack/palette.ts";
import { HALF_SIDE_M, outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import type { SourceLod, SourceMesh } from "../write.ts";
import { Shape, add, cross, flatLod, scale, unit, type FaceMap, type Vec } from "./kit.ts";
import { errorOf, levelsOf, type TierRecipe } from "./lod.ts";

const H = HALF_SIDE_M;
const FACE = 0.1; // a frame member's face: the wall's own
const SKIN = 0.06; // the plate's face
const RIB = 0.085; // a stiffener's face
const GUSSET = 0.075;
const POST = 0.1; // an end post's width, which is the band a wall's end yields by
const SILL = 0.2;
const HEAD = 0.14;
const BEVEL = 0.03;
const GRID = 0.75; // the ribs' spacing, and the material's sheets'
const NUT = 0.019; // half a nut across its flats
const PROUD = 0.012; // a nut stands this far off its member
const DECK = 0.04; // a floor's plate
const FLOOR = 0.25; // a floor's depth, which a pillar's head stands under
type Cell = readonly [number, number];
type Mat = "plate" | "frame" | "bolt" | "dark" | "nosing";

/** A face of one material; a flat level's faces have no texture coordinates. */
const tone = (mat: Mat): FaceMap => () => [mat, () => [0, 0]];
/** `top` on the faces that look up, `under` on those that look down, `side` on the rest. */
const slab = (top: Mat, side: Mat, under: Mat = side): FaceMap => (label) => [label === "+z" ? top : label === "-z" ? under : side, () => [0, 0]];

/** A square nut on a face at `centre`, standing out along `normal`, turned by where it is so no two sit alike. */
function nut(p: Shape, centre: Vec, normal: Vec, half = NUT, out = PROUD): void {
  const n = unit(normal);
  const a0 = unit(Math.abs(n[2]) < 0.9 ? cross([0, 0, 1], n) : [1, 0, 0]), b0 = cross(n, a0);
  const turn = ((Math.abs(Math.round(centre[0] * 977 + centre[1] * 613 + centre[2] * 331)) % 5) - 2) * 0.11;
  const a = add(scale(a0, Math.cos(turn)), scale(b0, Math.sin(turn))), b = cross(n, a);
  const ring = (lift: number, k: number): Vec[] => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([s, t]) => add(add(centre, scale(n, lift)), add(scale(a, s! * half * k), scale(b, t! * half * k))));
  p.loft([ring(-0.004, 1), ring(out, 0.86)], () => ["bolt", [0, 0]], () => ["bolt", [0, 0]]);
}

/** Nuts at (x, z) points on both faces of a wall, on a member whose faces are at ±`face`. */
function nuts(p: Shape, points: readonly Cell[], face: number): void {
  for (const [x, z] of points) for (const s of [-1, 1]) nut(p, [x, s * face, z], [0, s, 0]);
}

/**
 * A member along x from x0 to x1, from z0 to z1, its faces at ±`face`: bevelled toward the plate on its upper edges
 * ("up", a sill), its lower ("down", a head) or both (a rib, which stands through the plate).
 */
function rail(p: Shape, x0: number, x1: number, z0: number, z1: number, bevel: "up" | "down" | "both" | "none", face = FACE, mat: Mat = "frame"): void {
  // A bevel runs from the member's face down to the plate's, steeper than it is wide: two at a corner then cross and never lie in one plane.
  const [b, f, d] = [BEVEL, face, face - SKIN];
  const lower: Cell[] = bevel === "down" || bevel === "both" ? [[-f, z0 + b], [-(f - d), z0], [f - d, z0], [f, z0 + b]] : [[-f, z0], [f, z0]];
  const upper: Cell[] = bevel === "up" || bevel === "both" ? [[f, z1 - b], [f - d, z1], [-(f - d), z1], [-f, z1 - b]] : [[f, z1], [-f, z1]];
  p.extrude([...lower, ...upper], "x", x0, x1, tone(mat));
}

/** An upright member from z0 to z1 between x0 and x1: bevelled toward the plate on its edge at x0 ("low"), x1 ("high") or both. */
function stile(p: Shape, x0: number, x1: number, z0: number, z1: number, bevel: "low" | "high" | "both" | "none", face = FACE, mat: Mat = "frame"): void {
  const [b, f, d] = [BEVEL, face, face - SKIN];
  const low: Cell[] = bevel === "low" || bevel === "both" ? [[x0 + b, -f], [x0, -(f - d)], [x0, f - d], [x0 + b, f]] : [[x0, -f], [x0, f]];
  const high: Cell[] = bevel === "high" || bevel === "both" ? [[x1 - b, f], [x1, f - d], [x1, -(f - d)], [x1 - b, -f]] : [[x1, f], [x1, -f]];
  p.extrude([...low, ...high], "z", z0, z1, tone(mat));
}

/** A triangular plate through the wall in the corner (x, z) of its frame, its legs `leg` long toward (sx, sz), with three nuts a face. */
function gusset(p: Shape, level: number, x: number, z: number, sx: number, sz: number, leg = 0.26): void {
  p.extrude([[z, x], [z + sz * leg, x], [z, x + sx * leg]], "y", -GUSSET, GUSSET, tone("frame"));
  if (level === 0) nuts(p, [[x + sx * 0.06, z + sz * 0.06], [x + sx * 0.16, z + sz * 0.05], [x + sx * 0.05, z + sz * 0.16]], GUSSET);
}

/** A wall-family form about its collider's origin: half its width, its foot and top. */
interface Frame {
  hx: number;
  foot: number;
  top: number;
}

function frameOf(form: FormDef): Frame {
  const [u0, v0, u1, v1] = outlineBox(form);
  if (form.outline.length !== 4 || Math.abs(u0 + u1 - 2 * form.at[0]) > 1e-9) throw new Error("metal frames a rectangle about its edge's middle");
  return { hx: (u1 - u0) / 2, foot: v0 - form.at[1], top: v1 - form.at[1] };
}

/**
 * A wall, a doorframe or a windowframe. The end posts are the whole of the wall past its yield ring, so nothing
 * crosses the ring and an end that yields to a joint closes flat; sill and head run between them.
 */
function wallFamily(form: FormDef, level: number): Shape | null {
  const f = frameOf(form);
  const openings = form.openings ?? [];
  if (openings.length > 1) throw new Error("metal frames one opening to a wall");
  const o = openings[0] && { x0: openings[0].x0 - form.at[0], x1: openings[0].x1 - form.at[0], z0: openings[0].y0 - form.at[1], z1: openings[0].y1 - form.at[1] };
  const doorway = o !== undefined && o.z0 <= f.foot + 1e-9;
  const p = new Shape();
  const box = (): Shape => p.box([-f.hx, -FACE, f.foot], [f.hx, FACE, f.top], (label) => tone(label[1] === "y" ? "plate" : "frame")(label, [0, 0, 0], [0, 0, 0]));
  // Past its ribs' distance a plain wall is its box. One with an opening keeps it a level longer, then is a box too.
  if (level > (o ? 4 : 3)) return null;
  if (level === 4 || (level === 3 && !o)) return box();
  if (level === 3 && o) {
    // In (z, x), going round as seen from +y: a doorway is a notch in the foot, a window a hole.
    const outline: Cell[] = doorway ? [[f.foot, -f.hx], [f.foot, o.x0], [o.z1, o.x0], [o.z1, o.x1], [f.foot, o.x1], [f.foot, f.hx], [f.top, f.hx], [f.top, -f.hx]] : [[f.foot, -f.hx], [f.foot, f.hx], [f.top, f.hx], [f.top, -f.hx]];
    return p.extrude(outline.reverse(), "y", -FACE, FACE, (label) => tone(label[1] === "y" ? "plate" : "frame")(label, [0, 0, 0], [0, 0, 0]), doorway ? [] : [[[o.z0, o.x0], [o.z1, o.x0], [o.z1, o.x1], [o.z0, o.x1]]]);
  }
  const [sill, head, in0, in1] = [f.foot + SILL, f.top - HEAD, -f.hx + POST, f.hx - POST];
  const plain = level === 2;
  const post = (x0: number, x1: number, inner: "low" | "high"): void => (plain ? void p.box([x0, -FACE, f.foot], [x1, FACE, f.top], tone("frame")) : stile(p, x0, x1, f.foot, f.top, inner));
  const across = (x0: number, x1: number, z0: number, z1: number, bevel: "up" | "down" | "both", face = FACE): void => (plain ? void p.box([x0, -face, z0], [x1, face, z1], tone("frame")) : rail(p, x0, x1, z0, z1, bevel, face));
  const upright = (x0: number, x1: number, z0: number, z1: number, bevel: "low" | "high" | "both" | "none", face = FACE): void => (plain || bevel === "none" ? void p.box([x0, -face, z0], [x1, face, z1], tone("frame")) : stile(p, x0, x1, z0, z1, bevel, face));
  const skin = (x0: number, x1: number, z0: number, z1: number): void => void p.box([x0, -SKIN, z0], [x1, SKIN, z1], tone("plate"));
  post(-f.hx, in0, "high");
  post(in1, f.hx, "low");
  across(in0, in1, head, f.top, "down");
  const corners = (): void => {
    if (plain) return;
    gusset(p, level, in0, head, 1, -1);
    gusset(p, level, in1, head, -1, -1);
  };
  const rib = 0.04; // half a rib's width at its foot
  if (!o) {
    across(in0, in1, f.foot, sill, "up");
    skin(in0, in1, sill - 0.01, head + 0.01);
    if (plain) return p;
    // A rail across the middle and a rib each side of it, on the grid.
    rail(p, in0, in1, -0.045, 0.045, "both", RIB);
    for (const x of [-GRID, GRID]) stile(p, x - rib, x + rib, sill - 0.01, head + 0.01, "both", RIB);
    corners();
    gusset(p, level, in0, sill, 1, 1);
    gusset(p, level, in1, sill, -1, 1);
    if (level === 0) {
      nuts(p, [-1.125, -0.375, 0.375, 1.125].flatMap((x): Cell[] => [[x, f.foot + 0.085], [x, f.top - 0.06]]), FACE);
      nuts(p, [-GRID, GRID].flatMap((x): Cell[] => [[x, 0], [x, sill + 0.07], [x, head - 0.07]]), RIB);
      nuts(p, [[in0 + 0.09, 0], [in1 - 0.09, 0], [0, 0]], RIB);
    }
    return p;
  }
  if (doorway) {
    // Box-section jambs from the floor and a lintel whose ends run past them; the sill stops at the jambs.
    const [jamb, lintel] = [0.14, 0.2];
    const [ja, jb, top] = [o.x0 - jamb, o.x1 + jamb, o.z1 + lintel];
    across(in0, ja, f.foot, sill, "up");
    across(jb, in1, f.foot, sill, "up");
    upright(ja, o.x0, f.foot, o.z1 + 0.01, "low");
    upright(o.x1, jb, f.foot, o.z1 + 0.01, "high");
    across(ja - 0.1, jb + 0.1, o.z1, top, "both");
    skin(in0, ja + 0.01, sill - 0.01, head + 0.01);
    skin(jb - 0.01, in1, sill - 0.01, head + 0.01);
    skin(ja, jb, top - 0.01, head + 0.01);
    if (plain) return p;
    rail(p, in0, ja + 0.01, -0.045, 0.045, "both", RIB);
    rail(p, jb - 0.01, in1, -0.045, 0.045, "both", RIB);
    stile(p, -rib, rib, top - 0.01, head + 0.01, "both", RIB);
    corners();
    gusset(p, level, in0, sill, 1, 1);
    gusset(p, level, in1, sill, -1, 1);
    if (level === 0) {
      const mid = (o.z1 + top) / 2;
      nuts(p, [[ja - 0.05, mid], [jb + 0.05, mid], [ja + jamb / 2, mid], [jb - jamb / 2, mid], [-0.35, mid], [0.35, mid]], FACE);
      nuts(p, [-1.125, 1.125].flatMap((x): Cell[] => [[x, f.foot + 0.085], [x, f.top - 0.06]]), FACE);
      nuts(p, [[-0.375, f.top - 0.06], [0.375, f.top - 0.06], [ja + jamb / 2, f.foot + 0.1], [jb - jamb / 2, f.foot + 0.1], [ja + jamb / 2, 0], [jb - jamb / 2, 0]], FACE);
      nuts(p, [[in0 + 0.09, 0], [in1 - 0.09, 0], [0, (top + head) / 2]], RIB);
      // The pintles the door hangs on, at the left of the doorway as seen from the front, and the keeper its bolt shoots into.
      const half = (o.z0 + o.z1) / 2;
      for (const z of [half - 0.72, half + 0.72]) p.box([o.x0 - 0.004, -0.085, z - 0.05], [o.x0 + 0.022, -0.04, z + 0.05], tone("bolt"));
      p.box([o.x1 - 0.02, -0.08, half - 0.06], [o.x1 + 0.004, -0.04, half + 0.06], tone("bolt"));
    }
    return p;
  }
  // A window: the ribs run past it either side, and a heavy sill and lintel span between them with the jambs inside.
  const [bar, jamb] = [0.13, 0.1];
  const [ra, rb] = [-GRID - rib, GRID + rib];
  across(in0, in1, f.foot, sill, "up");
  if (plain) {
    p.box([ra, -FACE, o.z0 - bar], [rb, FACE, o.z0], tone("frame"));
    p.box([ra, -FACE, o.z1], [rb, FACE, o.z1 + bar], tone("frame"));
    for (const [x0, x1] of [[ra, o.x0], [o.x1, rb]] as const) p.box([x0, -FACE, o.z0], [x1, FACE, o.z1], tone("frame"));
  } else {
    // The sill's top falls away to both faces, so it reads as a weathered ledge.
    p.extrude([[-FACE, o.z0 - bar], [FACE, o.z0 - bar], [FACE, o.z0 - 0.035], [FACE - 0.05, o.z0], [-(FACE - 0.05), o.z0], [-FACE, o.z0 - 0.035]], "x", ra, rb, tone("frame"));
    rail(p, ra, rb, o.z1, o.z1 + bar, "up");
    upright(o.x0 - jamb, o.x0, o.z0 - 0.01, o.z1 + 0.01, "low");
    upright(o.x1, o.x1 + jamb, o.z0 - 0.01, o.z1 + 0.01, "high");
  }
  // One plate behind the ribs, its hole hidden in the window's members.
  const hole: Cell[] = [[o.z0 - 0.06, o.x0 - 0.05], [o.z1 + 0.06, o.x0 - 0.05], [o.z1 + 0.06, o.x1 + 0.05], [o.z0 - 0.06, o.x1 + 0.05]];
  p.extrude([[sill - 0.01, in0], [head + 0.01, in0], [head + 0.01, in1], [sill - 0.01, in1]], "y", -SKIN, SKIN, tone("plate"), [hole]);
  if (plain) return p;
  for (const x of [-GRID, GRID]) {
    stile(p, x - rib, x + rib, sill - 0.01, o.z0 - bar + 0.01, "both", RIB);
    stile(p, x - rib, x + rib, o.z1 + bar - 0.01, head + 0.01, "both", RIB);
  }
  rail(p, in0, ra + 0.01, -0.045, 0.045, "both", RIB);
  rail(p, rb - 0.01, in1, -0.045, 0.045, "both", RIB);
  corners();
  gusset(p, level, in0, sill, 1, 1);
  gusset(p, level, in1, sill, -1, 1);
  if (level === 0) {
    nuts(p, [-1.125, -0.375, 0.375, 1.125].flatMap((x): Cell[] => [[x, f.foot + 0.085], [x, f.top - 0.06]]), FACE);
    nuts(p, [ra + 0.05, -0.3, 0.3, rb - 0.05].flatMap((x): Cell[] => [[x, o.z0 - bar / 2 - 0.02], [x, o.z1 + bar / 2 + 0.01]]), FACE);
    nuts(p, [-GRID, GRID].flatMap((x): Cell[] => [[x, sill + 0.07], [x, head - 0.07]]), RIB);
    nuts(p, [[in0 + 0.09, 0], [in1 - 0.09, 0]], RIB);
  }
  return p;
}

/** A prism along y from y0 to y1 whose section is `outline` in (x, z): one a ring across y cuts, and one across x leaves whole where `whole`. */
function alongY(p: Shape, outline: readonly Cell[], y0: number, y1: number, mat: FaceMap): void {
  p.extrude(outline.map(([x, z]) => [z, x] as const), "y", y0, y1, mat);
}

/**
 * A raft of deck plate with a channel round it, its web set back between its flanges and stiffened every 0.75 m, on a
 * footing at each corner. Nothing stands above the deck, so many make one floor.
 */
function foundation(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [top, bottom] = [form.thick / 2, -form.thick / 2];
  const sides = slab("plate", "frame");
  if (level === 3) return p.box([-H, -H, bottom], [H, H, top], sides);
  const [under, pad] = [top - DECK, 0.1]; // the deck's underside, and how high a footing stands
  if (level === 2) {
    // The raft as one slab over a plinth set back under it.
    p.box([-H, -H, bottom + pad], [H, H, top], sides);
    return p.box([-H + 0.12, -H + 0.12, bottom], [H - 0.12, H - 0.12, bottom + pad + 0.01], tone("dark"));
  }
  p.box([-H, -H, under], [H, H, top], sides);
  // What is under the deck inside the channel: a dark block, since nothing is seen through.
  p.box([-H + 0.07, -H + 0.07, bottom], [H - 0.07, H - 0.07, under + 0.005], tone("dark"));
  // The channel on each side, its mouth outward: (across, up) from the side's face inward.
  const [flange, web, deep] = [0.045, 0.045, 0.1];
  const section = (out: number): Cell[] => [[out, bottom + pad], [out, bottom + pad + flange], [out - web, bottom + pad + flange], [out - web, under - flange], [out, under - flange], [out, under + 0.005], [out - deep, under + 0.005], [out - deep, bottom + pad]];
  const block = 0.13; // a block at each corner, which the channels run into
  const reach = H - block + 0.01;
  for (const s of [-1, 1]) {
    p.extrude(section(H).map(([a, z]) => [s * a, z] as const), "x", -reach, reach, tone("frame"));
    alongY(p, section(H).map(([a, z]) => [s * a, z] as const), -reach, reach, tone("frame"));
  }
  const footing = 0.3;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const [x0, x1] = sx < 0 ? [-H, -H + footing] : [H - footing, H];
    const [y0, y1] = sy < 0 ? [-H, -H + footing] : [H - footing, H];
    p.box([x0, y0, bottom], [x1, y1, bottom + pad + 0.012], tone("frame"));
    p.box([sx < 0 ? -H : H - block, sy < 0 ? -H : H - block, bottom + pad], [sx < 0 ? -H + block : H, sy < 0 ? -H + block : H, under + 0.005], tone("frame"));
    if (level === 0) for (const [fx, fy] of [[sx * (H - 0.07), sy * (H - 0.22)], [sx * (H - 0.22), sy * (H - 0.07)]] as const) nut(p, [fx, fy, bottom + pad + 0.012], [0, 0, 1], 0.026, 0.016);
  }
  // Stiffeners in the channel's mouth, on the grid.
  const marks = level === 0 ? [-GRID, 0, GRID] : [0];
  for (const s of [-1, 1]) for (const at of marks) {
    const [a0, a1] = s < 0 ? [-H + 0.004, -H + web + 0.01] : [H - web - 0.01, H - 0.004];
    p.box([at - 0.012, a0, bottom + pad + flange - 0.005], [at + 0.012, a1, under - flange + 0.005], tone("frame"));
    p.box([a0, at - 0.012, bottom + pad + flange - 0.005], [a1, at + 0.012, under - flange + 0.005], tone("frame"));
  }
  if (level === 0) {
    const z = (bottom + pad + under) / 2;
    for (const s of [-1, 1]) for (const at of [-1.125, -0.375, 0.375, 1.125]) {
      nut(p, [at, s * (H - web), z], [0, s, 0]);
      nut(p, [s * (H - web), at, z], [s, 0, 0]);
    }
  }
  return p;
}

/**
 * Deck plate on three joists inside a rim; the underside of the deck is the ceiling of the room below. The rim lies
 * wholly in the band a ceiling's side yields by, a little narrower, so its inner face is not in the plane of the wall's
 * under it. The deck is cut by all four rings; the rim's long beams and the joists are prisms along what they span,
 * which a ring leaves whole: pulled back, each is shorter.
 */
function ceiling(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [top, bottom] = [form.thick / 2, -form.thick / 2 + 0.01];
  if (level === 3) return p.box([-H, -H, bottom], [H, H, top], slab("plate", "frame", "plate"));
  const under = top - DECK;
  const rim = 0.085;
  const [x0, x1] = [-H, H];
  const deck = (z0: number, z1: number): void => void p.box([x0, -H, z0], [x1, H, z1], slab("plate", "frame", "plate"));
  if (level === 2) {
    deck(bottom, top);
    return p;
  }
  deck(under, top);
  // The rim: two beams the whole side, which are prisms along x too, and two between them.
  for (const s of [-1, 1]) {
    const [y0, y1] = s < 0 ? [-H, -H + rim] : [H - rim, H];
    const at = (x: number): Vec[] => [[x, y0, bottom], [x, y1, bottom], [x, y1, under + 0.004], [x, y0, under + 0.004]];
    p.loft([at(x0), at(x1)], () => ["frame", [0, 0]], () => ["frame", [0, 0]], 0);
    const [a0, a1] = s < 0 ? [-H, -H + rim] : [H - rim, H];
    p.box([a0, -H + rim, bottom], [a1, H - rim, under + 0.004], tone("frame"));
  }
  // Joists across y between the rim's beams: a flange under a web.
  for (const x of [-GRID, 0, GRID]) {
    for (const [w, z0, z1] of [[0.05, bottom + 0.012, bottom + 0.04], [0.015, bottom + 0.035, under + 0.004]] as const) {
      const at = (y: number): Vec[] => [[x - w, y, z0], [x + w, y, z0], [x + w, y, z1], [x - w, y, z1]];
      p.loft([at(-H + rim - 0.004), at(H - rim + 0.004)], () => ["frame", [0, 0]], () => ["frame", [0, 0]], 1);
    }
  }
  if (level === 0) {
    // A cleat's two nuts under each end of each joist, and one in the middle of each rim beam's face.
    for (const x of [-GRID, 0, GRID]) for (const s of [-1, 1]) for (const dx of [-0.03, 0.03]) nut(p, [x + dx, s * (H - rim - 0.05), bottom + 0.012], [0, 0, -1], 0.016, 0.01);
    for (const s of [-1, 1]) for (const at of [-1.125, -0.375, 0.375, 1.125]) nut(p, [at, s * (H - rim), (bottom + under) / 2], [0, -s, 0], 0.018, 0.01);
  }
  return p;
}

/** A box section between a base plate and a cap plate, each stiffened by a gusset on every face and bolted down, with a bolted collar where two lengths join. */
function pillar(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [u0, , u1] = outlineBox(form);
  const half = (u1 - u0) / 2;
  const k = half / 0.25;
  const hz = form.thick / 2;
  const shaft = 0.17 * k;
  if (level === 3) return p.box([-0.2 * k, -0.2 * k, -hz], [0.2 * k, 0.2 * k, hz - 0.012], tone("frame"));
  const plate = 0.045;
  // The cap plate stands under the floor the pillar carries, and the shaft runs on into it, short of its top.
  const cap = hz - FLOOR;
  p.box([-half, -half, -hz], [half, half, -hz + plate], tone("frame"));
  p.box([-half, -half, cap - plate], [half, half, cap], tone("frame"));
  if (level === 2) return p.box([-shaft, -shaft, -hz + plate - 0.005], [shaft, shaft, hz - 0.012], tone("plate"));
  // The shaft with its corners eased, as a rolled section's are.
  const c = 0.03 * k;
  const ring: Cell[] = [[shaft, -shaft + c], [shaft, shaft - c], [shaft - c, shaft], [-shaft + c, shaft], [-shaft, shaft - c], [-shaft, -shaft + c], [-shaft + c, -shaft], [shaft - c, -shaft]];
  p.extrude(ring, "z", -hz + plate - 0.005, hz - 0.012, tone("plate"));
  // A gusset from each plate up or down the middle of each face.
  const [leg, thick] = [0.22, 0.014];
  for (const s of [-1, 1]) {
    const z = s < 0 ? -hz + plate - 0.004 : cap - plate + 0.004;
    for (const way of [-1, 1]) {
      p.extrude([[way * (shaft - 0.004), z], [way * (half - 0.012), z], [way * (shaft - 0.004), z - s * leg]], "x", -thick, thick, tone("frame"));
      alongY(p, [[way * (shaft - 0.004), z], [way * (half - 0.012), z], [way * (shaft - 0.004), z - s * leg]], -thick, thick, tone("frame"));
    }
  }
  const collar = 0.07;
  p.box([-shaft - 0.014, -shaft - 0.014, -collar], [shaft + 0.014, shaft + 0.014, collar], tone("frame"));
  if (level === 0) {
    const at = half - 0.055;
    for (const s of [-1, 1]) for (const [x, y] of [[-at, -at], [at, -at], [at, at], [-at, at]] as const) nut(p, [x, y, s < 0 ? -hz + plate : cap - plate], [0, 0, -s], 0.024 * k, 0.016);
    for (const n of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] as const) {
      for (const side of [-0.09 * k, 0.09 * k]) nut(p, [n[0] * (shaft + 0.014) + n[1] * side, n[1] * (shaft + 0.014) + n[0] * side, 0], n, 0.019 * k);
    }
  }
  return p;
}

/**
 * The door: a plate leaf in a frame of flat bar with a rail across its middle, strap hinges on knuckles at its left,
 * a sight slot at eye height under a hood, a bar pull and a bolt. The front is -y, the side it opens toward. Open, it
 * is the same door a quarter turn round its hinge.
 */
function door(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [u0, v0, u1, v1] = outlineBox(form);
  const [hw, hh] = [(u1 - u0) / 2, (v1 - v0) / 2];
  const open = (q: Vec): Vec => [q[1] + (form.off ?? 0), -q[0] - hw, q[2]];
  const done = (): Shape => (form.plane === "across" ? p.move(open) : p);
  if (level === 3) {
    p.box([-hw, -form.thick / 2, -hh], [hw, form.thick / 2, hh], tone("plate"));
    return done();
  }
  const [front, back, bar] = [-0.024, 0.02, 0.085];
  const face = form.thick / 2;
  p.box([-hw + 0.01, front, -hh + 0.01], [hw - 0.01, back, hh - 0.01], tone("plate"));
  // The frame of flat bar on both faces, as one member through the leaf each side.
  const flat = (x0: number, x1: number, z0: number, z1: number): void => void p.box([x0, -face, z0], [x1, face, z1], tone("frame"));
  flat(-hw, -hw + bar, -hh, hh);
  flat(hw - bar, hw, -hh, hh);
  flat(-hw + bar - 0.005, hw - bar + 0.005, -hh, -hh + bar + 0.03);
  flat(-hw + bar - 0.005, hw - bar + 0.005, hh - bar, hh);
  if (level === 2) return done();
  const rails = [-0.36, 0.72] as const; // the middle rail, and the slot's
  flat(-hw + bar - 0.005, hw - bar + 0.005, rails[0] - 0.045, rails[0] + 0.045);
  // The sight slot: a dark opening in a heavy surround, under a hood on the front.
  const [sz, sw] = [rails[1] - 0.28, 0.17];
  p.box([-sw - 0.05, -face, sz - 0.075], [sw + 0.05, face, sz + 0.075], tone("frame"));
  p.box([-sw, -face - 0.002, sz - 0.028], [sw, face + 0.002, sz + 0.028], tone("dark"));
  p.extrude([[-face - 0.03, sz + 0.05], [-face, sz + 0.05], [-face, sz + 0.085], [-face - 0.012, sz + 0.085]], "x", -sw - 0.05, sw + 0.05, tone("frame"));
  const hinges = [-hh + 0.4, hh - 0.4] as const;
  for (const z of hinges) {
    // A strap tapering to a point, on a knuckle at the door's edge.
    const tip = 0.34;
    const outline: Cell[] = [[-hw, z - 0.05], [tip - 0.16, z - 0.034], [tip, z], [tip - 0.16, z + 0.034], [-hw, z + 0.05]];
    p.extrude(outline.map(([x, zz]) => [zz, x] as const), "y", -face - 0.012, -face + 0.004, tone("bolt"));
    p.box([-hw - 0.012, -face - 0.03, z - 0.075], [-hw + 0.024, -face + 0.004, z + 0.075], tone("bolt"));
  }
  // A bar pull on two stand-offs at the latch side, and the bolt that shoots into the keeper.
  const [px, pz] = [hw - 0.2, -0.02];
  for (const dz of [-0.13, 0.13]) p.box([px - 0.014, -face - 0.04, pz + dz - 0.014], [px + 0.014, -face + 0.004, pz + dz + 0.014], tone("bolt"));
  p.box([px - 0.016, -face - 0.044, pz - 0.17], [px + 0.016, -face - 0.028, pz + 0.17], tone("bolt"));
  p.box([hw - 0.3, -face - 0.016, rails[0] - 0.022], [hw + 0.008, -face + 0.004, rails[0] + 0.022], tone("bolt"));
  if (level === 0) {
    const edge = bar / 2;
    const ring: Cell[] = [...[-0.9, -0.3, 0.3, 0.9].flatMap((z): Cell[] => [[-hw + edge, z], [hw - edge, z]]), ...[-0.35, 0.35].flatMap((x): Cell[] => [[x, -hh + edge + 0.015], [x, hh - edge]]), [-0.3, rails[0]], [0.12, rails[0]]];
    for (const [x, z] of ring) for (const s of [-1, 1]) nut(p, [x, s * face, z], [0, s, 0], 0.017, 0.009);
    for (const z of hinges) for (const x of [-hw + 0.16, -hw + 0.4, -hw + 0.64]) nut(p, [x, -face - 0.012, z], [0, -1, 0], 0.013, 0.008);
    for (const x of [-sw - 0.025, sw + 0.025]) for (const s of [-1, 1]) nut(p, [x, s * face, sz - 0.045], [0, s, 0], 0.013, 0.008);
  }
  return done();
}

/**
 * Stairs up toward -y (the engine's +Z), solid underneath as the collision is: plate cheeks and back in a frame, a
 * stringer of heavy section up each side, and treads of plate with a raised nosing and two grip bars.
 */
function stairs(form: FormDef, level: number): Shape | null {
  if (level > 4) return null;
  const p = new Shape();
  const steps = form.steps!;
  const hz = form.thick / 2;
  const [run, rise] = [(2 * H) / steps, form.thick / steps];
  const body = slab("frame", "plate");
  // Coarsest, the slope from foot to head; before that, midway between the steps' noses and their roots.
  if (level === 4) return p.extrude([[H, -hz], [-H, hz], [-H, -hz]], "x", -H, H, body);
  if (level === 3) return p.extrude([[H, -hz], [H, -hz + rise / 2], [-H + run / 2, hz], [-H, hz], [-H, -hz]], "x", -H, H, body);
  const s = H - 0.07; // the stringers' inner faces
  const tread = 0.03;
  // The solid, (y, z) going round as seen from +x: along the floor toward +y, up the first riser, up the steps, down the back.
  const lift = level === 0 ? tread : 0;
  const outline: Cell[] = [[-H + 0.05, -hz], [H, -hz]];
  for (let i = 0; i < steps; i++) {
    // Under a nosing the riser stands back by its overhang.
    const yFront = H - i * run - (level === 0 ? 0.012 : 0);
    const zTop = -hz + (i + 1) * rise - lift;
    if (i > 0) outline.push([yFront, zTop - rise]);
    outline.push([yFront, zTop]);
  }
  outline.push([-H + 0.05, hz - lift]);
  p.extrude(outline, "x", -s, s, level === 0 ? tone("plate") : body);
  if (level === 0) {
    for (let i = 0; i < steps; i++) {
      const zTop = -hz + (i + 1) * rise;
      const [yBack, yNose] = [H - (i + 1) * run, H - i * run];
      // The tread's plate, then its nosing and two bars across it, which catch the light and the foot.
      p.box([-s + 0.004, yBack, zTop - tread - 0.002], [s - 0.004, yNose - 0.04, zTop - 0.008], tone("frame"));
      p.extrude([[yNose - 0.05, zTop - tread - 0.002], [yNose, zTop - tread - 0.002], [yNose, zTop - 0.006], [yNose - 0.008, zTop], [yNose - 0.05, zTop]], "x", -s + 0.004, s - 0.004, tone("nosing"));
      for (const y of [yBack + 0.07, yBack + 0.16]) p.extrude([[y - 0.012, zTop - 0.009], [y + 0.012, zTop - 0.009], [y + 0.006, zTop - 0.001], [y - 0.006, zTop - 0.001]], "x", -s + 0.02, s - 0.02, tone("frame"));
    }
  }
  // Past the bars' distance a nosing is a strip of its colour along each tread's edge.
  if (level === 1) for (let i = 0; i < steps; i++) p.box([-s + 0.004, H - i * run - 0.05, -hz + (i + 1) * rise - 0.02], [s - 0.004, H - i * run + 0.002, -hz + (i + 1) * rise], tone("nosing"));
  // A stringer up each side, proud of the cheek, from the floor at the foot to the head.
  const deep = 0.16 + rise;
  const stringer: Cell[] = [[H, -hz], [H, -hz + deep], [-H + deep, hz], [-H, hz], [-H, hz - 0.2], [H - 0.2, -hz]];
  for (const [x0, x1] of [[-H, -s], [s, H]] as const) p.extrude(stringer, "x", x0, x1, tone("frame"));
  if (level === 2) return p;
  // The back and the cheeks are framed as a wall is: a post at each back corner, a sill round the foot and a head across the back.
  for (const [x0, x1] of [[-H, -s + 0.03], [s - 0.03, H]] as const) p.box([x0, -H, -hz], [x1, -H + 0.1, hz - 0.004], tone("frame"));
  p.box([-s, -H, -hz], [s, -H + 0.058, -hz + SILL], tone("frame"));
  {
    p.box([-s, -H, hz - HEAD - lift], [s, -H + 0.058, hz - lift - 0.004], tone("frame"));
    p.box([-s, -H + 0.012, -0.045], [s, -H + 0.062, 0.045], tone("frame"));
    for (const x of [-GRID, GRID]) p.box([x - 0.04, -H + 0.016, -hz + SILL - 0.01], [x + 0.04, -H + 0.058, hz - HEAD - lift + 0.01], tone("frame"));
    for (const sx of [-1, 1]) {
      const [x0, x1] = sx < 0 ? [-H, -s + 0.004] : [s - 0.004, H];
      // The cheek's sill along the floor, and a post under the stringer's middle.
      p.box([x0, -H + 0.1, -hz], [x1, H - 0.02, -hz + 0.12], tone("frame"));
      p.box([x0 + (sx < 0 ? 0.012 : 0), -0.05, -hz + 0.12], [x1 - (sx < 0 ? 0 : 0.012), 0.05, -0.2], tone("frame"));
    }
  }
  if (level === 0) {
    for (const sx of [-1, 1]) {
      // Along each stringer, where a tread's cleat bolts through it.
      for (let i = 1; i < steps; i += 2) nut(p, [sx * H, H - (i + 0.5) * run, -hz + (i + 0.5) * rise + 0.02], [sx, 0, 0]);
      for (const z of [-hz + 0.35, 0, hz - 0.35]) nut(p, [sx * (H - 0.035), -H, z], [0, -1, 0]);
    }
    for (const x of [-1.125, -0.375, 0.375, 1.125]) nut(p, [x, -H, -hz + 0.09], [0, -1, 0]);
  }
  return p;
}

export const METAL: TierRecipe = {
  name: "metal",
  rank: 3,
  runPost: false,
  jointHalf: 0.11,
  // Each is a palette entry (shared/pack/palette.ts), so the match is exact: the steel greys 89 and 91, whose painted
  // finish is steel (content/surfaces.ts), a rusted iron, black, and the marker yellow, a steel's colour too.
  tones: { plate: [139, 148, 156], frame: [174, 182, 191], bolt: [77, 83, 88], dark: [20, 20, 24], nosing: [236, 208, 72] },
  split(name, form, level) {
    if (form.layer === "wall") return wallFamily(form, level);
    if (form.layer === "slab" && form.root === "always") return foundation(form, level);
    if (form.layer === "slab" && form.outline.length === 4 && !form.corner && !form.openings) return ceiling(form, level);
    if (form.layer === "post") return pillar(form, level);
    if (form.layer === "leaf" && form.plane !== "flat") return door(form, level);
    if (form.layer === "fill" && form.steps !== undefined) return stairs(form, level);
    throw new Error(`metal has no recipe for ${name} yet`);
  },
};

/** The colour a material's faces carry: the plate's is region 0, the instance's colour, which wears the recipe's material; the rest are the tones' palette entries. */
export function metalColours(): (mat: string) => number {
  const palette = defaultPalette();
  const fixed = new Map(Object.entries(METAL.tones).map(([mat, rgb]) => [mat, nearestColour(palette, rgb[0], rgb[1], rgb[2])] as const));
  return (mat) => (mat === "plate" ? REGION_BASE : fixed.get(mat)!);
}

/**
 * The tier's meshes as its pack holds them: every level flat, in the colours above, the levels a wall is seen close
 * at saying their faces' corners and outer edges so the flat program wears their arrises (kit.ts flatLod).
 */
export function bakeMetal(forms: Readonly<Record<string, FormDef>>): SourceMesh[] {
  const colour = metalColours();
  return Object.entries(forms).map(([name, form]): SourceMesh => ({
    id: `core:${name}_${METAL.name}`,
    lods: levelsOf(METAL, name, form).map((shape, level): SourceLod => ({ ...flatLod(shape, colour, level < 3), ...(level > 0 ? { error: errorOf(shape, level) } : {}) })),
  }));
}
