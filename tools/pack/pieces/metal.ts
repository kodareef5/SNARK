// The metal tier's recipe: steel panels bolted side by side. Each piece is a frame of heavy bevelled section round
// recessed plate, stiffened by ribs on a 0.75 m grid, with gusset plates in its corners and square nuts where members
// meet. Floors are deck plate on beams, the foundation a raft with a channel round it on footings, the pillar a box
// section between base and cap plates, the door a framed leaf with strap hinges and a sight slot.
//
// It has no pictures. Every level is flat: the plate's faces are colour region 0, the instance's colour; frame, trim,
// bolts and nosings are fixed palette colours, so the piece is two-toned steel on every client. Where the card makes
// recipes every face wears the "plate" material (content/texgen/materials.ts) in its own colour, read in the piece's own
// frame: sheets 0.75 m square from the piece's origin with rivets inside their edges, the grid the ribs stand on. The
// frame round a wall wears the sheets as the plate does, so a row of rivets runs along it inside the wall's edge; trim,
// bolts and nosings keep clear of joints and rivets (FACE_PLAIN).
//
// Levels: 0 is everything; 1 has no nuts and no small fittings; 2 is the frame as plain boxes; then plain solids. It
// works in the frame the other tiers do: x along the piece, z up, the front at -y.

import { REGION_BASE, defaultPalette, nearestColour } from "../../../shared/pack/palette.ts";
import { HALF_SIDE_M, outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import type { SourceLod, SourceMesh } from "../write.ts";
import { Shape, add, clip, clipTo, cross, flatLod, inset, mirror, place, planeAt, planeMoved, scale, slabOn, sub, unit, uprightPlane, type FaceMap, type Flat, type SlabMap, type Uv, type Vec } from "./kit.ts";
import { errorOf, levelsOf, planOf, type TierRecipe } from "./lod.ts";
import { FACE_PLAIN, FACE_WEARS } from "../../../client/core/render/piece-fit.ts";

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
type Mat = "plate" | "frame" | "trim" | "bolt" | "dark" | "nosing";

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
function rail(p: Shape, x0: number, x1: number, z0: number, z1: number, bevel: "up" | "down" | "both" | "none", face = FACE, mat: Mat = "trim"): void {
  // A bevel runs from the member's face down to the plate's, steeper than it is wide: two at a corner then cross and never lie in one plane.
  const [b, f, d] = [BEVEL, face, face - SKIN];
  const lower: Cell[] = bevel === "down" || bevel === "both" ? [[-f, z0 + b], [-(f - d), z0], [f - d, z0], [f, z0 + b]] : [[-f, z0], [f, z0]];
  const upper: Cell[] = bevel === "up" || bevel === "both" ? [[f, z1 - b], [f - d, z1], [-(f - d), z1], [-f, z1 - b]] : [[f, z1], [-f, z1]];
  p.extrude([...lower, ...upper], "x", x0, x1, tone(mat));
}

/** An upright member from z0 to z1 between x0 and x1: bevelled toward the plate on its edge at x0 ("low"), x1 ("high") or both. */
function stile(p: Shape, x0: number, x1: number, z0: number, z1: number, bevel: "low" | "high" | "both" | "none", face = FACE, mat: Mat = "trim"): void {
  const [b, f, d] = [BEVEL, face, face - SKIN];
  const low: Cell[] = bevel === "low" || bevel === "both" ? [[x0 + b, -f], [x0, -(f - d)], [x0, f - d], [x0 + b, f]] : [[x0, -f], [x0, f]];
  const high: Cell[] = bevel === "high" || bevel === "both" ? [[x1 - b, f], [x1, f - d], [x1, -(f - d)], [x1 - b, -f]] : [[x1, f], [x1, -f]];
  p.extrude([...low, ...high], "z", z0, z1, tone(mat));
}

/** A triangular plate through the wall in the corner (x, z) of its frame, its legs `leg` long toward (sx, sz), with three nuts a face. */
function gusset(p: Shape, level: number, x: number, z: number, sx: number, sz: number, leg = 0.26): void {
  p.extrude([[z, x], [z + sz * leg, x], [z, x + sx * leg]], "y", -GUSSET, GUSSET, tone("trim"));
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
  // The posts, the sill and the head are the wall's frame, along its edges; what stands inside them is trim.
  const post = (x0: number, x1: number, inner: "low" | "high"): void => (plain ? void p.box([x0, -FACE, f.foot], [x1, FACE, f.top], tone("frame")) : stile(p, x0, x1, f.foot, f.top, inner, FACE, "frame"));
  const across = (x0: number, x1: number, z0: number, z1: number, bevel: "up" | "down" | "both", mat: Mat = "trim"): void => (plain ? void p.box([x0, -FACE, z0], [x1, FACE, z1], tone(mat)) : rail(p, x0, x1, z0, z1, bevel, FACE, mat));
  const upright = (x0: number, x1: number, z0: number, z1: number, bevel: "low" | "high" | "both" | "none", face = FACE): void => (plain || bevel === "none" ? void p.box([x0, -face, z0], [x1, face, z1], tone("trim")) : stile(p, x0, x1, z0, z1, bevel, face));
  const skin = (x0: number, x1: number, z0: number, z1: number): void => void p.box([x0, -SKIN, z0], [x1, SKIN, z1], tone("plate"));
  post(-f.hx, in0, "high");
  post(in1, f.hx, "low");
  across(in0, in1, head, f.top, "down", "frame");
  const corners = (): void => {
    if (plain) return;
    gusset(p, level, in0, head, 1, -1);
    gusset(p, level, in1, head, -1, -1);
  };
  const rib = 0.04; // half a rib's width at its foot
  if (!o) {
    across(in0, in1, f.foot, sill, "up", "frame");
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
    across(in0, ja, f.foot, sill, "up", "frame");
    across(jb, in1, f.foot, sill, "up", "frame");
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
  across(in0, in1, f.foot, sill, "up", "frame");
  if (plain) {
    p.box([ra, -FACE, o.z0 - bar], [rb, FACE, o.z0], tone("trim"));
    p.box([ra, -FACE, o.z1], [rb, FACE, o.z1 + bar], tone("trim"));
    for (const [x0, x1] of [[ra, o.x0], [o.x1, rb]] as const) p.box([x0, -FACE, o.z0], [x1, FACE, o.z1], tone("trim"));
  } else {
    // The sill's top falls away to both faces, so it reads as a weathered ledge.
    p.extrude([[-FACE, o.z0 - bar], [FACE, o.z0 - bar], [FACE, o.z0 - 0.035], [FACE - 0.05, o.z0], [-(FACE - 0.05), o.z0], [-FACE, o.z0 - 0.035]], "x", ra, rb, tone("trim"));
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
  const sides = slab("plate", "trim");
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
    p.extrude(section(H).map(([a, z]) => [s * a, z] as const), "x", -reach, reach, tone("trim"));
    alongY(p, section(H).map(([a, z]) => [s * a, z] as const), -reach, reach, tone("trim"));
  }
  const footing = 0.3;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const [x0, x1] = sx < 0 ? [-H, -H + footing] : [H - footing, H];
    const [y0, y1] = sy < 0 ? [-H, -H + footing] : [H - footing, H];
    p.box([x0, y0, bottom], [x1, y1, bottom + pad + 0.012], tone("trim"));
    p.box([sx < 0 ? -H : H - block, sy < 0 ? -H : H - block, bottom + pad], [sx < 0 ? -H + block : H, sy < 0 ? -H + block : H, under + 0.005], tone("trim"));
    if (level === 0) for (const [fx, fy] of [[sx * (H - 0.07), sy * (H - 0.22)], [sx * (H - 0.22), sy * (H - 0.07)]] as const) nut(p, [fx, fy, bottom + pad + 0.012], [0, 0, 1], 0.026, 0.016);
  }
  // Stiffeners in the channel's mouth, on the grid.
  const marks = level === 0 ? [-GRID, 0, GRID] : [0];
  for (const s of [-1, 1]) for (const at of marks) {
    const [a0, a1] = s < 0 ? [-H + 0.004, -H + web + 0.01] : [H - web - 0.01, H - 0.004];
    p.box([at - 0.012, a0, bottom + pad + flange - 0.005], [at + 0.012, a1, under - flange + 0.005], tone("trim"));
    p.box([a0, at - 0.012, bottom + pad + flange - 0.005], [a1, at + 0.012, under - flange + 0.005], tone("trim"));
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
  if (level === 3) return p.box([-H, -H, bottom], [H, H, top], slab("plate", "trim", "plate"));
  const under = top - DECK;
  const rim = 0.085;
  const [x0, x1] = [-H, H];
  const deck = (z0: number, z1: number): void => void p.box([x0, -H, z0], [x1, H, z1], slab("plate", "trim", "plate"));
  if (level === 2) {
    deck(bottom, top);
    return p;
  }
  deck(under, top);
  // The rim: two beams the whole side, which are prisms along x too, and two between them.
  for (const s of [-1, 1]) {
    const [y0, y1] = s < 0 ? [-H, -H + rim] : [H - rim, H];
    const at = (x: number): Vec[] => [[x, y0, bottom], [x, y1, bottom], [x, y1, under + 0.004], [x, y0, under + 0.004]];
    p.loft([at(x0), at(x1)], () => ["trim", [0, 0]], () => ["trim", [0, 0]], 0);
    const [a0, a1] = s < 0 ? [-H, -H + rim] : [H - rim, H];
    p.box([a0, -H + rim, bottom], [a1, H - rim, under + 0.004], tone("trim"));
  }
  // Joists across y between the rim's beams: a flange under a web.
  for (const x of [-GRID, 0, GRID]) {
    for (const [w, z0, z1] of [[0.05, bottom + 0.012, bottom + 0.04], [0.015, bottom + 0.035, under + 0.004]] as const) {
      const at = (y: number): Vec[] => [[x - w, y, z0], [x + w, y, z0], [x + w, y, z1], [x - w, y, z1]];
      p.loft([at(-H + rim - 0.004), at(H - rim + 0.004)], () => ["trim", [0, 0]], () => ["trim", [0, 0]], 1);
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
  if (level === 3) return p.box([-0.2 * k, -0.2 * k, -hz], [0.2 * k, 0.2 * k, hz - 0.012], tone("trim"));
  const plate = 0.045;
  // The cap plate stands under the floor the pillar carries, and the shaft runs on into it, short of its top.
  const cap = hz - FLOOR;
  p.box([-half, -half, -hz], [half, half, -hz + plate], tone("trim"));
  p.box([-half, -half, cap - plate], [half, half, cap], tone("trim"));
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
      p.extrude([[way * (shaft - 0.004), z], [way * (half - 0.012), z], [way * (shaft - 0.004), z - s * leg]], "x", -thick, thick, tone("trim"));
      alongY(p, [[way * (shaft - 0.004), z], [way * (half - 0.012), z], [way * (shaft - 0.004), z - s * leg]], -thick, thick, tone("trim"));
    }
  }
  const collar = 0.07;
  p.box([-shaft - 0.014, -shaft - 0.014, -collar], [shaft + 0.014, shaft + 0.014, collar], tone("trim"));
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
  const flat = (x0: number, x1: number, z0: number, z1: number): void => void p.box([x0, -face, z0], [x1, face, z1], tone("trim"));
  flat(-hw, -hw + bar, -hh, hh);
  flat(hw - bar, hw, -hh, hh);
  flat(-hw + bar - 0.005, hw - bar + 0.005, -hh, -hh + bar + 0.03);
  flat(-hw + bar - 0.005, hw - bar + 0.005, hh - bar, hh);
  if (level === 2) return done();
  const rails = [-0.36, 0.72] as const; // the middle rail, and the slot's
  flat(-hw + bar - 0.005, hw - bar + 0.005, rails[0] - 0.045, rails[0] + 0.045);
  // The sight slot: a dark opening in a heavy surround, under a hood on the front.
  const [sz, sw] = [rails[1] - 0.28, 0.17];
  p.box([-sw - 0.05, -face, sz - 0.075], [sw + 0.05, face, sz + 0.075], tone("trim"));
  p.box([-sw, -face - 0.002, sz - 0.028], [sw, face + 0.002, sz + 0.028], tone("dark"));
  p.extrude([[-face - 0.03, sz + 0.05], [-face, sz + 0.05], [-face, sz + 0.085], [-face - 0.012, sz + 0.085]], "x", -sw - 0.05, sw + 0.05, tone("trim"));
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
  const body = slab("trim", "plate");
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
      p.box([-s + 0.004, yBack, zTop - tread - 0.002], [s - 0.004, yNose - 0.04, zTop - 0.008], tone("trim"));
      p.extrude([[yNose - 0.05, zTop - tread - 0.002], [yNose, zTop - tread - 0.002], [yNose, zTop - 0.006], [yNose - 0.008, zTop], [yNose - 0.05, zTop]], "x", -s + 0.004, s - 0.004, tone("nosing"));
      for (const y of [yBack + 0.07, yBack + 0.16]) p.extrude([[y - 0.012, zTop - 0.009], [y + 0.012, zTop - 0.009], [y + 0.006, zTop - 0.001], [y - 0.006, zTop - 0.001]], "x", -s + 0.02, s - 0.02, tone("trim"));
    }
  }
  // Past the bars' distance a nosing is a strip of its colour along each tread's edge.
  if (level === 1) for (let i = 0; i < steps; i++) p.box([-s + 0.004, H - i * run - 0.05, -hz + (i + 1) * rise - 0.02], [s - 0.004, H - i * run + 0.002, -hz + (i + 1) * rise], tone("nosing"));
  // A stringer up each side, proud of the cheek, from the floor at the foot to the head.
  const deep = 0.16 + rise;
  const stringer: Cell[] = [[H, -hz], [H, -hz + deep], [-H + deep, hz], [-H, hz], [-H, hz - 0.2], [H - 0.2, -hz]];
  for (const [x0, x1] of [[-H, -s], [s, H]] as const) p.extrude(stringer, "x", x0, x1, tone("trim"));
  if (level === 2) return p;
  // The back and the cheeks are framed as a wall is: a post at each back corner, a sill round the foot and a head across the back.
  for (const [x0, x1] of [[-H, -s + 0.03], [s - 0.03, H]] as const) p.box([x0, -H, -hz], [x1, -H + 0.1, hz - 0.004], tone("trim"));
  p.box([-s, -H, -hz], [s, -H + 0.058, -hz + SILL], tone("trim"));
  {
    p.box([-s, -H, hz - HEAD - lift], [s, -H + 0.058, hz - lift - 0.004], tone("trim"));
    p.box([-s, -H + 0.012, -0.045], [s, -H + 0.062, 0.045], tone("trim"));
    for (const x of [-GRID, GRID]) p.box([x - 0.04, -H + 0.016, -hz + SILL - 0.01], [x + 0.04, -H + 0.058, hz - HEAD - lift + 0.01], tone("trim"));
    for (const sx of [-1, 1]) {
      const [x0, x1] = sx < 0 ? [-H, -s + 0.004] : [s - 0.004, H];
      // The cheek's sill along the floor, and a post under the stringer's middle.
      p.box([x0, -H + 0.1, -hz], [x1, H - 0.02, -hz + 0.12], tone("trim"));
      p.box([x0 + (sx < 0 ? 0.012 : 0), -0.05, -hz + 0.12], [x1 - (sx < 0 ? 0 : 0.012), 0.05, -0.2], tone("trim"));
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

// The forms past the first nine. Each reads its row: its outline, its thickness, its corner heights and its openings.
// What stands in a wall's yield band is the whole of the wall there, as an end post is; what runs through the band is a
// prism along the wall, which is shorter where an end yields. A sloped part ends on the plane its row gives it (clip).

const NO_UV: Uv = [0, 0];
const of = (mat: Mat): readonly [string, () => Uv] => [mat, () => NO_UV];
/** A slab's faces: `top` over it, `under` beneath, `side` round it. */
const slabMap = (top: Mat, side: Mat, under: Mat = side): SlabMap => (part) => of(part === "top" ? top : part === "under" ? under : side);
/** A wall's faces far off: plate on its two faces, frame round its edges. */
const walled: FaceMap = (label) => tone(label[1] === "y" ? "plate" : "frame")(label, [0, 0, 0], [0, 0, 0]);

/** Says the faces from `from` on are a prism along `axis`: a yield ring across it leaves it whole, and pulled back it is shorter. */
function prismatic(p: Shape, from: number, axis: number): void {
  for (const f of p.faces.slice(from)) (f as { along?: number }).along = axis;
}

/** A box that is a prism along `axis`. */
function bar(p: Shape, lo: Vec, hi: Vec, mapping: FaceMap, axis = 0): void {
  const from = p.faces.length;
  p.box(lo, hi, mapping);
  prismatic(p, from, axis);
}

/** Faces given one by one as a closed solid, turned to look outward. */
function closed(p: Shape, faces: { points: Vec[]; mat: Mat; along?: number }[]): void {
  (p as unknown as { solid(faces: unknown[]): Shape }).solid(faces.map((f) => ({ ...f, uvs: f.points.map(() => NO_UV) })));
}

/** A pyramid-headed bolt on a face at `centre`: half the triangles of a nut, for a piece with many. */
function stud(p: Shape, centre: Vec, normal: Vec, half = 0.02, out = 0.011): void {
  const n = unit(normal);
  const a = unit(Math.abs(n[2]) < 0.9 ? cross([0, 0, 1], n) : [1, 0, 0]), b = cross(n, a);
  const base = ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as const).map(([s, t]): Vec => add(add(centre, scale(n, -0.003)), add(scale(a, s * half), scale(b, t * half))));
  const tip = add(centre, scale(n, out));
  closed(p, [...base.map((q, k) => ({ points: [q, base[(k + 1) % 4]!, tip], mat: "bolt" as const })), { points: [...base].reverse(), mat: "bolt" }]);
}

/** A straight bar of rectangular section from a to b, `wide` across (b - a) x `up` and `deep` along `up`. */
function strut(p: Shape, a: Vec, b: Vec, wide: number, deep: number, up: Vec, mat: Mat): void {
  const d = unit(sub(b, a)), across = unit(cross(d, up)), over = unit(cross(across, d));
  const ring = (at: Vec): Vec[] => ([[1, -1], [1, 1], [-1, 1], [-1, -1]] as const).map(([s, t]) => add(at, add(scale(across, (s * wide) / 2), scale(over, (t * deep) / 2))));
  p.loft([ring(a), ring(b)], () => [mat, NO_UV], () => [mat, NO_UV]);
}

/** A prism along x from x0 to x1 whose two faces across y are bands of `mats` between the heights `zs`: a tall wall's girts from afar, in colour alone. */
function banded(p: Shape, x0: number, x1: number, half: number, zs: readonly number[], mats: (band: number) => Mat, edge: Mat): void {
  const faces: { points: Vec[]; mat: Mat; along: number }[] = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const [z0, z1] = [zs[i]!, zs[i + 1]!];
    faces.push({ points: [[x0, -half, z0], [x1, -half, z0], [x1, -half, z1], [x0, -half, z1]], mat: mats(i), along: 0 });
    faces.push({ points: [[x1, half, z0], [x0, half, z0], [x0, half, z1], [x1, half, z1]], mat: mats(i), along: 0 });
    faces.push({ points: [[x0, half, z0], [x0, -half, z0], [x0, -half, z1], [x0, half, z1]], mat: edge, along: 0 });
    faces.push({ points: [[x1, -half, z0], [x1, half, z0], [x1, half, z1], [x1, -half, z1]], mat: edge, along: 0 });
  }
  const [lo, hi] = [zs[0]!, zs[zs.length - 1]!];
  faces.push({ points: [[x0, half, lo], [x1, half, lo], [x1, -half, lo], [x0, -half, lo]], mat: edge, along: 0 });
  faces.push({ points: [[x0, -half, hi], [x1, -half, hi], [x1, half, hi], [x0, half, hi]], mat: edge, along: 0 });
  closed(p, faces);
}

/** How high a low wall's capping channel is. */
const COPING = 0.11;

/**
 * A half wall or a quarter wall: a framed panel under a capping channel, which runs over the end posts the wall's
 * whole length with its top's arrises taken off. Its top is its collider's, so a wall or a railing stands on it.
 */
function lowWall(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = frameOf(form);
  const p = new Shape();
  if (level === 3) return p.box([-f.hx, -FACE, f.foot], [f.hx, FACE, f.top], walled);
  const [sill, cap, in0, in1] = [f.foot + SILL, f.top - COPING, -f.hx + POST, f.hx - POST];
  const coping = (): void => {
    const from = p.faces.length;
    if (level === 2) p.box([-f.hx, -FACE, cap], [f.hx, FACE, f.top], tone("frame"));
    else p.extrude([[-FACE, cap], [FACE, cap], [FACE, f.top - BEVEL], [FACE - BEVEL, f.top], [-(FACE - BEVEL), f.top], [-FACE, f.top - BEVEL]], "x", -f.hx, f.hx, tone("frame"));
    prismatic(p, from, 0);
  };
  if (level === 2) {
    p.box([-f.hx, -FACE, f.foot], [in0, FACE, cap], tone("frame"));
    p.box([in1, -FACE, f.foot], [f.hx, FACE, cap], tone("frame"));
    p.box([in0, -FACE, f.foot], [in1, FACE, sill], tone("frame"));
    p.box([in0, -SKIN, sill - 0.01], [in1, SKIN, cap + 0.01], tone("plate"));
    coping();
    return p;
  }
  stile(p, -f.hx, in0, f.foot, cap, "high", FACE, "frame");
  stile(p, in1, f.hx, f.foot, cap, "low", FACE, "frame");
  rail(p, in0, in1, f.foot, sill, "up", FACE, "frame");
  p.box([in0, -SKIN, sill - 0.01], [in1, SKIN, cap + 0.01], tone("plate"));
  coping();
  // A panel too low for gussets has a rib on every sheet's joint.
  const tall = cap - sill > 0.8;
  const marks = tall ? [-GRID, GRID] : [-GRID, 0, GRID];
  for (const x of marks) stile(p, x - 0.04, x + 0.04, sill - 0.01, cap + 0.01, "both", RIB);
  if (tall) for (const [x, sx] of [[in0, 1], [in1, -1]] as const) {
    gusset(p, 1, x, sill, sx, 1, 0.2);
    gusset(p, 1, x, cap, sx, -1, 0.2);
  }
  if (level === 0) {
    nuts(p, [-0.75, -0.25, 0.25, 0.75].flatMap((k): Cell[] => [[k * f.hx, f.foot + 0.085], [k * f.hx, f.top - 0.06]]), FACE);
    nuts(p, marks.map((x): Cell => [x, (sill + cap) / 2]), RIB);
  }
  return p;
}

/** Half the depth of a tall wall's girt. */
const GIRT = 0.1;

/**
 * A wall several storeys high in one piece: a plate curtain between two posts the whole height, with a heavy girt on
 * each storey's line, a rail across the middle of each storey and two ribs from sill to head, all on the sheets' joints.
 * It is opaque at every level and its top is its collider's.
 */
function tallWall(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = frameOf(form);
  const p = new Shape();
  if (level === 3) return p.box([-f.hx, -FACE, f.foot], [f.hx, FACE, f.top], walled);
  const storeys = Math.max(1, Math.round((f.top - f.foot) / (2 * H)));
  const bounds = Array.from({ length: storeys + 1 }, (_, i) => f.foot + ((f.top - f.foot) * i) / storeys);
  const lines = bounds.slice(1, -1);
  if (level === 2) {
    // One prism the wall's length, its girts bands of the frame's colour: a girt is 3 pixels at 60 m and its relief none.
    banded(p, -f.hx, f.hx, FACE, [f.foot, ...lines.flatMap((z) => [z - GIRT, z + GIRT]), f.top], (band) => (band % 2 === 0 ? "plate" : "frame"), "frame");
    return p;
  }
  const [sill, head, in0, in1] = [f.foot + SILL, f.top - HEAD, -f.hx + POST, f.hx - POST];
  const plain = level === 1;
  const across = (z0: number, z1: number, bevel: "up" | "down" | "both", face: number, mat: Mat): void => (plain ? void p.box([in0, -face, z0], [in1, face, z1], tone(mat)) : rail(p, in0, in1, z0, z1, bevel, face, mat));
  if (plain) {
    p.box([-f.hx, -FACE, f.foot], [in0, FACE, f.top], tone("frame"));
    p.box([in1, -FACE, f.foot], [f.hx, FACE, f.top], tone("frame"));
  } else {
    stile(p, -f.hx, in0, f.foot, f.top, "high", FACE, "frame");
    stile(p, in1, f.hx, f.foot, f.top, "low", FACE, "frame");
  }
  across(f.foot, sill, "up", FACE, "frame");
  across(head, f.top, "down", FACE, "frame");
  p.box([in0, -SKIN, sill - 0.01], [in1, SKIN, head + 0.01], tone("plate"));
  for (const z of lines) across(z - GIRT, z + GIRT, "both", FACE, "trim");
  for (let i = 0; i < storeys; i++) across((bounds[i]! + bounds[i + 1]!) / 2 - 0.045, (bounds[i]! + bounds[i + 1]!) / 2 + 0.045, "both", RIB, "trim");
  for (const x of [-GRID, GRID]) {
    if (plain) p.box([x - 0.04, -RIB, sill - 0.01], [x + 0.04, RIB, head + 0.01], tone("trim"));
    else stile(p, x - 0.04, x + 0.04, sill - 0.01, head + 0.01, "both", RIB);
  }
  if (plain) return p;
  for (const [x, sx] of [[in0, 1], [in1, -1]] as const) {
    gusset(p, 1, x, sill, sx, 1);
    gusset(p, 1, x, head, sx, -1);
  }
  if (level === 0) {
    nuts(p, lines.flatMap((z) => [-0.75, -0.25, 0.25, 0.75].map((k): Cell => [k * f.hx, z])), FACE);
    nuts(p, [-0.25, 0.25].flatMap((k): Cell[] => [[k * f.hx, f.foot + 0.085], [k * f.hx, f.top - 0.06]]), FACE);
    nuts(p, [[in0 + 0.08, sill + 0.08], [in1 - 0.08, sill + 0.08], [in0 + 0.08, head - 0.08], [in1 - 0.08, head - 0.08]], GUSSET);
  }
  return p;
}

/**
 * A doorway two leaves wide across two edges: a portal of box-section jambs under a deep lintel whose ends run past
 * them, in a wall's frame, with a rib on the joint beside each jamb and a king post over the lintel.
 */
function portal(form: FormDef, level: number): Shape | null {
  if (level > 4) return null;
  const f = frameOf(form);
  const o = { x0: form.openings![0]!.x0 - form.at[0], x1: form.openings![0]!.x1 - form.at[0], z1: form.openings![0]!.y1 - form.at[1] };
  const p = new Shape();
  if (level === 4) return p.box([-f.hx, -FACE, f.foot], [f.hx, FACE, f.top], walled);
  if (level === 3) {
    const outline: Cell[] = [[f.foot, -f.hx], [f.foot, o.x0], [o.z1, o.x0], [o.z1, o.x1], [f.foot, o.x1], [f.foot, f.hx], [f.top, f.hx], [f.top, -f.hx]];
    return p.extrude(outline.reverse(), "y", -FACE, FACE, walled);
  }
  const [sill, head, in0, in1] = [f.foot + SILL, f.top - HEAD, -f.hx + POST, f.hx - POST];
  const [jamb, lintel] = [0.2, 0.24];
  const [ja, jb, top] = [o.x0 - jamb, o.x1 + jamb, o.z1 + lintel];
  const plain = level === 2;
  const box = (x0: number, x1: number, z0: number, z1: number, face: number, mat: Mat): void => void p.box([x0, -face, z0], [x1, face, z1], tone(mat));
  const across = (x0: number, x1: number, z0: number, z1: number, bevel: "up" | "down" | "both", mat: Mat = "trim", face = FACE): void => (plain ? box(x0, x1, z0, z1, face, mat) : rail(p, x0, x1, z0, z1, bevel, face, mat));
  const upright = (x0: number, x1: number, z0: number, z1: number, bevel: "low" | "high" | "both", mat: Mat = "trim", face = FACE): void => (plain ? box(x0, x1, z0, z1, face, mat) : stile(p, x0, x1, z0, z1, bevel, face, mat));
  upright(-f.hx, in0, f.foot, f.top, "high", "frame");
  upright(in1, f.hx, f.foot, f.top, "low", "frame");
  across(in0, in1, head, f.top, "down", "frame");
  across(in0, ja, f.foot, sill, "up", "frame");
  across(jb, in1, f.foot, sill, "up", "frame");
  upright(ja, o.x0, f.foot, o.z1 + 0.01, "low");
  upright(o.x1, jb, f.foot, o.z1 + 0.01, "high");
  across(ja - 0.12, jb + 0.12, o.z1, top, "both");
  box(in0, ja + 0.01, sill - 0.01, head + 0.01, SKIN, "plate");
  box(jb - 0.01, in1, sill - 0.01, head + 0.01, SKIN, "plate");
  box(ja, jb, top - 0.01, head + 0.01, SKIN, "plate");
  if (plain) return p;
  // Ribs and rails are plain bar past the finest level.
  const fine = level === 0;
  const mid = (in0 + ja) / 2;
  for (const x of [mid, -mid]) {
    if (fine) stile(p, x - 0.04, x + 0.04, sill - 0.01, head + 0.01, "both", RIB);
    else box(x - 0.04, x + 0.04, sill - 0.01, head + 0.01, RIB, "trim");
  }
  for (const [x0, x1] of [[in0, ja + 0.01], [jb - 0.01, in1]] as const) {
    if (fine) rail(p, x0, x1, -0.045, 0.045, "both", RIB);
    else box(x0, x1, -0.045, 0.045, RIB, "trim");
  }
  for (const x of [-GRID, 0, GRID]) {
    if (fine) stile(p, x - 0.04, x + 0.04, top - 0.01, head + 0.01, "both", RIB);
    else box(x - 0.04, x + 0.04, top - 0.01, head + 0.01, RIB, "trim");
  }
  for (const [x, sx] of [[in0, 1], [in1, -1]] as const) {
    gusset(p, 1, x, sill, sx, 1);
    gusset(p, 1, x, head, sx, -1);
  }
  if (!fine) return p;
  const band = (o.z1 + top) / 2;
  nuts(p, [[ja + jamb / 2, band], [jb - jamb / 2, band], [-GRID, band], [0, band], [GRID, band]], FACE);
  nuts(p, [-5, -1, 1, 5].map((k): Cell => [(k * f.hx) / 8, f.top - 0.06]), FACE);
  nuts(p, [[-mid - 0.375, f.foot + 0.085], [-mid + 0.375, f.foot + 0.085], [mid - 0.375, f.foot + 0.085], [mid + 0.375, f.foot + 0.085]], FACE);
  nuts(p, [ja + jamb / 2, jb - jamb / 2].flatMap((x): Cell[] => [[x, f.foot + 0.1], [x, 0]]), FACE);
  nuts(p, [[-mid, 0], [mid, 0], [-mid, head - 0.07], [mid, head - 0.07]], RIB);
  // The pintles each leaf hangs on, on its own jamb.
  const half = (f.foot + o.z1) / 2;
  for (const [x, s] of [[o.x0, 1], [o.x1, -1]] as const) for (const z of [half - 0.72, half + 0.72]) p.box([Math.min(x - s * 0.004, x + s * 0.012), -0.085, z - 0.05], [Math.max(x - s * 0.004, x + s * 0.012), -0.04, z + 0.05], tone("bolt"));
  return p;
}

/**
 * The gateway: two H-columns on blocks and a plate girder across them, the piece a raid looks at first. Each column is
 * two flanges the wall's thickness with a web set back between them and stiffeners across it on the sheets' joints;
 * the girder is two flanges over a web with a stiffener every sheet, and a marker stripe along its foot over the
 * opening. The outer flange is the band the gateway's end yields by. From 386 m it is a flat frame seen from both
 * faces: twelve triangles cannot be a closed frame, and a box would shut the opening.
 */
function gateway(form: FormDef, level: number): Shape | null {
  if (level > 4) return null;
  const f = frameOf(form);
  const p = new Shape();
  const o = form.openings![0]!;
  const [xa, xb, zo] = [o.x0 - form.at[0], o.x1 - form.at[0], o.y1 - form.at[1]];
  const half = form.thick / 2;
  if (level >= 3) {
    const outline: Cell[] = [[f.foot, -f.hx], [f.foot, xa], [zo, xa], [zo, xb], [f.foot, xb], [f.foot, f.hx], [f.top, f.hx], [f.top, -f.hx]];
    if (level === 3) return p.extrude([...outline].reverse(), "y", -half, half, walled);
    const tris = [0, 1, 2, 0, 2, 7, 2, 3, 7, 3, 6, 7, 3, 5, 6, 3, 4, 5];
    for (const y of [-1, 1]) {
      const points = outline.map(([z, x]): Vec => [x, 0, z]);
      p.faces.push({ points, uvs: points.map(() => NO_UV), mat: "frame", tris: y < 0 ? tris : tris.flatMap((_, i) => (i % 3 === 0 ? [tris[i]!, tris[i + 2]!, tris[i + 1]!] : [])) });
    }
    p.error = half;
    return p;
  }
  const band = form.yieldBand || POST;
  const [flange, web, deep] = [0.1, half - 0.07, 0.09];
  const block = 0.45;
  for (const [s, x0, x1] of [[-1, -f.hx, xa], [1, xb, f.hx]] as const) {
    const outer = s < 0 ? x0 : x1;
    const within = (a: number, b: number): [number, number] => [Math.min(outer - s * a, outer - s * b), Math.max(outer - s * a, outer - s * b)];
    const wide = Math.abs(x1 - x0);
    const col = (span: [number, number], y: number, z0: number, z1: number, mat: Mat): void => void p.box([span[0], -y, z0], [span[1], y, z1], tone(mat));
    // The outer flange to the top, the inner one to the girder's foot, the web between, on a block.
    col(within(0, band), half, f.foot, f.top, "frame");
    col(within(wide - flange, wide), half, f.foot, zo, "frame");
    col(within(band, wide - flange), web, f.foot + block - 0.01, zo + 0.01, "plate");
    col(within(band, wide), half, f.foot, f.foot + block, "trim");
    if (level === 2) continue;
    const mid = within(band, wide - flange);
    const rows = [1.5, 3, 4.5].map((up) => f.foot + up).filter((z) => z < zo - 0.3);
    for (const z of rows) col(mid, half - 0.03, z - 0.03, z + 0.03, "trim");
    if (level > 0) continue;
    const xm = (mid[0] + mid[1]) / 2;
    for (const y of [-1, 1]) {
      for (const z of rows) for (const dx of [-0.08, 0.08]) stud(p, [xm + dx, y * (half - 0.03), z], [0, y, 0], 0.018, 0.01);
      for (const dx of [-0.11, 0.11]) for (const z of [f.foot + 0.12, f.foot + block - 0.1]) stud(p, [xm + dx - s * 0.03, y * half, z], [0, y, 0], 0.024, 0.013);
    }
    // The plates the gate's hinges bolt to, on the front of the inner flange.
    for (const z of [f.foot + 0.9, (f.foot + zo) / 2, zo - 0.9]) {
      const span = within(wide - flange + 0.012, wide - 0.012);
      p.box([span[0], -half - 0.012, z - 0.13], [span[1], -half + 0.004, z + 0.13], tone("bolt"));
    }
  }
  const [g0, g1] = [-f.hx + band, f.hx - band];
  p.box([g0, -half, zo], [g1, half, zo + deep], tone("frame"));
  p.box([g0, -half, f.top - deep], [g1, half, f.top], tone("frame"));
  p.box([g0, -web, zo + deep - 0.01], [g1, web, f.top - deep + 0.01], tone("plate"));
  if (level === 2) return p;
  const marks: number[] = [];
  for (let x = 0; x < xb - 0.2; x += GRID) marks.push(...(x === 0 ? [0] : [-x, x]));
  for (const x of marks) p.box([x - 0.03, -half + 0.03, zo + deep - 0.005], [x + 0.03, half - 0.03, f.top - deep + 0.005], tone("trim"));
  // The clearance stripe, on both faces of the girder's foot.
  const proud = level === 0 ? 0.004 : 0.002;
  p.box([xa + 0.02, -half - proud, zo + 0.02], [xb - 0.02, half + proud, zo + deep - 0.02], tone("nosing"));
  if (level > 0) return p;
  for (const y of [-1, 1]) for (const x of marks) {
    stud(p, [x, y * half, f.top - deep / 2], [0, y, 0], 0.022, 0.012);
    stud(p, [x, y * (half - 0.03), (zo + f.top) / 2], [0, y, 0], 0.018, 0.01);
  }
  return p;
}

/**
 * The gate: two leaves that meet in the middle, each plate in a frame of bar as thick as the leaf, with a rail on every
 * second joint, two braces crossed from corner to corner behind the rails, three strap hinges on its hung side and a
 * marker stripe along its foot. A drop bar lies across the back of both. The front is -y.
 */
function gate(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = frameOf(form);
  const p = new Shape();
  const half = form.thick / 2;
  if (level === 3) return p.box([-f.hx, -half, f.foot], [f.hx, half, f.top], tone("plate"));
  const [foot, top] = [f.foot + 0.02, f.top - 0.015];
  const [bar0, skin, brace] = [0.16, 0.03, half - 0.03];
  for (const [x0, x1, hinge] of [[-f.hx + 0.012, -0.005, -1], [0.005, f.hx - 0.012, 1]] as const) {
    if (level === 2) {
      p.framed([x0, -half, foot], [x1, half, top], [x0 + bar0, foot + bar0, x1 - bar0, top - bar0], tone("trim"), tone("plate"));
      continue;
    }
    const flat = (a: number, b: number, z0: number, z1: number, y = half, mat: Mat = "trim"): void => void p.box([a, -y, z0], [b, y, z1], tone(mat));
    flat(x0 + 0.01, x1 - 0.01, foot + 0.01, top - 0.01, skin, "plate");
    flat(x0, x0 + bar0, foot, top);
    flat(x1 - bar0, x1, foot, top);
    flat(x0 + bar0 - 0.005, x1 - bar0 + 0.005, foot, foot + bar0 + 0.04);
    flat(x0 + bar0 - 0.005, x1 - bar0 + 0.005, top - bar0, top);
    // The braces, a little behind the frame's faces, from each corner inside the frame to the one across.
    const [a, b, c, d]: Vec[] = [[x0 + bar0, 0, foot + bar0], [x1 - bar0, 0, top - bar0], [x0 + bar0, 0, top - bar0], [x1 - bar0, 0, foot + bar0]];
    strut(p, a, b, 0.14, 2 * brace, [0, 1, 0], "trim");
    strut(p, c, d, 0.14, 2 * brace - 0.01, [0, 1, 0], "trim");
    flat(x0 + bar0 + 0.01, x1 - bar0 - 0.01, foot + 0.07, foot + 0.14, half + (level === 0 ? 0.003 : 0.002), "nosing");
    if (level === 1) continue;
    // Rails on the sheets' joints a storey apart, counted from the gate's middle.
    const rails = [-1.5, 0, 1.5].filter((z) => z > foot + 0.6 && z < top - 0.6);
    for (const z of rails) flat(x0 + bar0 - 0.005, x1 - bar0 + 0.005, z - 0.06, z + 0.06);
    const hung = hinge < 0 ? x0 : x1;
    for (const z of rails) {
      const tip = hung - hinge * 1.1;
      const outline: Cell[] = [[hung, z - 0.07], [tip + hinge * 0.2, z - 0.04], [tip, z], [tip + hinge * 0.2, z + 0.04], [hung, z + 0.07]];
      p.extrude(outline.map(([x, zz]) => [zz, x] as const), "y", -half - 0.012, -half + 0.004, tone("bolt"));
      p.box([Math.min(hung, hung + hinge * 0.03) - 0.006, -half - 0.035, z - 0.11], [Math.max(hung, hung + hinge * 0.03) + 0.006, -half + 0.004, z + 0.11], tone("bolt"));
      for (const along of [0.3, 0.8]) stud(p, [hung - hinge * along, -half - 0.012, z], [0, -1, 0], 0.016, 0.009);
    }
    const [xl, xr] = [x0 + bar0 / 2, x1 - bar0 / 2];
    for (const y of [-1, 1]) for (const [x, z] of [[xl, foot + 0.08], [xr, foot + 0.08], [xl, top - 0.08], [xr, top - 0.08]] as const) stud(p, [x, y * half, z], [0, y, 0], 0.024, 0.013);
  }
  if (level === 0) {
    // The drop bar across the back, in a keeper on each leaf.
    const z = f.foot + 1.3;
    p.box([-f.hx * 0.55, half, z - 0.07], [f.hx * 0.55, half + 0.04, z + 0.07], tone("trim"));
    for (const x of [-f.hx * 0.4, f.hx * 0.4]) p.box([x - 0.05, half - 0.004, z - 0.1], [x + 0.05, half + 0.045, z + 0.1], tone("bolt"));
  }
  return p;
}

/** A wall-family form's frame from any outline that stands on a level foot about its edge's middle: a sloped wall's is its box's. */
function boxFrame(form: FormDef): Frame {
  const [u0, v0, u1, v1] = outlineBox(form);
  return { hx: (u1 - u0) / 2, foot: v0 - form.at[1], top: v1 - form.at[1] };
}

/**
 * The gable under a roof's sloped side: a post at its high end, a sill, plate, a rake of bar under its top and a rib
 * on each joint, built as a wall whose top runs level and cut by the plane its outline's top lies in. So its top is in
 * that plane to the last bit. It is built high at its -x end, and the other hand is that one in a mirror.
 */
function gable(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = boxFrame(form);
  const p = new Shape();
  const right = form.outline.some(([u, v]) => v - form.at[1] > f.foot + 1e-9 && u > form.at[0]);
  const rise = f.top - f.foot;
  const slope = planeAt([f.hx, 0, f.foot], [rise, 0, 2 * f.hx]);
  const at = (x: number): number => f.foot + (rise * (f.hx - x)) / (2 * f.hx);
  const done = (): Shape => (right ? mirror(p, 0) : p);
  if (level === 3) {
    p.extrude([[f.top, -f.hx], [f.foot, f.hx], [f.foot, -f.hx]], "y", -FACE, FACE, walled);
    return done();
  }
  const [sill, in0] = [f.foot + SILL, -f.hx + POST];
  const deep = 0.16 * Math.hypot(1, rise / (2 * f.hx));
  const rake = FACE - 0.01;
  if (level === 2) {
    // Between its rings, each part on the outline it has under the slope, and the post in the high end's band. The
    // low end's band holds a sliver 5 cm high, which is not drawn from 60 m.
    const band = form.yieldBand || POST;
    const [xa, xb] = [-f.hx + band, f.hx - band];
    const where = (z: number): number => f.hx - ((z - f.foot) * 2 * f.hx) / rise;
    const part = (points: readonly Cell[], half: number, mat: Mat): void => void p.extrude(points.map(([x, z]) => [z, x] as const), "y", -half, half, tone(mat));
    part([[-f.hx, f.foot], [xa, f.foot], [xa, at(xa) - 0.004], [-f.hx, f.top - 0.004]], FACE, "frame");
    part([[xa, f.foot], [xb, f.foot], [xb, at(xb) - 0.004], [where(sill) , sill], [xa, sill]], FACE, "frame");
    part([[xa, f.foot + 0.01], [xb, f.foot + 0.01], [xb, at(xb) - 0.01], [xa, at(xa) - 0.01]], SKIN, "plate");
    part([[xa, at(xa)], [xa, at(xa) - deep], [where(f.foot + deep), f.foot], [xb, f.foot], [xb, at(xb)]], rake, "trim");
    return done();
  }
  const over = f.top + 0.1;
  stile(p, -f.hx, in0, f.foot, over, "high", FACE, "frame");
  rail(p, in0, f.hx, f.foot, sill, "up", FACE, "frame");
  p.box([in0, -SKIN, sill - 0.01], [f.hx, SKIN, over], tone("plate"));
  for (const x of [-GRID, 0]) if (at(x) - deep - sill > 0.15) stile(p, x - 0.04, x + 0.04, sill - 0.01, at(x), "both", RIB);
  gusset(p, 1, in0, sill, 1, 1, 0.2);
  // All but the rake ends 4 mm under the top's plane, so the top is the rake's own face and no two lie in it.
  clip(p, planeMoved(slope, -0.004));
  // The rake: bar along the slope, a little back from the post's faces, built over the plane and cut to it.
  const ring = (x: number): Vec[] => [[x, -rake, at(x) - deep], [x, rake, at(x) - deep], [x, rake, at(x) + 0.05], [x, -rake, at(x) + 0.05]];
  p.loft([ring(-f.hx - 0.2), ring(f.hx + 0.2)], () => ["trim", NO_UV], () => ["trim", NO_UV]);
  clip(p, slope);
  clip(p, planeAt([-f.hx, 0, 0], [-1, 0, 0]));
  clip(p, planeAt([f.hx, 0, 0], [1, 0, 0]));
  clip(p, planeAt([0, 0, f.foot], [0, 0, -1]));
  if (level === 0) {
    nuts(p, [-0.75, -0.25, 0.25].map((k): Cell => [k * f.hx, f.foot + 0.085]), FACE);
    nuts(p, [-0.6, -0.1, 0.4].map((k): Cell => [k * f.hx, at(k * f.hx) - deep / 2 - 0.01]), rake);
    nuts(p, [[-f.hx + POST / 2, (sill + f.top) / 2 - 0.1]], FACE);
    nuts(p, [[in0 + 0.07, sill + 0.07]], GUSSET);
  }
  return done();
}

/**
 * A railing of welded tube: a hand rail and a knee rail the whole length, posts on base plates on the sheets' joints,
 * half a post at each end that the next railing makes whole, and a kick plate along its foot.
 */
function railing(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = frameOf(form);
  const p = new Shape();
  const deep = Math.min(0.03, form.thick / 2 - 0.02);
  const [hand, knee] = [f.top - 0.06, (f.foot + f.top) / 2];
  bar(p, [-f.hx, -deep, hand], [f.hx, deep, f.top], tone("trim"));
  if (level === 3) return p;
  bar(p, [-f.hx, -0.02, knee - 0.02], [f.hx, 0.02, knee + 0.02], tone("trim"));
  bar(p, [-f.hx, -0.01, f.foot + 0.02], [f.hx, 0.01, f.foot + 0.15], tone("plate"));
  const posts = level === 2 ? [-GRID, GRID] : [-GRID, 0, GRID];
  for (const x of posts) p.box([x - 0.025, -0.025, f.foot], [x + 0.025, 0.025, hand + 0.004], tone("trim"));
  if (level === 2) return p;
  const end = Math.min(0.025, form.yieldBand || 0.025);
  for (const s of [-1, 1]) p.box([Math.min(s * f.hx, s * (f.hx - end)), -0.025, f.foot], [Math.max(s * f.hx, s * (f.hx - end)), 0.025, hand + 0.004], tone("trim"));
  if (level === 1) return p;
  for (const x of posts) {
    p.box([x - 0.07, -form.thick / 2, f.foot], [x + 0.07, form.thick / 2, f.foot + 0.012], tone("trim"));
    for (const dx of [-0.05, 0.05]) nut(p, [x + dx, 0, f.foot + 0.012], [0, 0, 1], 0.014, 0.01);
  }
  return p;
}

/**
 * A thin pillar: an H-column, two flanges and a web between a base plate and a cap plate, with a stiffener across the
 * web at its middle. The cap plate stands under the floor the pillar carries, as the pillar's does.
 */
function hColumn(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [u0, , u1] = outlineBox(form);
  const half = (u1 - u0) / 2;
  const hz = form.thick / 2;
  const [reach, flange, web, plate] = [half * 0.8, 0.026, 0.012, 0.035];
  const top = hz - 0.012;
  if (level === 3) return p.box([-reach, -reach, -hz], [reach, reach, top], tone("trim"));
  for (const s of [-1, 1]) p.box([-reach, Math.min(s * reach, s * (reach - flange)), -hz + plate - 0.005], [reach, Math.max(s * reach, s * (reach - flange)), top], tone("trim"));
  p.box([-web, -reach + flange - 0.004, -hz + plate - 0.005], [web, reach - flange + 0.004, top], tone("plate"));
  if (level === 2) return p;
  const cap = hz - FLOOR;
  p.box([-half, -half, -hz], [half, half, -hz + plate], tone("trim"));
  p.box([-half, -half, cap - plate], [half, half, cap], tone("trim"));
  p.box([-reach + 0.004, -reach + flange - 0.002, -0.012], [reach - 0.004, reach - flange + 0.002, 0.012], tone("trim"));
  if (level === 0) {
    const at = reach * 0.58;
    for (const s of [-1, 1]) for (const x of [-at, at]) nut(p, [x, 0, s < 0 ? -hz + plate : cap - plate], [0, 0, -s], 0.018, 0.012);
    for (const s of [-1, 1]) for (const z of [-0.09, 0.09]) nut(p, [0, s * reach, z], [0, s, 0], 0.016);
  }
  return p;
}

/**
 * A beam: an I-section, flanges over and under a web, between two end plates that are the whole of it in its yield
 * band, with a stiffener across the web on each sheet's joint.
 */
function iBeam(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = frameOf(form);
  const p = new Shape();
  const half = form.thick / 2;
  if (level === 3) return p.box([-f.hx, -half, f.foot], [f.hx, half, f.top], tone("trim"));
  const band = form.yieldBand || POST;
  const [in0, in1, flange, web] = [-f.hx + band, f.hx - band, 0.04, 0.02];
  p.box([in0, -half, f.top - flange], [in1, half, f.top], tone("trim"));
  p.box([in0, -half, f.foot], [in1, half, f.foot + flange], tone("trim"));
  p.box([in0, -web, f.foot + flange - 0.005], [in1, web, f.top - flange + 0.005], tone("plate"));
  for (const s of [-1, 1]) p.box([Math.min(s * f.hx, s * in1), -half, f.foot], [Math.max(s * f.hx, s * in1), half, f.top], tone("trim"));
  if (level === 2) return p;
  const marks: number[] = [0];
  for (let x = GRID; x < in1 - 0.2; x += GRID) marks.push(-x, x);
  for (const x of marks) p.box([x - 0.012, -half + 0.02, f.foot + flange - 0.003], [x + 0.012, half - 0.02, f.top - flange + 0.003], tone("trim"));
  if (level === 0) nuts(p, marks.flatMap((x): Cell[] => [[x - GRID / 2, (f.foot + f.top) / 2], [x + GRID / 2, (f.foot + f.top) / 2]]).filter(([x], k, all) => Math.abs(x) < in1 - 0.1 && all.findIndex((q) => Math.abs(q[0] - x) < 1e-9) === k), web);
  return p;
}

/**
 * A ramp up toward -y (the engine's +Z), solid underneath as the collision is: a deck of plate with a grip bar across
 * it every third of a metre and a marker stripe at its foot and its head, a stringer up each side a little over the
 * deck, and its cheeks and back framed as the stairs' are.
 */
function ramp(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const plan = planOf(form);
  const tops = form.corner!.map((h) => h - form.at[1]);
  const [lo, hi] = [Math.min(...tops), Math.max(...tops)];
  const [x0, x1, y0, y1] = [Math.min(...plan.map((q) => q[0])), Math.max(...plan.map((q) => q[0])), Math.min(...plan.map((q) => q[1])), Math.max(...plan.map((q) => q[1]))];
  const run = y1 - y0;
  const k = Math.hypot(run, hi - lo) / run;
  const at = (y: number): number => lo + ((hi - lo) * (y1 - y)) / run;
  const body = slab("trim", "plate");
  if (level === 3) return p.extrude([[y1, lo], [y0, hi], [y0, lo]], "x", x0, x1, body);
  const s = x1 - 0.07;
  const rear = y0 + 0.05;
  p.extrude([[rear, lo], [y1, lo], [rear, at(rear)]], "x", x0 + 0.07, s, body);
  // A stringer up each side, from the floor at the foot to the head, 12 mm over the deck.
  const [over, deep, proud] = [level === 0 ? 0.012 : 0, 0.3, level === 0 ? 0.006 : 0.002];
  const stringer: Cell[] = [[y1, lo], [y1, lo + over], [y0, hi + over], [y0, hi - deep], [y1 - (deep * run) / (hi - lo), lo]];
  for (const [a, b] of [[x0, x0 + 0.07], [s, x1]] as const) p.extrude(stringer, "x", a, b, tone("trim"));
  if (level === 2) return p;
  // A point `t` metres up the slope from its foot and `n` over it.
  const on = (x: number, t: number, n: number): Vec => [x, y1 - t / k - (n * (hi - lo)) / (run * k), lo + (t * (hi - lo)) / (run * k) + n / k];
  const length = run * k;
  const across = (t0: number, t1: number, n: number, mat: Mat, section?: readonly Cell[]): void => {
    const shape = section ?? [[t0, -0.01], [t1, -0.01], [t1, n], [t0, n]];
    p.loft([x0 + 0.074, s - 0.004].map((x) => shape.map(([t, h]) => on(x, t, h))), () => [mat, NO_UV], () => [mat, NO_UV]);
  };
  across(0.02, 0.1, proud, "nosing");
  across(length - 0.12, length - 0.04, proud, "nosing");
  // The back and the cheeks are framed as the stairs' are.
  for (const [a, b] of [[x0, x0 + 0.1], [x1 - 0.1, x1]] as const) p.box([a, y0, lo], [b, y0 + 0.1, hi - 0.004], tone("trim"));
  p.box([x0 + 0.07, y0, lo], [s, y0 + 0.058, lo + SILL], tone("trim"));
  p.box([x0 + 0.07, y0, hi - HEAD], [s, y0 + 0.058, hi - 0.004], tone("trim"));
  p.box([x0 + 0.07, y0 + 0.012, (lo + hi) / 2 - 0.045], [s, y0 + 0.062, (lo + hi) / 2 + 0.045], tone("trim"));
  for (const x of [-GRID, GRID]) p.box([x - 0.04, y0 + 0.016, lo + SILL - 0.01], [x + 0.04, y0 + 0.058, hi - HEAD + 0.01], tone("trim"));
  for (const sx of [-1, 1]) {
    const [a, b] = sx < 0 ? [x0, x0 + 0.074] : [s - 0.004, x1];
    p.box([a, y0 + 0.1, lo], [b, y1 - 0.4, lo + 0.12], tone("trim"));
    const mid = (y0 + y1) / 2;
    p.box([a + (sx < 0 ? 0.012 : 0), mid - 0.05, lo + 0.12], [b - (sx < 0 ? 0 : 0.012), mid + 0.05, at(mid) - deep + 0.05], tone("trim"));
  }
  if (level === 1) return p;
  const bars = Math.round((length - 0.5) / 0.3);
  for (let i = 0; i < bars; i++) {
    const t = 0.3 + (i * (length - 0.6)) / (bars - 1);
    across(0, 0, 0, "trim", [[t - 0.014, -0.004], [t + 0.014, -0.004], [t, 0.01]]);
  }
  for (const sx of [-1, 1]) {
    for (let i = 1; i < 5; i++) nut(p, [sx * x1, y1 - (i * run) / 5, at(y1 - (i * run) / 5) - 0.12], [sx, 0, 0]);
    for (const z of [lo + 0.35, (lo + hi) / 2, hi - 0.35]) nut(p, [sx * (x1 - 0.035), y0, z], [0, -1, 0]);
  }
  for (const x of [-1.125, -0.375, 0.375, 1.125]) nut(p, [x, y0, lo + 0.09], [0, -1, 0]);
  return p;
}

/**
 * A strip of foundation under a wall where no floor is: a steel kerb. A plate along its top, a channel down each face
 * with its web set back, a block at each end that is the whole of it in its yield band, and a footing under its middle.
 */
function kerb(form: FormDef, level: number): Shape | null {
  if (level > 2) return null;
  const f = frameOf(form);
  const p = new Shape();
  const half = form.thick / 2;
  const top = slab("plate", "trim");
  if (level === 2) {
    bar(p, [-f.hx, -half, f.foot], [f.hx, half, f.top], top);
    return p;
  }
  const band = form.yieldBand || POST;
  const [in0, in1, under, pad, flange, web] = [-f.hx + band, f.hx - band, f.top - DECK, 0.1, 0.045, half - 0.045];
  bar(p, [-f.hx, -half, under], [f.hx, half, f.top], top);
  p.box([in0, -half, under - flange], [in1, half, under + 0.004], tone("trim"));
  p.box([in0, -half, f.foot + pad], [in1, half, f.foot + pad + flange], tone("trim"));
  p.box([in0, -web, f.foot + 0.02], [in1, web, under - flange + 0.004], tone("trim"));
  for (const s of [-1, 1]) p.box([Math.min(s * f.hx, s * in1), -half, f.foot], [Math.max(s * f.hx, s * in1), half, under + 0.004], tone("trim"));
  p.box([-0.15, -half, f.foot], [0.15, half, f.foot + pad + 0.012], tone("trim"));
  for (const x of [-GRID, GRID]) p.box([x - 0.012, -half + 0.004, f.foot + pad + flange - 0.005], [x + 0.012, half - 0.004, under - flange + 0.005], tone("trim"));
  if (level === 0) nuts(p, [-1.125, -0.375, 0.375, 1.125].map((x): Cell => [x, (f.foot + pad + under) / 2]), web);
  return p;
}

/**
 * A ladder of flat bar: two stringers on edge and a square rung every 0.3 m, turned to stand on its arris, held off
 * the wall by a bracket near each end of each stringer and one in its middle. It hangs on the wall's front, at -y.
 */
function ladder(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [u0, v0, u1, v1] = outlineBox(form);
  const [half, foot, top] = [(u1 - u0) / 2, v0 - form.at[1], v1 - form.at[1]];
  // The row's `off` is toward the engine's +Z, the recipe's -y: `near` is the side the wall is on.
  const [near, far] = [-(form.off ?? 0) + form.thick / 2, -(form.off ?? 0) - form.thick / 2];
  const [bar0, deep] = [0.024, Math.min(0.064, form.thick - 0.03)];
  const xs = half - bar0 / 2;
  for (const s of [-1, 1]) p.box([s * xs - bar0 / 2, far + 0.004, foot], [s * xs + bar0 / 2, far + 0.004 + deep, top], tone("trim"));
  if (level === 3) return p;
  const count = Math.max(1, Math.round((top - foot) / 0.3));
  const y = far + 0.004 + deep / 2;
  for (let i = 0; i < count; i++) {
    if (level === 2 && i % 3 !== 1) continue;
    const z = foot + ((i + 0.5) * (top - foot)) / count;
    const r = level === 2 ? 0.022 : 0.015;
    const section: Cell[] = level === 0 ? [[y - r, z], [y, z - r], [y + r, z], [y, z + r]] : [[y - r, z - r * 0.6], [y + r, z - r * 0.6], [y, z + r]];
    p.loft([-xs, xs].map((x) => section.map(([sy, sz]): Vec => [x, sy, sz])), () => ["plate", NO_UV], () => ["plate", NO_UV]);
  }
  if (level > 0) return p;
  // Brackets back to the wall, 3 cm past the ladder's own box where its row leaves a gap.
  for (const s of [-1, 1]) for (const z of [foot + 0.3, (foot + top) / 2, top - 0.3]) p.box([s * xs - bar0 / 2, far + deep, z - 0.02], [s * xs + bar0 / 2, near + 0.03, z + 0.02], tone("trim"));
  return p;
}

/** How far a hatch's leaf stands clear of its hole on each side. */
const HATCH_CLEAR = 0.004;
/** How wide the marker coaming round a hatch's hole is. */
const COAMING = 0.05;

/**
 * A ceiling with a hatch through it: deck plate round a hole on the sheets' joints, a marker coaming flush with the
 * deck round the hole, the ceiling's rim, and under the deck two trimmers the whole way across beside the hole with
 * two headers between them, their faces the hole's sides.
 */
function hatchFrame(form: FormDef, level: number): Shape | null {
  if (level > 4) return null;
  const p = new Shape();
  const o = form.openings![0]!;
  const [hx0, hx1, hy0, hy1] = [o.x0 - form.at[0], o.x1 - form.at[0], -(o.y1 - form.at[2]), -(o.y0 - form.at[2])];
  const [top, bottom] = [form.thick / 2, -form.thick / 2 + 0.01];
  const sides = slab("plate", "trim", "plate");
  const square: Cell[] = [[-H, -H], [H, -H], [H, H], [-H, H]];
  const hole = (grow: number): Cell[] => [[hx0 - grow, hy0 - grow], [hx1 + grow, hy0 - grow], [hx1 + grow, hy1 + grow], [hx0 - grow, hy1 + grow]];
  if (level === 4) return p.box([-H, -H, bottom], [H, H, top], sides);
  if (level === 3) return p.extrude(square, "z", bottom, top, sides, [hole(0)]);
  if (level === 2) {
    // Four slabs round the hole, each a prism along the way it runs.
    for (const [y0, y1] of [[-H, hy0], [hy1, H]] as const) bar(p, [-H, y0, bottom], [H, y1, top], sides, 0);
    for (const [x0, x1] of [[-H, hx0], [hx1, H]] as const) bar(p, [x0, hy0, bottom], [x1, hy1, top], sides, 0);
    return p;
  }
  const under = top - DECK;
  // The deck is four plates round the coaming, each a prism along the way it runs.
  const [inner, outer] = [hole(0), hole(COAMING)];
  for (const [y0, y1] of [[-H, outer[0]![1]], [outer[2]![1], H]] as const) bar(p, [-H, y0, under], [H, y1, top], sides, 0);
  for (const [x0, x1] of [[-H, outer[0]![0]], [outer[2]![0], H]] as const) bar(p, [x0, outer[0]![1], under], [x1, outer[2]![1], top], sides, 0);
  for (let k = 0; k < 4; k++) p.extrude([inner[k]!, inner[(k + 1) % 4]!, outer[(k + 1) % 4]!, outer[k]!], "z", under, top, tone("nosing"));
  // The ceiling's rim: two beams the whole side and two between them.
  const rim = 0.085;
  for (const s of [-1, 1]) {
    const [y0, y1] = s < 0 ? [-H, -H + rim] : [H - rim, H];
    bar(p, [-H, y0, bottom], [H, y1, under + 0.004], tone("trim"), 0);
    bar(p, [y0, -H + rim, bottom], [y1, H - rim, under + 0.004], tone("trim"), 1);
  }
  const trim = 0.07;
  for (const [x0, x1] of [[hx0 - trim, hx0], [hx1, hx1 + trim]] as const) bar(p, [x0, -H + rim - 0.004, bottom + 0.012], [x1, H - rim + 0.004, under + 0.004], tone("trim"), 1);
  for (const [y0, y1] of [[hy0 - trim, hy0], [hy1, hy1 + trim]] as const) p.box([hx0, y0, bottom + 0.012], [hx1, y1, under + 0.004], tone("trim"));
  if (level === 0) {
    for (const s of [-1, 1]) for (const at of [-1.125, -0.375, 0.375, 1.125]) nut(p, [at, s * (H - rim), (bottom + under) / 2], [0, -s, 0], 0.018, 0.01);
    for (const x of [hx0 - trim / 2, hx1 + trim / 2]) for (const y of [hy0 - 0.25, hy1 + 0.25]) nut(p, [x, y, bottom + 0.012], [0, 0, -1], 0.016, 0.01);
  }
  return p;
}

/**
 * The hatch's leaf: plate under a frame of flat bar with two bars crossed, a wheel on a hub over where they cross to
 * dog it shut, two strap hinges along its +y side (the engine's -Z) and two dogs at the other. It lies in its frame's
 * hole, its top a hair under the floor's and its wheel over it.
 */
function hatch(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [u0, v0, u1, v1] = outlineBox(form);
  const [x0, x1, y0, y1] = [u0 - form.at[0] + HATCH_CLEAR, u1 - form.at[0] - HATCH_CLEAR, -(v1 - form.at[2]) + HATCH_CLEAR, -(v0 - form.at[2]) - HATCH_CLEAR];
  const top = form.thick / 2 - 0.004;
  const bottom = -form.thick / 2;
  if (level === 3) return p.box([x0, y0, bottom], [x1, y1, top], slab("plate", "trim"));
  const [cx, cy, flat, wide] = [(x0 + x1) / 2, (y0 + y1) / 2, top - 0.008, 0.07];
  p.box([x0, y0, bottom], [x1, y1, flat], slab("plate", "trim"));
  // Two bars crossed over the plate, flush with its frame.
  p.box([x0 + wide, cy - wide / 2, flat - 0.004], [x1 - wide, cy + wide / 2, top], tone("trim"));
  p.box([cx - wide / 2, y0 + wide, flat - 0.004], [cx + wide / 2, y1 - wide, top - 0.001], tone("trim"));
  const hub = level === 2 ? 0.05 : 0.03;
  p.box([cx - hub, cy - hub, top - 0.004], [cx + hub, cy + hub, top + 0.036], tone("bolt"));
  if (level === 2) return p;
  for (const [a, b] of [[x0, x0 + wide], [x1 - wide, x1]] as const) p.box([a, y0, flat - 0.004], [b, y1, top], tone("trim"));
  for (const [a, b] of [[y0, y0 + wide], [y1 - wide, y1]] as const) p.box([x0 + wide, a, flat - 0.004], [x1 - wide, b, top], tone("trim"));
  // The wheel: two spokes at level 1, a rim round them at the finest.
  const [r, z] = [0.16, top + 0.024];
  p.box([cx - r, cy - 0.011, z - 0.008], [cx + r, cy + 0.011, z + 0.008], tone("bolt"));
  p.box([cx - 0.011, cy - r, z - 0.007], [cx + 0.011, cy + r, z + 0.007], tone("bolt"));
  if (level === 1) return p;
  const from = p.faces.length;
  p.ring([0, 0, 0], r, 0.012, tone("bolt"), 8, 3);
  place(p, (q) => [cx + q[0], cy - q[2], z + q[1]], from);
  for (const x of [x0 + 0.3, x1 - 0.3]) {
    const tip = y1 - 0.5;
    p.extrude([[x - 0.04, y1], [x - 0.024, tip + 0.12], [x, tip], [x + 0.024, tip + 0.12], [x + 0.04, y1]], "z", top - 0.002, top + 0.007, tone("bolt"));
    p.box([x - 0.06, y1 - 0.03, top - 0.004], [x + 0.06, y1, top + 0.02], tone("bolt"));
    p.box([x - 0.045, y0, top - 0.004], [x + 0.045, y0 + 0.09, top + 0.012], tone("bolt"));
  }
  for (const [x, y] of [[x0 + wide / 2, y0 + wide / 2], [x1 - wide / 2, y0 + wide / 2], [x0 + wide / 2, y1 - wide / 2], [x1 - wide / 2, y1 - wide / 2], [x0 + wide / 2, cy], [x1 - wide / 2, cy], [cx, y0 + wide / 2], [cx, y1 - wide / 2]] as const) stud(p, [x, y, top], [0, 0, 1], 0.016, 0.008);
  return p;
}

/**
 * A foundation of any rectangle: the raft the square one is, about its row's own outline. Deck plate, a dark block
 * under it, a channel round it with its web set back and a stiffener on each sheet's joint, on a footing at each corner.
 */
function raft(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const plan = planOf(form);
  const [x0, x1, y0, y1] = [Math.min(...plan.map((q) => q[0])), Math.max(...plan.map((q) => q[0])), Math.min(...plan.map((q) => q[1])), Math.max(...plan.map((q) => q[1]))];
  const [top, bottom] = [form.thick / 2, -form.thick / 2];
  const sides = slab("plate", "trim");
  if (level === 3) return p.box([x0, y0, bottom], [x1, y1, top], sides);
  const [under, pad] = [top - DECK, 0.1];
  if (level === 2) {
    p.box([x0, y0, bottom + pad], [x1, y1, top], sides);
    return p.box([x0 + 0.12, y0 + 0.12, bottom], [x1 - 0.12, y1 - 0.12, bottom + pad + 0.01], tone("dark"));
  }
  p.box([x0, y0, under], [x1, y1, top], sides);
  p.box([x0 + 0.07, y0 + 0.07, bottom], [x1 - 0.07, y1 - 0.07, under + 0.005], tone("dark"));
  const [flange, web, deep, block, footing] = [0.045, 0.045, 0.1, 0.13, 0.3];
  // The channel's section from a side's face inward, as (in, up).
  const section: Cell[] = [[0, bottom + pad], [0, bottom + pad + flange], [web, bottom + pad + flange], [web, under - flange], [0, under - flange], [0, under + 0.005], [deep, under + 0.005], [deep, bottom + pad]];
  for (const [at, s] of [[y0, 1], [y1, -1]] as const) p.extrude(section.map(([a, z]) => [at + s * a, z] as const), "x", x0 + block - 0.01, x1 - block + 0.01, tone("trim"));
  for (const [at, s] of [[x0, 1], [x1, -1]] as const) alongY(p, section.map(([a, z]) => [at + s * a, z] as const), y0 + block - 0.01, y1 - block + 0.01, tone("trim"));
  for (const [cx, sx] of [[x0, 1], [x1, -1]] as const) for (const [cy, sy] of [[y0, 1], [y1, -1]] as const) {
    const span = (c: number, s: number, size: number): [number, number] => [Math.min(c, c + s * size), Math.max(c, c + s * size)];
    const [fx, fy, bx, by] = [span(cx, sx, footing), span(cy, sy, footing), span(cx, sx, block), span(cy, sy, block)];
    p.box([fx[0], fy[0], bottom], [fx[1], fy[1], bottom + pad + 0.012], tone("trim"));
    p.box([bx[0], by[0], bottom + pad], [bx[1], by[1], under + 0.005], tone("trim"));
    if (level === 0) for (const [nx, ny] of [[cx + sx * 0.07, cy + sy * 0.22], [cx + sx * 0.22, cy + sy * 0.07]] as const) nut(p, [nx, ny, bottom + pad + 0.012], [0, 0, 1], 0.026, 0.016);
  }
  // Stiffeners in the channel's mouth on the sheets' joints, which are counted from the piece's origin.
  const marks = (a: number, b: number): number[] => Array.from({ length: Math.floor(b / GRID) - Math.ceil(a / GRID) + 1 }, (_, i) => (Math.ceil(a / GRID) + i) * GRID).filter((v) => v > a + footing && v < b - footing);
  const z = (bottom + pad + under) / 2;
  for (const at of marks(x0, x1)) for (const [c, s] of [[y0, 1], [y1, -1]] as const) {
    p.box([at - 0.012, Math.min(c + s * 0.004, c + s * (web + 0.01)), bottom + pad + flange - 0.005], [at + 0.012, Math.max(c + s * 0.004, c + s * (web + 0.01)), under - flange + 0.005], tone("trim"));
    if (level === 0) for (const d of [-GRID / 2, GRID / 2]) nut(p, [at + d, c + s * web, z], [0, -s, 0]);
  }
  for (const at of marks(y0, y1)) for (const [c, s] of [[x0, 1], [x1, -1]] as const) {
    p.box([Math.min(c + s * 0.004, c + s * (web + 0.01)), at - 0.012, bottom + pad + flange - 0.005], [Math.max(c + s * 0.004, c + s * (web + 0.01)), at + 0.012, under - flange + 0.005], tone("trim"));
    if (level === 0) for (const d of [-GRID / 2, GRID / 2]) nut(p, [c + s * web, at + d, z], [-s, 0, 0]);
  }
  return p;
}

/** How wide the margin bar round a triangle's deck is where its row gives no yield band. */
const MARGIN = 0.1;

/** A triangle's sides: each from corner k to the next, its length, the way along it and the way in from it. */
function sidesOf(plan: readonly Flat[]): { a: Flat; b: Flat; l: number; d: Flat; inward: Flat }[] {
  return plan.map((a, k) => {
    const b = plan[(k + 1) % plan.length]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { a, b, l, d: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], inward: [-(b[1] - a[1]) / l, (b[0] - a[0]) / l] };
  });
}

