// What a renderer is handed besides draws: the programs it compiles, the units their samplers read, and the frame
// block every lit program shares.
import { expect, test } from "bun:test";
import { MATERIAL_RECIPES } from "../../content/texgen/materials.ts";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { FLAT_BODY_FRAGMENT, FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_TERRAIN_VERTEX } from "../../client/core/render/glsl.ts";
import { tekPhaseFragment, tekPhaseVertex } from "../../client/core/render/tek-phase.ts";
import { HAND_FAR, HAND_NEAR } from "../../client/core/render/hand.ts";
import { ORB_AT, ORB_LANES, DROPS_AT, DROP_LANES, CAST_AT, GLASS_AT, LAMP_AT, DRAW_BLEND, DRAW_CUTOUT, DRAW_PULLED, DRAW_TEXTURED, DRAW_WATER, FRAME, FRAME_BLOCK, FRAME_FLOATS, FramePacket, MAX_CASCADES, MAX_TIRE_CONTACTS, MAX_CONTACTS, MAX_WATER_MARKS, ROOF_AT, WATER_MARK_COUNT, WATER_PATHS, WATER_BOUNDS, WATER_MARKS, SHORE_AT, OPTIC_AT, MADE_AT, WINDOW_AT } from "../../client/core/render/packet.ts";
import { LATE, PROGRAMS, UNIT, drawProgram, tierPrograms, type ProgramText } from "../../client/core/render/programs.ts";
// The orb's program is a tier's once its late text has come, as it has here.
import "../../client/core/render/orb-late.ts";
import type { PackMaterial } from "../../shared/pack/pack.ts";
import { TEXTURE_FORMATS } from "../../shared/pack/texture.ts";

/** A program's name, from its number. */
const named = (n: number): string => Object.keys(PROGRAMS)[n]!;

test("low poly keeps its flat shaders and phase cut without material samplers", () => {
  const low = TIERS[0]!;
  expect(["flat", "terrain"].map((name) => PROGRAMS[name]!(low, "rgba")).map((p) => [p.vertex, p.fragment, p.defines])).toEqual([
    // A mesh's flat fragment is the ground's with the shimmer of a body worth walking to (shimmer-glsl.ts).
    [tekPhaseVertex(FLAT_MESH_VERTEX), tekPhaseFragment(FLAT_BODY_FRAGMENT), ""],
    [FLAT_TERRAIN_VERTEX, FLAT_FRAGMENT, ""],
  ]);
  const field = PROGRAMS.flat!(low, "rgba");
  expect(field.fragment).toContain("phaseEdge < 0.0");
  expect(field.fragment).not.toContain("tekSpanLight");
  expect(field.samplers).not.toHaveProperty("uTexgen");
});

