// Small details (client/core/details/): the sheets and the pack built from them, what a client reads as an occasion from
// the bodies it sees, that every client makes the same particles of a cue, and what each tier keeps within its budget.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Assets } from "../../client/core/assets/assets.ts";
import { Details } from "../../client/core/details/details.ts";
import { GROUND_GRASS, GROUND_SAND, GROUND_STONE, GROUND_WATER, dustColour, groundAt } from "../../client/core/details/ground.ts";
import { Occasions } from "../../client/core/occasions.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { detailKeeps, shapeOf } from "../../client/core/render/detailtext.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_PUFF, DRAW_BLEND, DRAW_CUTOUT, DRAW_DETAILS, FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { AnimState, CUE_HELD, CUE_LAND, CUE_TORPOR, LAYER_FLINCH } from "../../shared/anim/pose.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { OCCASIONS, effectOf, type Occasion } from "../../shared/pack/details.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import { ACT_SWING, HOLD_TOOL } from "../../shared/sim/weapon.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { SOURCE } from "../../tools/art/source.ts";
import { detailInputs } from "../../tools/pack/details.ts";
import { corePack } from "../fixtures/pack.ts";
import { provingView } from "../../tools/snap.ts";
import { playDetails } from "../../tools/snap/details.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const DODO = reg.index.get("core:dodo")!;
const SURVIVOR = reg.index.get("core:survivor")!;
const hf = buildProvingHeightfield();
const pack = corePack();
const characters = new Characters(reg, pack, new Assets(reg, pack));
const animOf = (kind: number) => characters.creature(kind);
/** A grassy spot beyond the plaza. */
const [X, Z] = [256, 362];

test("the details pack is as new as the sheets and pictures it is made from", () => {
  const built = parsePack(new Uint8Array(readFileSync(join(SOURCE, "core/details/details.snpk"))));
  expect(built.header.details?.inputs).toBe(detailInputs());
  // The core pack carries it, and the dodo answers every occasion its sheet names.
  const d = pack.header.details!;
  expect(d.sheets.find((s) => s.owner === "core:dodo") && Object.keys(d.sheets.find((s) => s.owner === "core:dodo")!.cues).sort()).toEqual(["death", "down", "land", "peck", "splash", "step", "struck", "thrown", "up"]);
  expect(d.atlas.side).toBeLessThanOrEqual(512);
});

test("an effect is read with its defaults, and a sheet that would draw wrong is refused with the field named", () => {
  const pictureOf = (n: string): number => (n === "a" ? 0 : -1);
  const e = effectOf("t:x/e", { pictures: ["a"], count: 3, shape: { ring: 0.3 }, flutter: { sway: 0.1, hz: 2 } }, pictureOf);
  expect([e.count, e.shape, e.radius, e.sway, e.swayHz, e.pass, e.face, e.reach]).toEqual([[3, 3], "ring", 0.3, 0.1, 2, "blend", "camera", 40]);
  expect(() => effectOf("t:x/e", { pictures: ["b"] }, pictureOf)).toThrow(/no picture "b"/);
  expect(() => effectOf("t:x/e", { pictures: ["a"], spin: 3 }, pictureOf)).toThrow(/no field "spin"/);
  expect(() => effectOf("t:x/e", { pictures: ["a"], life: [2, 1] }, pictureOf)).toThrow(/life is a number or \[least, most\]/);
  expect(() => effectOf("t:x/e", { pictures: ["a"], pass: "add" }, pictureOf)).toThrow(/pass is cutout or blend/);
});

/** A view of `birds` dodos standing on the grass, and one survivor, as a client samples them at `tick`. */
function sample(r: RemoteSample, tick: number, birds: { id: number; x: number; z: number; st: AnimState; y?: number }[], striker?: AnimState): void {
  r.count = 0;
  r.tick = tick;
  const put = (id: number, kind: number, x: number, y: number, z: number, st: AnimState): void => {
    const n = r.count++;
    [r.id[n], r.kind[n], r.x[n], r.y[n], r.z[n], r.yaw[n], r.flags[n]] = [id, kind, x, y, z, 0.3, st.grounded ? 1 : 0];
    r.colors.fill(0, n * 6, n * 6 + 6);
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    [r.span[n], r.grown[n], r.seat[n], r.hasLook[n]] = [0, 0, 0, 0];
    r.anim[n] = st.pack();
    r.cue[n] = (st.packCue() | (st.held ? CUE_HELD : 0)) >>> 0;
  };
  for (const b of birds) put(b.id, DODO, b.x, b.y ?? hf.heightAt(b.x, b.z), b.z, b.st);
  if (striker) put(9000, SURVIVOR, birds[0]!.x - 1.2, hf.heightAt(birds[0]!.x - 1.2, birds[0]!.z), birds[0]!.z, striker);
}