/** Builds along x from a side's first corner, y inward, and stands what was built on that side. */
function onSide(p: Shape, side: { a: Flat; d: Flat; inward: Flat }, build: () => void): void {
  const from = p.faces.length;
  build();
  place(p, (q) => [side.a[0] + side.d[0] * q[0] + side.inward[0] * q[1], side.a[1] + side.d[1] * q[0] + side.inward[1] * q[1], q[2]], from);
}

/**
 * A triangle's deck: plate cut to the triangle inside a margin bar along each side, flush with it. The sheets lie on
 * the piece's own grid, from its first corner along its first axis, so two sides cut them on the slant: the bar is
 * what they end against. The bar is the side's yield band where the row has one.
 */
function triDeck(p: Shape, plan: readonly Flat[], z0: number, z1: number, margin: number, under: Mat): void {
  const inner = inset(plan, margin);
  p.extrude(inner, "z", z0, z1, slab("plate", "trim", under));
  plan.forEach((a, k) => {
    const j = (k + 1) % plan.length;
    p.extrude([a, plan[j]!, inner[j]!, inner[k]!], "z", z0, z1, tone("trim"));
  });
}

/**
 * A triangle of foundation: the deck in its margin, a dark block under it, a channel along each side mitred on the
 * lines to the corners, a block and a footing at each corner, and stiffeners in the channel's mouth.
 */