test("each declared sampler reads a unit of its own", () => {
  for (const tier of TIERS) {
    for (const format of TEXTURE_FORMATS) {
      for (const make of Object.values(PROGRAMS)) {
        const p = make(tier, format);
        const declared = [...(p.vertex + p.fragment).matchAll(/uniform\s+(?:\w+\s+)?\w*sampler\w+\s+([^;]+);/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
        expect(Object.keys(p.samplers).sort()).toEqual([...new Set(declared)].sort());
        expect(new Set(Object.values(p.samplers)).size).toBe(Object.keys(p.samplers).length);
      }
    }
  }
  // The material's five maps and the rest each have a unit, the layer and the details atlas after them, which only the
  // details program reads and which is free outside its draws, where the finish's passes, after every draw, read their
  // sources (post.ts); and the sky's openness, the facades' five, what stands overhead and the walls' weathering masks
  // past the sixteen: no program's fragment text reads more than the sixteen it may, the flat program on a tier that
  // draws facades reading fifteen there and three more in its vertex text, the pieces' states (pieces.ts) the third.
  const units = [UNIT.palette, UNIT.heights, UNIT.tint, UNIT.bones, ...[0, 1, 2, 3, 4].map((r) => UNIT.maps + r), UNIT.shadow, UNIT.sky, UNIT.windowHeights, UNIT.windowTint, UNIT.atlas, UNIT.layer, UNIT.details, UNIT.open];
  expect([new Set(units).size, Math.max(...units)]).toEqual([17, 16]);
  expect([UNIT.open, UNIT.facade, UNIT.road, UNIT.street, UNIT.roof]).toEqual([16, 17, 22, 23, 24]);
  expect(Math.max(...TIERS.flatMap((tier) => Object.values(PROGRAMS).map((make) => Object.keys(make(tier, "bc").samplers).length)))).toBe(18);
  // The pieces' states are read by vertex texts alone, so a fragment text's sixteen are as they were.
  for (const tier of TIERS) for (const make of Object.values(PROGRAMS)) expect(make(tier, "bc").fragment).not.toContain("uPieces");
  const fragmentReads = (p: ProgramText): number => Object.keys(p.samplers).filter((name) => new RegExp(`uniform\\s+(?:\\w+\\s+)?\\w*sampler\\w+\\s+[^;]*\\b${name}\\b`).test(p.fragment)).length;
  expect(Math.max(...TIERS.flatMap((tier) => Object.values(PROGRAMS).map((make) => fragmentReads(make(tier, "bc")))))).toBe(15);
  expect(Object.entries(PROGRAMS).filter(([, make]) => Object.values(make(TIERS[1]!, "bc").samplers).includes(UNIT.details)).map(([name]) => name)).toEqual(["details", "bloomDown", "bloomUp", "finish"]);
});

test("the frame block: each value inside its slot, a GLSL slot for every four floats, and the packet's views of it", () => {
  // Three numbers start a slot, two fit in its first three lanes, and one is anywhere in it.
  for (const at of [FRAME.sun, FRAME.sunColor, FRAME.moon, FRAME.moonColor, FRAME.skyAbove, FRAME.skyBelow, FRAME.cloudSun, FRAME.skySide, FRAME.skySun]) expect(at % 4).toBe(0);
  for (const at of [FRAME.ends, FRAME.clouds, FRAME.clouds + 2]) expect(at % 4).toBeLessThanOrEqual(2);
  const [slots, spheres, cascades, after] = [/highp vec4 (f[^;]+);/, /highp vec4 fSpheres\[(\d+)\]/, /highp mat4 fCascades\[(\d+)\]/, /fCascades\[\d+\];\s+highp vec4 (f[^;]+);/].map((re) => FRAME_BLOCK.match(re)![1]!);
  expect(slots.split(",").length * 4).toBe(FRAME.spheres);
  expect([Number(spheres), Number(cascades)]).toEqual([MAX_CASCADES, MAX_CASCADES]);
  expect([FRAME.spheres + MAX_CASCADES * 4, FRAME.cascades + MAX_CASCADES * 16, FRAME.skySide + after.split(",").length * 4]).toEqual([FRAME.cascades, FRAME.skySide, FRAME.contact]);
  // Each body takes two contact slots before the obelisk lenses (contact.ts).
  expect([Number(FRAME_BLOCK.match(/highp vec4 fContact\[(\d+)\]/)![1]), FRAME.contact + MAX_CONTACTS * 8]).toEqual([MAX_CONTACTS * 2, FRAME.eyes]);
  expect(Math.max(...Object.values(FRAME))).toBeLessThan(FRAME_FLOATS);

  expect(FRAME_BLOCK).toContain("highp vec4 fEyes[12]");
  expect(FRAME.eyes + 12 * 4).toBe(FRAME.reflection);
  expect([FRAME.reflection + 4, FRAME.previousReflection + 4, FRAME.streetLook + 4, FRAME.tireContacts + 4*MAX_TIRE_CONTACTS]).toEqual([FRAME.previousReflection, FRAME.streetLook, FRAME.tireContacts, FRAME.exhaustPhase]);
  expect(FRAME.exhaustPhase + 4).toBe(WATER_BOUNDS);
  expect(WATER_MARKS + 8 * MAX_WATER_MARKS).toBe(WATER_PATHS);
  // The supply drops' casts, a visor's optic, the made materials and the orb's screen are the block's last lanes
  // (supply-sky.ts, post.ts opticFrame, texgen/slots.ts, orb.ts writeOrb), then the terrain window's corner (terrain.ts).
  expect([WATER_PATHS + 4 * MAX_WATER_MARKS, ROOF_AT + 4, CAST_AT + 4, LAMP_AT + 8 + 16 + 4, GLASS_AT + 4, SHORE_AT + 4, DROPS_AT + 4 * DROP_LANES, OPTIC_AT + 8, MADE_AT + 8 * MATERIAL_RECIPES.length, ORB_AT + 4 * ORB_LANES, WINDOW_AT + 4]).toEqual([ROOF_AT, CAST_AT, LAMP_AT, GLASS_AT, SHORE_AT, DROPS_AT, OPTIC_AT, MADE_AT, ORB_AT, WINDOW_AT, FRAME_FLOATS]);
  expect(FRAME_BLOCK).toContain(`highp vec4 fDrops[${DROP_LANES}]`);
  expect(FRAME_BLOCK).toContain("highp vec4 fRoof, fCast, fLamp, fLampColor;\n  highp mat4 fLampShadow;\n  highp vec4 fLampWay, fGlass;\n  highp vec4 fShore;\n  highp vec4 fDrops[11];\n  highp vec4 fOptic, fPhosphor;\n  highp vec4 fMade[" + MATERIAL_RECIPES.length * 2 + "];\n  highp vec4 fOrb[" + ORB_LANES + "];\n  highp vec4 fWindow;\n};");
  expect(FRAME_BLOCK).toContain(`fWaterMarks[${2 * MAX_WATER_MARKS}]`);
  const p = new FramePacket();
  p.split = 384;
  p.cascades[0] = 2;
  p.spheres[3] = 64;
  expect([p.frame[FRAME.split], p.frame[FRAME.cascades], p.frame[FRAME.spheres + 3], p.cascades.length, p.spheres.length]).toEqual([384, 2, 64, 64, 16]);
  // A frame starts with no far draw fading, no casters and no cascade drawn.
  p.drawCount = 3;
  p.drawFade[2] = 2048;
  [p.casterCount, p.casterDropped, p.cascadeCount, p.cascadesDrawn] = [5, 1, 2, 3];
  p.beginFrame();
  expect([p.drawFade[2], p.casterCount, p.casterDropped, p.cascadeCount, p.cascadesDrawn, p.split]).toEqual([0, 0, 0, 0, 0, 384]);
});

/** Floats a vertex text writes for each vertex: gl_Position and its outputs. */
const outputs = (vertex: string): number => {
  const size: Record<string, number> = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4, mat3: 9 };
  return 4 + [...vertex.matchAll(/^(?:flat )?out (\w+) ([^;]+);/gm)].reduce((sum, m) => sum + size[m[1]!]! * m[2]!.split(",").length, 0);
};

test("a textured draw is drawn undyed where its material has no masks, and by a program that drops nothing unless it is cut out or handed over", () => {
  const p = new FramePacket();
  p.split = 384;
  const draw = (flags: number, hand = 0, layer = 0, fade = 0): number => {
    const d = p.drawCount++;
    [p.drawFlags[d], p.drawHand[d], p.drawLayer[d], p.drawFade[d]] = [flags, hand, layer, fade];
    return d;
  };
  const masks = (mask: number, mask2: number): PackMaterial => ({ mask, mask2 }) as PackMaterial;
  const [none, one, second] = [masks(-1, -1), masks(3, -1), masks(-1, 4)];
  expect([
    drawProgram(p, draw(DRAW_TEXTURED), none),
    drawProgram(p, draw(DRAW_TEXTURED | DRAW_CUTOUT), none),
    drawProgram(p, draw(DRAW_TEXTURED, HAND_FAR), none),
    drawProgram(p, draw(DRAW_TEXTURED | DRAW_BLEND), one),
    drawProgram(p, draw(DRAW_TEXTURED, HAND_NEAR), second),
    drawProgram(p, draw(DRAW_TEXTURED, 0, 5), none),
  ].map(named)).toEqual(["surfaceUndyedWhole", "surfaceUndyed", "surfaceUndyed", "surfaceWhole", "surface", "surfaceLayer"]);
  expect([draw(DRAW_PULLED, 0, 0, 900), draw(0, 0, 0, 900), draw(0, HAND_NEAR), draw(DRAW_WATER | DRAW_BLEND), draw(DRAW_BLEND), draw(0)].map((d) => named(drawProgram(p, d, undefined)))).toEqual(["pulled", "far", "far", "water", "seeThrough", "flat"]);
  p.split = 0;
  expect(named(drawProgram(p, draw(DRAW_BLEND), undefined))).toBe("flat");

  p.frame[WATER_MARK_COUNT] = 1;
  expect(named(drawProgram(p, draw(DRAW_WATER | DRAW_BLEND), undefined))).toBe("waterWake");
  // The whole undyed variant skips both dye matrices and the hand-over distance, saving nineteen floats.
  const tier = TIERS[2]!;
  const [any, undyed, whole] = [PROGRAMS.surface!(tier, "astc"), PROGRAMS.surfaceUndyed!(tier, "astc"), PROGRAMS.surfaceUndyedWhole!(tier, "astc")];
  expect([any, PROGRAMS.surfaceWhole!(tier, "astc"), undyed, whole].map((t) => outputs(t.vertex))).toEqual([43, 42, 25, 24]);
  expect([any, undyed, whole].map((t) => [t.fragment.split("discard").length - 1, t.fragment.split("texture(uMask").length - 1])).toEqual([[2, 2], [2, 0], [0, 0]]);
  expect(whole.fragment).toContain("vec3 albedo = base.rgb * uTint;");
  expect(whole.fragment).toContain("float paint = 0.0;");
  expect(whole.fragment).toContain("mix(radiance,mirror*open*own,coat)");
});

test("the programs that draw prints are a lit tier's once a print's array is made", () => {
  const was = LATE.prints;
  try {
    LATE.prints = false;
    expect(tierPrograms(tierOf("high")).map(named).filter((n) => n.startsWith("surfacePrinted"))).toEqual([]);
    LATE.prints = true;
    expect(tierPrograms(tierOf("high")).map(named).filter((n) => n.startsWith("surfacePrinted"))).toEqual(["surfacePrinted", "surfacePrintedCut", "surfacePrintedLayer"]);
    expect(tierPrograms(tierOf("lowpoly")).map(named).filter((n) => n.startsWith("surfacePrinted"))).toEqual([]);
  } finally {
    LATE.prints = was;
  }
});

test("a tier's programs are every one its frames may draw with, each once, the same down the governor's steps", () => {
  for (const base of TIERS) {
    for (const touch of [false, true]) {
      const tier = forTouch(base, touch);
      const names = tierPrograms(tier).map(named);
      expect(new Set(names).size).toBe(names.length);
      if (!tier.lit) expect(names).toEqual(["flat", "terrain", "terrainWindow", "far", "pulled", "sky", "details", "skyline", "signal", "fire", "orb", "screens"]);
      // The programs that draw prints are a tier's once a print's array has been made (LATE.prints).
      else expect(names).toEqual(Object.keys(PROGRAMS).filter((n) => (tier.post !== null || !["bloomDown", "bloomUp", "finish"].includes(n)) && (!n.startsWith("surfacePrinted") || LATE.prints)));
      const texts = new Set(names.map((n) => JSON.stringify(PROGRAMS[n]!(tier, "astc"))));
      expect(texts.size).toBe(names.length);
    }
  }
});

// The words GLSL ES 3.00 keeps for itself and gives no meaning (its specification, 3.9 Keywords, "reserved for future
// use"), and the words it uses. A text that names a value with one of either compiles nowhere, and nothing but a GPU
// says so: the sky's text once named a strike `cast`, and every frame on a real card was black while the software
// renderer's twin drew it; the shaft's once named a value `flat`, which the cost probe's compile caught.
const RESERVED = "attribute varying coherent volatile restrict readonly writeonly resource atomic_uint noperspective patch sample subroutine common partition active asm class union enum typedef template this goto inline noinline public static extern external interface long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sampler3DRect filter sizeof cast namespace using".split(" ");
const TYPES = "float int uint bool void vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 sampler2D sampler3D samplerCube sampler2DShadow samplerCubeShadow sampler2DArray sampler2DArrayShadow isampler2D isampler3D isamplerCube isampler2DArray usampler2D usampler3D usamplerCube usampler2DArray".split(" ");
const KEYWORDS = [...TYPES, ..."const uniform layout centroid flat smooth break continue do for while switch case default if else in out inout true false invariant discard return lowp mediump highp precision struct".split(" ")];

/** The names a text declares: after a type, each name of the declaration, to its semicolon, brace or closing bracket. */
function declared(code: string): string[] {
  const out: string[] = [];
  const type = new RegExp(`\\b(?:${TYPES.join("|")})\\s+([A-Za-z_]\\w*)`, "g");
  for (const m of code.matchAll(type)) {
    out.push(m[1]!);
    // What follows in the same declaration: `float a = f(x, y), b, c;` names b and c, and not x or y.
    let depth = 0;
    for (let i = m.index! + m[0].length; i < code.length; i++) {
      const ch = code[i]!;
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") {
        if (depth-- === 0) break;
      } else if (ch === ";" || ch === "{") break;
      else if (ch === "," && depth === 0) {
        const next = /^\s*([A-Za-z_]\w*)\s*(?=[=,;[])/.exec(code.slice(i + 1));
        if (next) out.push(next[1]!);
      }
    }
  }
  return out;
}

test("no program names a value with a word GLSL keeps for itself or uses", () => {
  const reserved = new Set(RESERVED);
  const taken = new Set([...RESERVED, ...KEYWORDS]);
  expect(declared("float a = f(x, y), flat = 2.0, c; vec3 n = v, cast; void main(vec4 sample, float ok) {")).toEqual(["a", "flat", "c", "n", "cast", "main", "sample", "ok"]);
  const found = new Set<string>();
  for (const tier of TIERS) {
    for (const format of TEXTURE_FORMATS) {
      for (const [name, make] of Object.entries(PROGRAMS)) {
        const p = make(tier, format);
        for (const [stage, text] of [["vertex", p.vertex], ["fragment", p.fragment]] as const) {
          const code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
          for (const m of code.matchAll(/[A-Za-z_]\w*/g)) if (reserved.has(m[0])) found.add(`${name} ${stage}: ${m[0]}`);
          for (const d of declared(code)) if (taken.has(d)) found.add(`${name} ${stage}: ${d} is declared`);
        }
      }
    }
  }
  expect([...found]).toEqual([]);
});
