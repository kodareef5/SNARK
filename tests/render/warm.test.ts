// The warm draws: each program a tier draws with is drawn once, before play first draws it, under each state play will
// draw it in (programs.ts WARM_DRAWS), into a small target of the format and samples play draws into, so a driver that
// makes a program again for a target's samples or a cut-out's coverage does so while the world loads.
import { expect, test } from "bun:test";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_EMISSIVE, DRAW_FIRE, DRAW_ORB, DRAW_PRINTED, DRAW_PULLED, DRAW_SKYLINE, DRAW_TEXTURED, DRAW_WATER } from "../../client/core/render/packet.ts";
import { CHOICE, HAS_SPLIT, HAS_WAKES, IS_DYED, IS_FADED, IS_HAIR, IS_HANDED, IS_LAYERED, IS_SWAPPING, PROGRAM, PROGRAMS, WARM_AIM, WARM_DRAWS, WARM_FORM, WARM_STATE } from "../../client/core/render/programs.ts";

const named = (n: number): string => Object.keys(PROGRAMS)[n]!;

test("each program a level's draw is chosen for is warmed in each blend and coverage that draw can set", () => {
  // The bits the choice reads, every way they can come together, but a screen's and a detail's, drawn by paths of their
  // own (gl.ts drawFaces, details); a draw blends where DRAW_BLEND and covers where cut out.
  const bits = [DRAW_FIRE, DRAW_ORB, DRAW_EMISSIVE, DRAW_TEXTURED, DRAW_SKYLINE, DRAW_PRINTED, DRAW_CUTOUT, DRAW_PULLED, DRAW_WATER, DRAW_BLEND, IS_LAYERED, IS_DYED, IS_HANDED, IS_SWAPPING, IS_FADED, HAS_WAKES, HAS_SPLIT, IS_HAIR];
  const met = new Map<number, number>();
  for (let k = 0; k < 1 << bits.length; k++) {
    let is = 0;
    for (let b = 0; b < bits.length; b++) if (k & (1 << b)) is |= bits[b]!;
    const row = CHOICE.find((c) => (is & c.all) === c.all && (c.any === 0 || (is & c.any) !== 0) && (is & c.none) === 0)!;
    const state = 1 << (((is & DRAW_BLEND) !== 0 ? 2 : 0) + ((is & DRAW_CUTOUT) !== 0 ? 1 : 0));
    met.set(row.program, (met.get(row.program) ?? 0) | state);
  }
  const chosen = [...met.keys()];
  expect(Object.fromEntries(chosen.map((n) => [named(n), WARM_DRAWS[n]!.states]))).toEqual(Object.fromEntries(chosen.map((n) => [named(n), met.get(n)!])));
  // A textured draw's level has a surface's streams; a flat draw's vertices are a level's alone.
  for (const row of CHOICE) if (met.has(row.program)) expect([named(row.program), WARM_DRAWS[row.program]!.form]).toEqual([named(row.program), (row.all & DRAW_TEXTURED) !== 0 ? WARM_FORM.surface : WARM_FORM.mesh]);
});

test("the passes of their own are warmed as the shell draws them: casters into a shadow map, the finish into the canvas", () => {
  const of = (name: keyof typeof PROGRAM) => WARM_DRAWS[PROGRAM[name]]!;
  expect([of("depth"), of("depthCutout"), of("depthTerrain"), of("depthTerrainWindow")].map((w) => [w.states, w.aim])).toEqual(Array(4).fill([WARM_STATE.opaque, WARM_AIM.shadow]));
  // A caster reads a body's skin and a cut-out's texture coordinates, so its streams are a textured level's.
  expect([of("depth").form, of("depthCutout").form]).toEqual([WARM_FORM.surface, WARM_FORM.surface]);
  expect([of("terrain").form, of("depthTerrain").form, of("sky").form, of("details").form, of("screens").form]).toEqual([WARM_FORM.tile, WARM_FORM.tile, WARM_FORM.none, WARM_FORM.detail, WARM_FORM.face]);
  // A detail is cut out where opaque and weighed light where blended (gl.ts details).
  expect(of("details").states).toBe(WARM_STATE.covered | WARM_STATE.blended);
  expect([of("bloomDown"), of("bloomUp"), of("finish")].map((w) => [w.states, w.aim])).toEqual([[WARM_STATE.opaque, WARM_AIM.bloom], [WARM_STATE.blended, WARM_AIM.bloom], [WARM_STATE.opaque, WARM_AIM.canvas]]);
});

test("the first frame waits for what people, their shadows, blood and fire draw with, and not for the world's own", () => {
  const early = Object.keys(PROGRAM).filter((name) => WARM_DRAWS[PROGRAM[name as keyof typeof PROGRAM]]!.early);
  // Every textured program draws people's skin, garments, hair or prints.
  for (const name of Object.keys(PROGRAM)) if (WARM_DRAWS[PROGRAM[name as keyof typeof PROGRAM]]!.form === WARM_FORM.surface) expect(early).toContain(name);
  expect(early.filter((name) => WARM_DRAWS[PROGRAM[name as keyof typeof PROGRAM]]!.form !== WARM_FORM.surface)).toEqual(["details", "fire"]);
});