function triRaft(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const plan = planOf(form);
  const n = plan.length;
  const [top, bottom] = [form.thick / 2, -form.thick / 2];
  const sides = slab("plate", "trim");
  if (level === 3) return p.extrude(plan, "z", bottom, top, sides);
  const [under, pad] = [top - DECK, 0.1];
  if (level === 2) {
    p.extrude(plan, "z", bottom + pad, top, sides);
    return p.extrude(inset(plan, 0.12), "z", bottom, bottom + pad + 0.01, tone("dark"));
  }
  triDeck(p, plan, under, top, form.yieldBand || MARGIN, "dark");
  p.extrude(inset(plan, 0.07), "z", bottom, under + 0.005, tone("dark"));
  const g: Flat = [plan.reduce((sum, q) => sum + q[0], 0) / n, plan.reduce((sum, q) => sum + q[1], 0) / n];
  const [flange, web, deep, block, footing] = [0.045, 0.045, 0.1, 0.15, 0.3];
  const section: Cell[] = [[0, bottom + pad], [0, bottom + pad + flange], [web, bottom + pad + flange], [web, under - flange], [0, under - flange], [0, under + 0.005], [deep, under + 0.005], [deep, bottom + pad]];
  const all = sidesOf(plan);
  all.forEach((side, k) => {
    const from = p.faces.length;
    onSide(p, side, () => void p.extrude(section, "x", -0.3, side.l + 0.3, tone("trim")));
    clip(p, uprightPlane(g, side.a), null, from);
    clip(p, uprightPlane(side.b, g), null, from);
    // A rhombus at this side's first corner, its sides along the two that meet there: the block, and the footing under it.
    const before = all[(k + n - 1) % n]!;
    const rhomb = (size: number): Flat[] => [side.a, [side.a[0] + side.d[0] * size, side.a[1] + side.d[1] * size], [side.a[0] + (side.d[0] - before.d[0]) * size, side.a[1] + (side.d[1] - before.d[1]) * size], [side.a[0] - before.d[0] * size, side.a[1] - before.d[1] * size]];
    p.extrude(rhomb(footing), "z", bottom, bottom + pad + 0.012, tone("trim"));
    p.extrude(rhomb(block), "z", bottom + pad, under + 0.005, tone("trim"));
    const marks = level === 0 ? [side.l / 4, side.l / 2, (3 * side.l) / 4] : [side.l / 2];
    for (const t of marks) onSide(p, side, () => void p.box([t - 0.012, 0.004, bottom + pad + flange - 0.005], [t + 0.012, web + 0.01, under - flange + 0.005], tone("trim")));
    if (level > 0) return;
    const at = (t: number, inward: number, z: number): Vec => [side.a[0] + side.d[0] * t + side.inward[0] * inward, side.a[1] + side.d[1] * t + side.inward[1] * inward, z];
    for (const t of [(3 * side.l) / 8, (5 * side.l) / 8]) nut(p, at(t, web, (bottom + pad + under) / 2), [-side.inward[0], -side.inward[1], 0]);
    nut(p, [side.a[0] + (side.d[0] - before.d[0]) * 0.11, side.a[1] + (side.d[1] - before.d[1]) * 0.11, bottom + pad + 0.012], [0, 0, 1], 0.026, 0.016);
  });
  return p;
}