test("a client reads each occasion from what it already has of a body, once, and nothing from a body it has just seen", () => {
  const listens = new Uint16Array(reg.defs.length);
  listens[DODO] = (1 << OCCASIONS.length) - 1;
  const occ = new Occasions(reg.defs.map((_, k) => animOf(k)), listens, (o: Occasion) => 1 << OCCASIONS.indexOf(o));
  const r = new RemoteSample();
  const st = new AnimState();
  const bird = { id: 40, x: X, z: Z, st };
  const seen: string[] = [];
  const run = (tick: number, set: (s: AnimState) => void, striker?: AnimState): void => {
    st.unpack(0, 0);
    set(st);
    sample(r, tick, [bird], striker);
    occ.update(r, [], [], null, X, 2, Z - 3, tick * (1000 / TICK_RATE));
    for (const h of occ.happened) seen.push(`${h.occasion}@${h.tick}${h.fromX === h.fromX ? " from the side" : ""}`);
  };
  // Seen for the first time already landing: nothing.
  run(100, (s) => ((s.cue = CUE_LAND), (s.cueStart = 99)));
  run(101, (s) => ((s.cue = CUE_LAND), (s.cueStart = 99)));
  // Struck by the survivor beside it, whose swing began four ticks before.
  const swing = new AnimState();
  swing.setAction(ACT_SWING, HOLD_TOOL, 106);
  run(110, (s) => ((s.layer = LAYER_FLINCH), (s.layerStart = 110)), swing);
  run(111, (s) => ((s.layer = LAYER_FLINCH), (s.layerStart = 110)), swing);
  // Knocked out, and coming round.
  run(120, (s) => ((s.out = true), (s.cue = CUE_TORPOR), (s.cueStart = 119)));
  run(200, (s) => ((s.cue = CUE_TORPOR), (s.cueStart = 200)));
  // Held, then thrown fast through the air, then landing.
  run(300, (s) => (s.held = true));
  run(301, (s) => ((s.grounded = false), (s.speed = 8)));
  run(320, (s) => ((s.cue = CUE_LAND), (s.cueStart = 320)));
  // Into the water from the air.
  run(330, (s) => (s.grounded = false));
  run(331, (s) => (s.mode = MODE_SWIM));
  expect(seen).toEqual(["struck@110 from the side", "down@119", "up@200", "thrown@301", "land@320", "splash@331"]);
});

/** A client's details, fed `frames` frames a sixtieth of a second apart from tick 1000, `set` saying each bird's state at each tick. */
function play(tier: string, birds: number, set: (s: AnimState, t: number, k: number) => void, frames: number, spacing = 1.4): { details: Details; p: FramePacket; most: number; fill: number; draws: number; cut: number } {
  const details = new Details(reg, pack.header.details, pack.palette, animOf);
  const p = new FramePacket();
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [X, hf.heightAt(X, Z) + 1.7, Z - 6, 0, -0.25];
  cam.update();
  p.tier = tierOf(tier);
  const r = new RemoteSample();
  const list = Array.from({ length: birds }, (_, k) => ({ id: 100 + k, x: X + (k % 10) * spacing - 6, z: Z + Math.floor(k / 10) * spacing, st: new AnimState() }));
  let [most, fill, draws, cut] = [0, 0, 0, 0];
  for (let f = 0; f < frames; f++) {
    const tick = 1000 + f * 0.5;
    list.forEach((b, k) => {
      b.st.unpack(0, 0);
      set(b.st, (tick - 1000) / TICK_RATE, k);
    });
    sample(r, tick, list);
    p.beginFrame();
    cut = details.frame(p, cam, r, [], [], null, hf, p.tier, tick * (1000 / TICK_RATE));
    most = Math.max(most, details.pool.count);
    fill = Math.max(fill, p.detailFill);
    draws = Math.max(draws, (cut > 0 ? 1 : 0) + (p.detailCount > cut ? 1 : 0));
  }
  return { details, p, most, fill, draws, cut };
}

const landing = (s: AnimState, t: number): void => {
  if (t < 0.2) s.grounded = false;
  else [s.cue, s.cueStart] = [CUE_LAND, 1006 & 255];
};

test("every client that saw a landing makes the same feathers and dust, which land, lie and are gone", () => {
  const a = play("medium", 1, landing, 120);
  const b = play("medium", 1, landing, 120);
  expect(a.p.detailCount).toBeGreaterThan(3);
  expect(hashBytes(new Uint8Array(a.p.details.buffer, 0, a.p.detailCount * DETAIL_FLOATS * 4))).toBe(hashBytes(new Uint8Array(b.p.details.buffer, 0, b.p.detailCount * DETAIL_FLOATS * 4)));
  // Ten seconds on, nothing is left.
  expect(play("medium", 1, landing, 600).details.pool.count).toBe(0);
  // Two seconds on, the feathers lie on the grass, and the dust is gone.
  const c = play("medium", 1, landing, 120);
  const pool = c.details.pool;
  expect(pool.count).toBeGreaterThan(0);
  for (let i = 0; i < pool.count; i++) {
    expect(pool.landed[i]).toBeGreaterThanOrEqual(0);
    expect(Math.abs(pool.y[i]! - hf.heightAt(pool.x[i]!, pool.z[i]!))).toBeLessThan(0.05);
  }
});