/**
 * A triangle of ceiling: the deck in its margin, which is the band its sides yield by, a rim beam under each margin
 * mitred on the lines to the corners, and joists under the sheets' joints that end on the rings.
 */
function triCeiling(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const plan = planOf(form);
  const n = plan.length;
  const [top, bottom] = [form.thick / 2, -form.thick / 2 + 0.01];
  const sides = slab("plate", "trim", "plate");
  if (level >= 2) return p.extrude(plan, "z", bottom, top, sides);
  const under = top - DECK;
  const band = form.yieldBand || MARGIN;
  triDeck(p, plan, under, top, band, "plate");
  const g: Flat = [plan.reduce((sum, q) => sum + q[0], 0) / n, plan.reduce((sum, q) => sum + q[1], 0) / n];
  const rim = Math.min(0.085, band);
  const all = sidesOf(plan);
  for (const side of all) {
    const from = p.faces.length;
    onSide(p, side, () => void p.box([-0.3, 0, bottom], [side.l + 0.3, rim, under + 0.004], tone("trim")));
    clip(p, uprightPlane(g, side.a), null, from);
    clip(p, uprightPlane(side.b, g), null, from);
  }
  // Joists across the piece's own x, on its joints, cut to the rings.
  const [x0, x1, y0, y1] = [Math.min(...plan.map((q) => q[0])), Math.max(...plan.map((q) => q[0])), Math.min(...plan.map((q) => q[1])), Math.max(...plan.map((q) => q[1]))];
  const within = inset(plan, band);
  for (let x = Math.ceil((x0 + 0.3) / GRID) * GRID; x < x1 - 0.3; x += GRID) {
    // A flange under a web, and past the finest level one bar.
    for (const [w, z0, z1] of level === 0 ? ([[0.05, bottom + 0.012, bottom + 0.04], [0.015, bottom + 0.035, under + 0.004]] as const) : ([[0.03, bottom + 0.012, under + 0.004]] as const)) {
      const from = p.faces.length;
      p.box([x - w, y0 - 0.1, z0], [x + w, y1 + 0.1, z1], tone("trim"));
      clipTo(p, within, 0, null, from);
    }
  }
  if (level === 0) for (const side of all) for (const t of [side.l / 3, (2 * side.l) / 3]) nut(p, [side.a[0] + side.d[0] * t + side.inward[0] * rim, side.a[1] + side.d[1] * t + side.inward[1] * rim, (bottom + under) / 2], [side.inward[0], side.inward[1], 0], 0.018, 0.01);
  return p;
}

// Roofs. A roof's top is the plane through its row's corner heights and its slab hangs `thick` under it, wherever the
// row puts those. Sheet lies 12 mm over the plane; a standing seam runs up the slope on every joint of the sheets,
// which are counted from the piece's origin; half a seam runs along every side that is no eave, so two roofs side by
// side make a whole one, and a hip between two pieces is a seam. All stand 45 mm over the plane, measured upright, so
// faces meet at one height along any side they share. A low side ends in a box gutter 0.30 m out, which laps the roof
// below it.

/** The sheet's top over a roof's plane, a seam's, and a gutter's, measured upright. */
const SHEET = 0.012;
const SEAM = 0.045;
const GUTTER = 0.055;
/** Half a seam's width at its foot, and the half widths of a hip's capping and of a valley's lining. */
const SEAM_HALF = 0.03;
const HIP_HALF = 0.06;
const VALLEY_HALF = 0.14;
/** How far a gutter stands out past a low side, measured level, and how far the fascia under it does. */
const EAVE = 0.3;
const FASCIA = 0.112;

type SideKind = "eave" | "ridge" | "rake" | "fold";
/** One flat face of a roof: its corners in plan, what each side is, the way up its slope, the way along its contours, and its height over a point. */
interface Facet {
  poly: Flat[];
  kinds: SideKind[];
  up: Flat;
  along: Flat;
  g: number;
  h(q: Flat): number;
}