test("a hundred bodies going down at once keep within the tier's pool, fill and two draws, and low poly makes half as many", () => {
  const down = (s: AnimState, t: number): void => {
    if (t >= 0.1) [s.out, s.cue, s.cueStart] = [true, CUE_TORPOR, 1003];
  };
  for (const tier of ["lowpoly", "medium", "ultra"]) {
    const t = tierOf(tier);
    const run = play(tier, 100, down, 150, 0.9);
    expect(run.most).toBeLessThanOrEqual(t.details.pool);
    // A burst is thinned at its birth, so the fill can pass the cap by at most a burst's.
    expect(run.fill).toBeLessThan(t.details.fill * 1.25);
    expect(run.draws).toBeLessThanOrEqual(2);
  }
  const low = play("lowpoly", 1, landing, 40).most;
  const medium = play("medium", 1, landing, 40).most;
  expect(low).toBeLessThan(medium);
});

test("the feathers are written first, to be cut out, and the dust after them far to near, and low poly's shapes are drawn where their twins say", () => {
  const { p, cut } = play("medium", 3, landing, 20);
  expect(cut).toBeGreaterThan(0);
  expect(p.detailCount).toBeGreaterThan(cut);
  let far = Infinity;
  for (let i = 0; i < p.detailCount; i++) {
    const o = i * DETAIL_FLOATS;
    const flags = (p.detailWords[o + DETAIL.misc]! >>> 8) & 255;
    // Feathers are free cards of the feather shape; dust faces the eye.
    expect((flags & DETAIL_PUFF) !== 0).toBe(i >= cut);
    if (i < cut) continue;
    const d = Math.hypot(p.details[o]!, p.details[o + 1]!, p.details[o + 2]!);
    expect(d).toBeLessThanOrEqual(far + 1 / 64);
    far = d;
  }
  expect(DRAW_DETAILS & (DRAW_CUTOUT | DRAW_BLEND)).toBe(0);
  // A feather shows along its middle and not at its corners; a puff is soft at its edge.
  const at = [0, 0, 0];
  shapeOf(0, 0, 0.2, at);
  expect(at[0]).toBe(1);
  shapeOf(0, 0.95, 0.95, at);
  expect(at[0]).toBe(0);
  shapeOf(1, 0.6, 0, at);
  expect(at[0]).toBeGreaterThan(0);
  expect(at[0]).toBeLessThan(1);
  // A particle all but gone keeps one pixel in sixteen.
  let kept = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (detailKeeps(0.07, x, y)) kept++;
  expect(kept).toBe(1);
});

test("the rasterizer draws a landing on low poly and on medium from the same numbers the shell is given, pinned", () => {
  const seen: string[] = [];
  for (const tier of ["lowpoly", "medium"]) {
    const view = provingView(160, 120);
    view.scene.assets.tier = tierOf(tier);
    view.scene.viewHeight = 120;
    const seq = playDetails(view, "land", 160, 120, { moments: [0.4], rows: 1 });
    const p = view.scene.packet;
    const frame = seq.frames[0]![0]!;
    // The same frame without its details draws: what they changed.
    const draws = [...Array(p.drawCount).keys()].filter((d) => (p.drawFlags[d]! & DRAW_DETAILS) !== 0);
    for (const d of draws) p.drawInstances[d] = 0;
    view.raster.render(p);
    let changed = 0;
    for (let i = 0; i < frame.length; i += 4) if (frame[i] !== view.raster.color[i] || frame[i + 1] !== view.raster.color[i + 1]) changed++;
    // The particles are pinned; the picture is held to what they changed, which other work on the ground may move.
    seen.push(`${tier}: ${draws.length} draws, ${p.detailCount} particles ${hashBytes(new Uint8Array(p.details.buffer, 0, p.detailCount * DETAIL_FLOATS * 4))}`);
    expect(changed).toBeGreaterThan(400);
    expect(changed).toBeLessThan(4000);
  }
  expect(seen).toEqual(["lowpoly: 2 draws, 4 particles 715469007", "medium: 2 draws, 8 particles 2083408453"]);
});

test("the ground's kind and the dust it gives: sand at the shore, soil from grass, pale stone, none on water", () => {
  const palette = pack.palette;
  const out = [0, 0, 0];
  expect(groundAt(hf, X, hf.heightAt(X, Z), Z)).toBe(GROUND_GRASS);
  expect(dustColour(hf, palette, GROUND_GRASS, X, Z, out)).toBe(true);
  // Dust from grass is the colour of dry soil, warmer than it is green.
  expect(out[0]! > out[2]! && out[1]! < out[0]! + 20).toBe(true);
  expect(groundAt(hf, 256, 0, 256)).toBe(GROUND_STONE);
  expect(groundAt(hf, 172, hf.seaLevel - 1, 256)).toBe(GROUND_WATER);
  expect(dustColour(hf, palette, GROUND_WATER, 172, 256, out)).toBe(false);
  // The proving ground's low grass is no beach: sand is low ground within reach of the sea.
  expect(groundAt(hf, X, hf.seaLevel + 0.5, Z) === GROUND_SAND).toBe(false);
});