/** A roof row's faces: one, or two where its four corners are folded on the diagonal through the odd one. */
function facetsOf(form: FormDef): { plan: Flat[]; tops: number[]; facets: Facet[]; fold: number; hip: boolean; side: { facet: Facet; kind: SideKind }[] } {
  const plan = planOf(form);
  const tops = form.corner!.map((h) => h - form.at[1]);
  const n = plan.length;
  const [lo, hi] = [Math.min(...tops), Math.max(...tops)];
  const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  const odd = n === 4 ? tops.findIndex((h, k) => tops.filter((t) => same(t, h)).length === 1 && tops.filter((t) => same(t, tops[(k + 1) % n]!)).length === 3) : -1;
  const fold = Math.max(0, odd);
  const lists = odd < 0 ? [plan.map((_, k) => k)] : [[fold, (fold + 1) % n, (fold + 2) % n], [fold, (fold + 2) % n, (fold + 3) % n]];
  const facets = lists.map((list): Facet => {
    const poly = list.map((k) => plan[k]!);
    const [a, b, c] = [0, 1, 2].map((i): Vec => [poly[i]![0], poly[i]![1], tops[list[i]!]!]);
    const nrm = cross(sub(b!, a!), sub(c!, a!));
    const [gx, gy] = [-nrm[0] / nrm[2], -nrm[1] / nrm[2]];
    const g = Math.hypot(gx, gy);
    const up: Flat = [gx / g, gy / g];
    const kinds = list.map((k, i): SideKind => {
      const j = list[(i + 1) % list.length]!;
      if ((j - k + n) % n !== 1) return "fold";
      if (!same(tops[k]!, tops[j]!)) return "rake";
      return same(tops[k]!, lo) ? "eave" : "ridge";
    });
    return { poly, kinds, up, along: [up[1], -up[0]], g, h: (q) => a![2] + gx * (q[0] - a![0]) + gy * (q[1] - a![1]) };
  });
  const side = plan.map((q, k) => {
    const facet = facets.find((f) => f.poly.some((c, i) => c === q && f.poly[(i + 1) % f.poly.length] === plan[(k + 1) % n]))!;
    return { facet, kind: facet.kinds[facet.poly.indexOf(q)]! };
  });
  return { plan, tops, facets, fold, hip: odd >= 0 && same(tops[fold]!, hi), side };
}

/** The axis of the recipe's frame two points of a plan lie along, if they lie along one. */
const axisOf = (a: Flat, b: Flat): number | undefined => (Math.abs(a[1] - b[1]) < 1e-9 ? 0 : Math.abs(a[0] - b[0]) < 1e-9 ? 1 : undefined);

/** A slab over `quad` of a facet whose top is `over` its plane and which is `thick` through, measured upright. */
function onFacet(p: Shape, f: Facet, quad: readonly Flat[], over: number, thick: number, mat: Mat, along?: number): void {
  slabOn(p, quad, quad.map((q) => f.h(q) + over), thick, () => of(mat), 0, along);
}

/**
 * A roof: sheet on a deck over purlins inside a rim, with standing seams, half seams along its sides, a capping on a
 * hip's fold, a lining in a valley's and a box gutter over a fascia along a low side. Past the finest level the deck
 * is the whole slab, and from 60 m the roof is one slab out to its eaves.
 */
function roof(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const { plan, tops, facets, fold, hip, side } = facetsOf(form);
  const n = plan.length;
  const decked = slabMap("plate", "trim", "plate");
  if (level === 3) return slabOn(p, plan, tops.map((h) => h + SHEET), form.thick + SHEET, decked, fold);
  const eave = side.map((s) => s.kind === "eave");
  const moved = inset(plan, eave.map((e) => (e ? -EAVE : 0)));
  /** The facet a corner's eave lies on, or the first it is a corner of. */
  const cornerFacet = (k: number): Facet => (eave[k] ? side[k]! : eave[(k + n - 1) % n] ? side[(k + n - 1) % n]! : side[k]!).facet;
  if (level === 2) return slabOn(p, moved, moved.map((q, k) => cornerFacet(k).h(q) + SHEET), form.thick + SHEET, decked, fold);
  const band = form.yieldBand || 0.1;
  const folded = facets.length > 1;
  if (level === 1) slabOn(p, plan, tops.map((h) => h + SHEET), form.thick + SHEET, decked, fold);
  else {
    slabOn(p, plan, tops.map((h) => h + SHEET), DECK + SHEET, decked, fold);
    // The rim: a beam inside each side, the slab's whole depth under the deck, mitred at the corners.
    const rim = inset(plan, Math.min(0.085, band));
    plan.forEach((a, k) => {
      const j = (k + 1) % n, kind = side[k]!.kind;
      onFacet(p, side[k]!.facet, [a, plan[j]!, rim[j]!, rim[k]!], -DECK, form.thick - DECK, "trim", kind === "rake" ? undefined : axisOf(a, plan[j]!));
    });
    if (folded) {
      // A rafter under the fold, clear of the rings, as far under the deck as a hip's faces fall away over its width.
      const [a, b] = [inset(plan, band + 0.08)[(fold + 2) % n]!, inset(plan, band + 0.08)[fold]!];
      const drop = DECK + 0.07 + (hip ? 0.05 * facets[0]!.g : 0);
      strut(p, [a[0], a[1], facets[0]!.h(a) - drop], [b[0], b[1], facets[0]!.h(b) - drop], 0.1, 0.14, [0, 0, 1], "trim");
    }
    // Purlins under the deck along the contours, on the sheets' joints, their ends on the rings.
    for (const f of facets) {
      const within = inset(f.poly, f.kinds.map((kind) => (kind === "fold" ? 0.08 : band)));
      const us = f.poly.map((q) => q[0] * f.up[0] + q[1] * f.up[1]), as = f.poly.map((q) => q[0] * f.along[0] + q[1] * f.along[1]);
      const [a0, a1] = [Math.min(...as) - 0.5, Math.max(...as) + 0.5];
      const at = (a: number, u: number): Flat => [a * f.along[0] + u * f.up[0], a * f.along[1] + u * f.up[1]];
      // A folded roof has its rafter in their place.
      for (let u = Math.ceil((Math.min(...us) + 0.4) / GRID) * GRID; !folded && u < Math.max(...us) - 0.4; u += GRID) {
        const from = p.faces.length;
        onFacet(p, f, [at(a0, u - 0.035), at(a1, u - 0.035), at(a1, u + 0.035), at(a0, u + 0.035)], -DECK + 0.004, 0.11, "trim");
        clipTo(p, within, 0, null, from);
      }
    }
  }
  // Standing seams up the slope on the sheets' joints, each ending under what runs along the side it reaches. Past
  // the finest level one ends on a low side's ring, short of the gutter, and no ring cuts it.
  for (const f of facets) {
    const us = f.poly.map((q) => q[0] * f.up[0] + q[1] * f.up[1]), as = f.poly.map((q) => q[0] * f.along[0] + q[1] * f.along[1]);
    const [u0, u1] = [Math.min(...us) - 0.2, Math.max(...us) + 0.2];
    const ends = f.poly.map((a, i) => {
      const kind = f.kinds[i]!;
      return planeMoved(uprightPlane(a, f.poly[(i + 1) % f.poly.length]!), kind === "eave" ? (level === 0 ? 0 : -band) : kind === "fold" ? -((hip ? HIP_HALF : VALLEY_HALF) - 0.004) : level === 0 ? -(SEAM_HALF - 0.004) : -band);
    });
    for (let c = Math.ceil((Math.min(...as) + 0.1) / GRID) * GRID; c < Math.max(...as) - 0.1; c += GRID) {
      const from = p.faces.length;
      const ring = (u: number): Vec[] => ([[c - SEAM_HALF, SHEET - 0.004], [c + SEAM_HALF, SHEET - 0.004], [c, SEAM]] as const).map(([a, over]): Vec => {
        const q: Flat = [a * f.along[0] + u * f.up[0], a * f.along[1] + u * f.up[1]];
        return [q[0], q[1], f.h(q) + over];
      });
      p.loft([ring(u0), ring(u1)], () => ["trim", NO_UV], () => ["trim", NO_UV]);
      for (const plane of ends) clip(p, plane, null, from);
    }
  }
  // Half a seam along every side that is no eave, mitred where two meet: 3 cm of bar, which is the finest level's.
  const capped = inset(plan, eave.map((e) => (e ? 0 : SEAM_HALF)));
  plan.forEach((a, k) => {
    const j = (k + 1) % n;
    if (!eave[k] && level === 0) onFacet(p, side[k]!.facet, [a, plan[j]!, capped[j]!, capped[k]!], SEAM, SEAM - SHEET + 0.004, "trim", side[k]!.kind === "ridge" ? axisOf(a, plan[j]!) : undefined);
  });
  // A hip's capping and a valley's lining, half on each face. Past the finest level they stop on the rings.
  for (const f of folded ? facets : []) {
    const i = f.kinds.indexOf("fold"), j = (i + 1) % f.poly.length;
    const half = inset(f.poly, f.kinds.map((kind) => (kind === "fold" ? (hip ? HIP_HALF : VALLEY_HALF) : level === 0 ? 0 : band)));
    if (level > 0) {
      const ends = inset(f.poly, f.kinds.map((kind) => (kind === "fold" ? 0 : band)));
      onFacet(p, f, [ends[i]!, ends[j]!, half[j]!, half[i]!], hip ? SEAM : SHEET + 0.008, hip ? SEAM - SHEET + 0.004 : 0.014, "trim");
      continue;
    }
    if (hip) onFacet(p, f, [f.poly[i]!, f.poly[j]!, half[j]!, half[i]!], SEAM, SEAM - SHEET + 0.004, "trim");
    else onFacet(p, f, [f.poly[i]!, f.poly[j]!, half[j]!, half[i]!], SHEET + 0.008, 0.014, "trim");
  }
  // The gutter along a low side, its underside on the roof's plane, and at the finest the fascia under it.
  const fascia = inset(plan, eave.map((e) => (e ? -FASCIA : 0)));
  plan.forEach((a, k) => {
    const j = (k + 1) % n;
    if (!eave[k]) return;
    onFacet(p, side[k]!.facet, [a, plan[j]!, moved[j]!, moved[k]!], GUTTER, GUTTER, "trim", axisOf(a, plan[j]!));
    if (level === 0) onFacet(p, side[k]!.facet, [a, plan[j]!, fascia[j]!, fascia[k]!], 0, form.thick, "trim", axisOf(a, plan[j]!));
  });
  return p;
}

// Trims: what the client draws where pieces meet (client/core/render/trims.ts). A joint stands on its corner from the
// level up a storey and is cut to a lower wall by clamping every vertex over n quarter storeys and a centimetre down
// onto that height (piece-fit.ts). Nothing here is textured, so a shaft needs no ring to keep a picture: what a cut
// needs is that all over it folds inside what is at the cut's own height. So each collar's top is a height a joint is
// cut to, and what stands over a collar reaches no further out than it.

/** The heights a joint may be cut to, a centimetre over one, two and three quarter storeys, and its own. */
const JOINT_RINGS = [0.76, 1.51, 2.26] as const;
const JOINT_HIGH = 3;
const JOINT_CAP = 0.01;
/** Half the width of the square joint: a centimetre past a wall's faces, so none of its faces lies in one of theirs. */
const JOINT_HALF = FACE + 0.01;

/**
 * The square joint: a box section a storey high on a base plate, with a bolted collar under each height it may be cut
 * to and under its head. The collars step in from the lowest, so a cut post ends flat in its own collar.
 */
function cornerPost(level: number): Shape {
  const p = new Shape();
  const h = JOINT_HALF;
  if (level === 3) {
    const three = Array.from({ length: 3 }, (_, k): Cell => [Math.cos((2 * Math.PI * k) / 3) * h * 1.6, Math.sin((2 * Math.PI * k) / 3) * h * 1.6]);
    return p.extrude(three, "z", 0, JOINT_HIGH + JOINT_CAP, tone("frame"));
  }
  if (level === 2) return p.box([-h, -h, 0], [h, h, JOINT_HIGH + JOINT_CAP], tone("frame"));
  p.box([-h, -h, 0], [h, h, JOINT_HIGH], tone("frame"));
  // Each collar by how far it stands off the shaft, its top at the height it is under.
  const collars: readonly (readonly [number, number])[] = [[JOINT_RINGS[0], 0.024], [JOINT_RINGS[1], 0.016], [JOINT_RINGS[2], 0.016], [JOINT_HIGH, 0.008]];
  for (const [z, out] of level === 0 ? collars : collars.filter(([z]) => z !== JOINT_RINGS[2])) p.box([-h - out, -h - out, z - 0.1], [h + out, h + out, z], tone("trim"));
  if (level === 1) return p;
  p.box([-h - 0.03, -h - 0.03, 0], [h + 0.03, h + 0.03, 0.03], tone("trim"));
  p.box([-h + 0.02, -h + 0.02, JOINT_HIGH - 0.005], [h - 0.02, h - 0.02, JOINT_HIGH + JOINT_CAP], tone("trim"));
  for (const [z, out] of [collars[0]!, collars[1]!, collars[3]!]) {
    for (const [nx, ny] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) stud(p, [nx * (h + out), ny * (h + out), z - 0.05], [nx, ny, 0], 0.02, 0.008);
  }
  return p;
}

/**
 * A joint where walls meet off the square: a twelve-sided tube `reach` from the corner to each arris, an arris `turn`
 * round from +x, with a bolted flange under each of the two lower heights it may be cut to and a base plate.
 */
function tubePost(level: number, reach: number, turn: number): Shape {
  const p = new Shape();
  const ring = (r: number, sides = 12): Cell[] => Array.from({ length: sides }, (_, k): Cell => [Math.cos(turn + (2 * Math.PI * k) / sides) * r, Math.sin(turn + (2 * Math.PI * k) / sides) * r]);
  if (level === 3) return p.extrude(ring(reach * 1.25, 3), "z", 0, JOINT_HIGH + JOINT_CAP, tone("trim"));
  if (level === 2) {
    const c = reach * Math.cos(Math.PI / 12) * 0.96;
    return p.box([-c, -c, 0], [c, c, JOINT_HIGH + JOINT_CAP], tone("trim"));
  }
  p.extrude(ring(reach), "z", 0, JOINT_HIGH + JOINT_CAP, tone("trim"));
  if (level === 1) return p;
  for (const z of [JOINT_RINGS[0], JOINT_RINGS[1]]) p.extrude(ring(reach + 0.022), "z", z - 0.035, z, tone("trim"));
  p.box([-reach - 0.012, -reach - 0.012, 0], [reach + 0.012, reach + 0.012, 0.03], tone("trim"));
  for (const k of [1, 7]) {
    const t = turn + (2 * Math.PI * (k + 0.5)) / 12, out = reach * Math.cos(Math.PI / 12);
    stud(p, [Math.cos(t) * out, Math.sin(t) * out, JOINT_HIGH - 0.12], [Math.cos(t), Math.sin(t), 0], 0.018, 0.009);
  }
  return p;
}

/**
 * The skirt under a foundation's open side: plate hung from a ledger at the foundation's top, with a post at each end
 * and a stiffener on each sheet's joint, 2.4 m down and 0.12 m out. Past each end a wedge mitres it 0.12 m round the
 * corner, a little inside the post it would lie in on a straight run: two skirts at an outside corner close it.
 */
function skirt(level: number): Shape {
  const p = new Shape();
  const [out, deep, lip] = [0.12, 2.4, 0.05];
  if (level === 3) {
    p.faces.push({ points: [[-H, -out, -deep], [H, -out, -deep], [H, -out, -0.02], [-H, -out, -0.02]], uvs: [NO_UV, NO_UV, NO_UV, NO_UV], mat: "plate" });
    return p;
  }
  if (level === 2) return p.extrude([[0, 0], [-out, -deep], [-out, -0.02]], "x", -H, H, (label) => tone(label === "-y" ? "plate" : "trim")(label, [0, 0, 0], [0, 0, 0]));
  // A wedge past an end `s`, from the side's line out to `reach`, between two heights.
  const wedge = (s: number, reach: number, z0: number, z1: number, mat: Mat): void => closed(p, [
    { points: [[s * H, 0, z0], [s * H, -reach, z0], [s * (H + reach), -reach, z0]], mat },
    { points: [[s * H, 0, z1], [s * (H + reach), -reach, z1], [s * H, -reach, z1]], mat },
    { points: [[s * H, 0, z0], [s * (H + reach), -reach, z0], [s * (H + reach), -reach, z1], [s * H, 0, z1]], mat },
    { points: [[s * (H + reach), -reach, z0], [s * H, -reach, z0], [s * H, -reach, z1], [s * (H + reach), -reach, z1]], mat },
    { points: [[s * H, -reach, z0], [s * H, 0, z0], [s * H, 0, z1], [s * H, -reach, z1]], mat },
  ]);
  if (level === 1) {
    p.extrude([[0, 0], [0, -deep], [-out, -deep], [-out, -0.02]], "x", -H, H, (label) => tone(label === "-y" ? "plate" : "trim")(label, [0, 0, 0], [0, 0, 0]));
    for (const s of [-1, 1]) wedge(s, out - 0.006, -deep + 0.005, -0.03, "trim");
    return p;
  }
  // The ledger, (y, z) going round as seen from +x: its top falls away outward.
  p.extrude([[0, 0], [0, -lip], [-out, -lip], [-out, -0.02]], "x", -H, H, tone("frame"));
  p.box([-H, -0.05, -deep], [H, -0.02, -lip + 0.004], tone("plate"));
  const post = 0.12;
  for (const s of [-1, 1]) {
    p.box([Math.min(s * H, s * (H - post)), -out + 0.002, -deep], [Math.max(s * H, s * (H - post)), -0.012, -lip + 0.004], tone("trim"));
    wedge(s, out - 0.007, -deep + 0.005, -lip - 0.002, "trim");
    wedge(s, out - 0.007, -lip + 0.006, -0.026, "trim");
  }
  // A stiffener of angle on each joint between: a ridge down the plate.
  for (const x of [-GRID, 0, GRID]) p.extrude([[-0.05, x - 0.035], [-0.09, x], [-0.05, x + 0.035]].map(([y, xx]) => [xx!, y!] as const), "z", -deep, -lip + 0.004, tone("trim"));
  for (const x of [-GRID / 2, GRID / 2]) stud(p, [x, -out, -lip / 2 - 0.006], [0, -1, 0], 0.018, 0.008);
  return p;
}

/**
 * A ridge flashing: two wings of sheet at the roofs' pitch, hemmed down to the sheet at their edges, under a roll along
 * the ridge, bolted through to each roof. It lies along x on the ridge's own line, which is at its origin's height.
 * No client draws it yet.
 */
function ridgeCap(level: number): Shape {
  const p = new Shape();
  const [wide, top, pitch] = [0.24, 0.09, 0.5];
  const tip = top - wide * pitch;
  if (level === 3) {
    p.faces.push({ points: [[-H, wide, 0.02], [-H, -wide, 0.02], [H, -wide, 0.02], [H, wide, 0.02]], uvs: [NO_UV, NO_UV, NO_UV, NO_UV], mat: "trim" });
    return p;
  }
  if (level === 2) return p.extrude([[0, top], [wide, tip - 0.03], [-wide, tip - 0.03]], "x", -H, H, tone("trim"));
  if (level === 1) return p.extrude([[0, top], [wide, tip], [wide, tip - 0.03], [0, top - 0.03], [-wide, tip - 0.03], [-wide, tip]], "x", -H, H, tone("trim"));
  const hem = -wide * pitch + SHEET;
  p.extrude([[0, top], [wide, tip], [wide, hem], [wide - 0.02, hem], [wide - 0.02, tip - 0.02], [0, top - 0.025], [-wide + 0.02, tip - 0.02], [-wide + 0.02, hem], [-wide, hem], [-wide, tip]], "x", -H, H, tone("trim"));
  p.extrude([[0, top + 0.03], [0.035, top - 0.012], [-0.035, top - 0.012]], "x", -H, H, tone("trim"));
  for (const x of [-1.125, -0.375, 0.375, 1.125]) for (const s of [-1, 1]) stud(p, [x, s * 0.15, top - 0.15 * pitch], [0, s * pitch, 1], 0.016, 0.008);
  return p;
}

/** Metal's trims by the names the client finds them under, each at its four levels. */
function metalTrims(): Record<string, Shape[]> {
  const levels = (make: (level: number) => Shape): Shape[] => [0, 1, 2, 3].map(make);
  return {
    joint_sq: levels(cornerPost),
    // A flat faces each wall at 120 and 150 degrees, and an arris lies in the notch between two walls at 60, where the wider tube is.
    joint_r15: levels((level) => tubePost(level, 0.15, Math.PI / 12)),
    joint_r21: levels((level) => tubePost(level, 0.21, 0)),
    skirt: levels(skirt),
    ridge: levels(ridgeCap),
  };
}

/** The forms past the first nine, by name: each is built from its row's numbers alone. */
const PLANNED: Readonly<Record<string, (form: FormDef, level: number) => Shape | null>> = {
  half_wall: lowWall,
  quarter_wall: lowWall,
  large_wall: tallWall,
  double_doorway: portal,
  sloped_wall_left: gable,
  sloped_wall_right: gable,
  railing,
  thin_pillar: hColumn,
  beam: iBeam,
  ramp,
  fence_foundation: kerb,
  ladder,
  trapdoor_frame: hatchFrame,
  trapdoor: hatch,
  quarter_foundation: raft,
  triangle_foundation: triRaft,
  triangle_ceiling: triCeiling,
  gateway,
  gate,
  roof,
  roof_hip: roof,
  roof_valley: roof,
  triangle_roof: roof,
  triangle_roof_low: roof,
};

export const METAL: TierRecipe = {
  name: "metal",
  rank: 3,
  runPost: false,
  jointHalf: 0.11,
  // Each is a palette entry (shared/pack/palette.ts), so the match is exact: the plate a light steel grey (90), the
  // frame and the trim a dark slate (4), bolts a rusted iron (96), black, and the marker yellow.
  tones: { plate: [156, 165, 174], frame: [92, 98, 110], trim: [92, 98, 110], bolt: [79, 74, 68], dark: [20, 20, 24], nosing: [236, 208, 72] },
  split(name, form, level) {
    const planned = PLANNED[name];
    if (planned) return planned(form, level);
    if (form.layer === "wall") return wallFamily(form, level);
    if (form.layer === "slab" && form.root === "always") return foundation(form, level);
    if (form.layer === "slab" && form.outline.length === 4 && !form.corner && !form.openings) return ceiling(form, level);
    if (form.layer === "post") return pillar(form, level);
    if (form.layer === "leaf" && form.plane !== "flat") return door(form, level);
    if (form.layer === "fill" && form.steps !== undefined) return stairs(form, level);
    throw new Error(`metal has no recipe for ${name} yet`);
  },
  trims: metalTrims,
};

/** The colour a material's faces carry: the plate's is region 0, the instance's colour, which wears the recipe's material; the rest are the tones' palette entries. */
export function metalColours(): (mat: string) => number {
  const palette = defaultPalette();
  const fixed = new Map(Object.entries(METAL.tones).map(([mat, rgb]) => [mat, nearestColour(palette, rgb[0], rgb[1], rgb[2])] as const));
  return (mat) => (mat === "plate" ? REGION_BASE : fixed.get(mat)!);
}

/** A level with each face of a fixed colour marked as wearing its piece's material, and all but the frame's as keeping clear of joints: flatLod lays a face's corners down in the faces' order. */
function marked(shape: Shape, lod: SourceLod): SourceLod {
  const bones = lod.bones ?? new Uint8Array(lod.colors.length);
  let v = 0;
  for (const f of shape.faces) for (let k = 0; k < f.points.length; k++, v++) bones[v]! |= f.mat === "plate" ? 0 : f.mat === "frame" ? FACE_WEARS : FACE_WEARS | FACE_PLAIN;
  if (v !== bones.length) throw new Error("metal: a level's corners are not its faces'");
  return { ...lod, bones };
}

/**
 * The tier's meshes as its pack holds them: every level flat, in the colours above, the levels a wall is seen close
 * at saying their faces' corners and outer edges so the flat program wears their arrises (kit.ts flatLod), and every
 * level which faces wear the piece's material in their own colour.
 */
export function bakeMetal(forms: Readonly<Record<string, FormDef>>, trims = false): SourceMesh[] {
  const colour = metalColours();
  const pieces: [string, Shape[]][] = Object.entries(forms).map(([name, form]) => [name, levelsOf(METAL, name, form)]);
  // A trim's levels are the recipe's as they come: it is cut nowhere.
  if (trims) pieces.push(...Object.entries(metalTrims()));
  return pieces.map(([name, shapes]): SourceMesh => ({
    id: `core:${name}_${METAL.name}`,
    // An open sheet, a trim's last level, has no solids to say its edges by.
    lods: shapes.map((shape, level): SourceLod => ({ ...marked(shape, flatLod(shape, colour, level < 3 && shape.triangles > 2)), ...(level > 0 ? { error: errorOf(shape, level) } : {}) })),
  }));
}
