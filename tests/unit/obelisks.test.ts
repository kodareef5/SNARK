// An obelisk as a map sets it down (shared/world/obelisks.ts).
import { expect, test } from "bun:test";
import { OBELISK, OBELISK_PIECES, TRAVEL_TERMINAL, obeliskStatics } from "../../shared/world/obelisks.ts";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { EYE_PERIOD, aperture, eyeBloom, eyeEnergy, eyeFigure, eyePhase, eyePower, eyeRadiance, eyeSeed, shutterOpening, writeEyeSky } from "../../client/core/render/tide-eye.ts";
import { parseMap, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { CAST_PHASE, EMITTERS, EYE_COLORS, EYE_FORMS, EYE_KNOT, KEEL, LANTERN_MASTS, LENS_HEIGHT, nextCast, type TideEyeSite } from "../../shared/world/tide-eye.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { createMapWorld } from "../../server/world.ts";
import { flatMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";

import { placeCamera } from "../../tools/mapworld/obelisk-cameras.ts";
import { placeObelisks, gradeTransferDecks } from "../../tools/mapworld/places.ts";
import { gridAt } from "../../tools/mapworld/base.ts";
import { S, type Ground, type World } from "../../tools/mapworld/ground.ts";

const reg = coreRegistry();

test("an obelisk stands on the ground, three pieces high, with its terminal on the ground a step in front of it along its facing", () => {
  const ground = (x: number, z: number): number => x * 0.01 + z * 0.02;
  const pieces = obeliskStatics(reg, { name: "north", x: 300, z: 200, yaw: 16384 }, ground);
  expect(pieces.map((p) => p.kind)).toEqual([...Array<string>(OBELISK_PIECES).fill(OBELISK), TRAVEL_TERMINAL]);
  const [low, , top, terminal] = pieces;
  expect([low!.y, top!.y + 15]).toEqual([ground(300, 200) + 15, ground(300, 200) + 90]);
  // A quarter turn faces +x: the terminal stands 3 + 1.5 + 0.3 m out that way, on the ground there.
  expect([terminal!.x, terminal!.z, terminal!.y].map((v) => Math.round(v * 1000) / 1000)).toEqual([304.8, 200, Math.round((ground(304.8, 200) + 0.6) * 1000) / 1000]);
});

test("a Tide Eye streams its site in the map head and keeps the deck centre and the lens opening clear", () => {
  const site = { name: "Virginia Key", color: "blue", x: 64, z: 64, y: 3.5, yaw: 0, radius: 70 } as const;
  const bytes = writeMap(flatMap(4, { tideEyes: [site] }));
  expect(readHead(bytes).tideEyes).toEqual([site]);
  expect(parseMap(bytes).tideEyes).toEqual([site]);
  expect(readHead(writeMap(flatMap(4))).tideEyes).toBeUndefined();
  expect(() => writeMap(flatMap(4, { tideEyes: [{ ...site, radius: 0 }] }))).toThrow("invalid Tide Eye");
  const parts = obeliskStatics(reg, site, () => site.y);
  const terminal = parts.pop()!;
  expect([terminal.kind, terminal.x, terminal.z]).toEqual([TRAVEL_TERMINAL, site.x, site.z]);
  expect(parts.length).toBeGreaterThan(30);
  for (const p of parts) {
    const k = reg.index.get(p.kind)!;
    expect(p.y - reg.halfY[k]!).toBeGreaterThan(site.y + 250);
    const inPupil = Math.abs(p.y - site.y - LENS_HEIGHT) < reg.halfY[k]! + 10 && Math.abs(p.x - site.x) < reg.halfX[k]! + 10;
    expect(inPupil).toBe(false);
  }
});

/** A frame's lanes for one site: its phase and kind, power, clock, bloom, seed and storm, as writeEyeSky leaves them. */
const lanes = (frame: Float32Array) => {
  const at = FRAME.eyes, stamp = frame[at + 3]!, kind = Math.floor(stamp / EYE_PERIOD);
  return { phase: stamp - kind * EYE_PERIOD, form: kind % 3, figure: Math.floor(kind / 3), power: frame[at + 7]!, clock: frame[at + 8]!, bloom: frame[at + 9]!, seed: frame[at + 10]!, storm: frame[at + 11]!, foot: frame[at + 12]!, open: frame[at + 15]! };
};
/** The light on the ray from the eye to a point that many metres east, up and north of it. */
const toward = (frame: Float32Array, x: number, y: number, z: number): { light: Float64Array; through: number } => {
  const light = new Float64Array(3), l = Math.hypot(x, y, z);
  return { through: eyeRadiance(frame, [x / l, y / l, z / l], light), light };
};
const SITES: readonly [TideEyeSite, TideEyeSite, TideEyeSite] = [
  { name: "Blue", color: "blue", x: 3000, z: 4000, y: 4, yaw: 0, radius: 70 },
  { name: "Red", color: "red", form: "sextant", x: 3000, z: 4000, y: 4, yaw: 0, radius: 70 },
  { name: "Green", color: "green", form: "lantern", x: 3000, z: 4000, y: 4, yaw: 0, radius: 70 },
];
/** The second, on the server's clock, that is `phase` into a site's cycle `cycle`. */
const at = (site: TideEyeSite, cycle: number, phase: number): number => cycle * EYE_PERIOD + phase - EYE_COLORS.indexOf(site.color) * 40;

test("three observers share each site's ignition clock, and the sky optics follow the landmark through parallax", () => {
  const [blue] = SITES;
  expect(SITES.map((site) => eyePhase(15, { ...blue, color: site.color }))).toEqual([15, 55, 95]);
  expect([aperture(2), eyePower(15), aperture(32), eyePower(40)]).toEqual([0, 1, 1, 0]);
  const frame = new Float32Array(FRAME_FLOATS);
  writeEyeSky(frame, [blue], 15, 0, 0, 0);
  // The figure stands over the tall prong's finial, 55 m off the deck's axis, and the beam's foot is on it.
  expect([...frame.slice(FRAME.eyes, FRAME.eyes + 3)]).toEqual([3000 + EMITTERS[0].x, 3450, 4000]);
  expect(lanes(frame)).toMatchObject({ phase: 15, form: 0, power: 1, clock: 15, open: 1, foot: 4 + KEEL + EMITTERS[0].h });
  // Low toward the site the sky is the site's colour; at the figure's middle the cell hides nearly all behind it; and
  // nothing is drawn under the horizon.
  const low = toward(frame, 3000, 1000, 4000);
  expect(low.light[2]!).toBeGreaterThan(low.light[0]!);
  expect(toward(frame, 3000 + EMITTERS[0].x, 3450, 4000).through).toBeLessThan(0.3);
  expect(toward(frame, -1, 0, 0).through).toBe(1);
  // Another observer, a cycle on: the same clock, the same seed for that cycle, and the figure moved by where they stand.
  const other = new Float32Array(FRAME_FLOATS);
  writeEyeSky(frame, [blue], 135, 10, 2000, 30);
  writeEyeSky(other, [blue], 135, -400, 0, 900);
  expect([...frame.slice(FRAME.eyes, FRAME.eyes + 3)]).toEqual([2990 + EMITTERS[0].x, 1450, 3970]);
  expect(lanes(other)).toMatchObject({ ...lanes(frame), foot: lanes(frame).foot + 2000 });
  writeEyeSky(frame, [blue], 2, 0, 0, 0);
  expect(frame.slice(FRAME.eyes).every(v => v === 0)).toBe(true);
});

test("no figure follows itself, every figure comes round, and an ignition's seed is its site's and its cycle's own", () => {
  for (const site of SITES) {
    const seen = new Set<number>(), seeds = new Set<number>();
    for (let cycle = -40; cycle < 400; cycle++) {
      const figure = eyeFigure(site, cycle);
      expect(figure).not.toBe(eyeFigure(site, cycle + 1));
      expect([0, 1, 2]).toContain(figure);
      seen.add(figure);
      seeds.add(eyeSeed(site, cycle));
      const frame = new Float32Array(FRAME_FLOATS);
      writeEyeSky(frame, [site], at(site, cycle, 20), 0, 0, 0);
      expect(lanes(frame)).toMatchObject({ figure, seed: Math.fround(eyeSeed(site, cycle)) });
    }
    expect(seen.size).toBe(3);
    expect(seeds.size).toBeGreaterThan(400);
  }
  expect(eyeSeed(SITES[0], 7)).not.toBe(eyeSeed(SITES[1], 7));
});

test("nothing in the sky runs backwards: the clock only advances, the figure never shrinks, and it fades where it stands", () => {
  let before = 0;
  for (let phase = 0; phase <= EYE_PERIOD; phase += 0.25) {
    expect(eyeBloom(phase)).toBeGreaterThanOrEqual(before);
    before = eyeBloom(phase);
  }
  for (const site of SITES) {
    const figures = new Set<number>();
    for (let cycle = 0; figures.size < 3; cycle++) {
      if (figures.has(eyeFigure(site, cycle))) continue;
      figures.add(eyeFigure(site, cycle));
      // How far out the figure reaches, second by second from its ignition to the end of its fade, with the cell
      // and the beam left out: the farthest ring on which it is a tenth as bright as its brightest ring. A figure is
      // not round (the Sextant's arc is an oval that turns, the Lantern's curtains are lobed), so the measure wanders
      // by up to 400 m as it turns; what it never does is come back in, as the old display did by 660 m.
      let reach = 0, clock = 0, full = 0;
      for (let phase = 10; phase <= 36; phase++) {
        const frame = new Float32Array(FRAME_FLOATS);
        writeEyeSky(frame, [site], at(site, cycle, phase), site.x + EMITTERS[EYE_FORMS.indexOf(site.form)]!.x, 0, site.z);
        expect(lanes(frame).clock).toBeGreaterThan(clock);
        clock = lanes(frame).clock;
        frame[FRAME.eyes + 11] = 0;
        frame[FRAME.eyes + 15] = 0;
        const rings = Array.from({ length: 56 }, (_, i) => {
          const r = 150 + i * 50;
          let most = 0;
          for (let a = 0; a < 72; a++) most = Math.max(most, toward(frame, r * Math.cos(a * Math.PI / 36), 3450, r * Math.sin(a * Math.PI / 36)).light.reduce((sum, v) => sum + v, 0));
          return most;
        });
        const brightest = Math.max(...rings);
        expect(brightest).toBeGreaterThan(0);
        const now = 150 + 50 * rings.findLastIndex((v) => v > brightest * 0.1);
        expect(now).toBeGreaterThanOrEqual(reach - 400);
        reach = Math.max(reach, now);
        if (phase === 16) full = now;
        // Through its fade it stands at least as far out as it did at full power.
        if (phase >= 28) expect(now).toBeGreaterThanOrEqual(full - 400);
      }
      expect(full).toBeGreaterThan(700);
      expect(reach).toBeGreaterThanOrEqual(full);
    }
  }
});

test("each beam stands on its emitter whatever the heading, rises as it charges, and is gone before the cell it enters", () => {
  for (const site of SITES) for (const yaw of [0, 9000, 30000, 51111]) {
    const turned = { ...site, yaw }, form = EYE_FORMS.indexOf(site.form), a = yaw * Math.PI / 32768;
    const frame = new Float32Array(FRAME_FLOATS);
    // Idle: the figure is over and the beam alone is lit. The cell is left out, to see the beam by itself.
    writeEyeSky(frame, [turned], at(site, 0, 60), 0, 0, 0);
    expect(lanes(frame)).toMatchObject({ power: 0, open: 1, foot: 4 + KEEL + EMITTERS[form]!.h });
    frame[FRAME.eyes + 11] = 0;
    // An emitter stands where the scene draws the model's: a point across and deep of the axis, turned by the heading.
    const place = (across: number, deep: number): [number, number] => [site.x + across * Math.cos(a) + deep * Math.sin(a), site.z - across * Math.sin(a) + deep * Math.cos(a)];
    const emitters = form === 2 ? LANTERN_MASTS.map(([across, deep]) => place(across, deep)) : [place(EMITTERS[form]!.x, 0)];
    const foot = lanes(frame).foot, top = 3450 - 150;
    for (const [x, z] of emitters) {
      const sum = (y: number, dx = 0): number => toward(frame, x + dx, y, z).light.reduce((s, v) => s + v, 0);
      expect(sum(foot + 400)).toBeGreaterThan(0.2);
      // Under its foot there is none, 120 m aside next to none (where no other mast's beam is behind), and it has
      // faded out before the cell's sheet.
      expect(sum(foot - 30)).toBe(0);
      if (form !== 2) expect(sum(foot + 400, 120)).toBeLessThan(0.01);
      // (From here two of the Lantern's masts nearly line up, and one's beam shows faintly behind the other's top.)
      expect(sum(top - 20)).toBeLessThan(form === 2 ? 0.02 : 0.005);
    }
    // As it charges the beam has risen part way: lit low, not yet lit high.
    writeEyeSky(frame, [turned], at(site, 0, 7.5), 0, 0, 0);
    frame[FRAME.eyes + 11] = 0;
    const [x, z] = emitters[0]!;
    const sum = (y: number): number => toward(frame, x, y, z).light.reduce((s, v) => s + v, 0);
    expect(sum(foot + 200)).toBeGreaterThan(0);
    expect(sum(top - 600)).toBe(0);
  }
});

/** How bright an instrument's own light is at a channel's middle, as luma of light after exposure. */
const channel = (frame: Float32Array, x: number, y: number, z: number, across = 0): number => {
  const e = [0, 0, 0];
  eyeEnergy(frame, x, y, z, NaN, across, 0.05, e);
  return 0.2126 * e[0]! + 0.7152 * e[1]! + 0.0722 * e[2]!;
};

test("the storm hides the beam's end for as long as the beam is lit, and lightning lights the storm and the instrument together", () => {
  const [blue] = SITES;
  let strikes = 0, most = 0;
  for (let phase = 10; phase < 116; phase += 0.11) {
    const frame = new Float32Array(FRAME_FLOATS);
    writeEyeSky(frame, [blue], at(blue, 3, phase), 0, 0, 0);
    expect(lanes(frame).storm).toBeGreaterThan(0.3);
    // Looking up the beam from the deck, the knot at the storm's middle lets through next to nothing.
    expect(toward(frame, 3000 + EMITTERS[0].x + 40, 3300, 4000).through).toBeLessThan(0.2);
    // The instrument's own lights: never dark while it is open, never past their cap, and brighter in a strike.
    const light = channel(frame, 3000, 400, 4000);
    expect(light).toBeGreaterThan(0.25);
    expect(light).toBeLessThan(30);
    most = Math.max(most, light);
    if (light > 8) strikes++;
  }
  expect(strikes).toBeGreaterThan(2);
  expect(most).toBeGreaterThan(8);
  // With no site lit they give nothing, and the glow program shows them in their plain colour.
  expect(channel(new Float32Array(FRAME_FLOATS), 0, 0, 0)).toBe(0);
});

test("the storm is cloud lit as the sky lights it, grey and not the instrument's colour, in a spiral that turns as the seconds pass", () => {
  const [blue] = SITES;
  const grey = [0.45, 0.52, 0.62];
  /** The storm alone (the figure left out) toward a point on its 3,000 m sheet, `r` m from the axis at bearing `a`. */
  const storm = (seconds: number, r: number, a: number) => {
    const frame = new Float32Array(FRAME_FLOATS);
    writeEyeSky(frame, [blue], seconds, 0, 0, 0);
    frame[FRAME.eyes + 7] = 0;
    const x = 3000 + EMITTERS[0].x + r * Math.cos(a), z = 4000 + r * Math.sin(a), l = Math.hypot(x, 3000, z);
    const light = new Float64Array(3);
    const through = eyeRadiance(frame, [x / l, 3000 / l, z / l], light, grey);
    return { through, light };
  };
  // Away from the beam it is the sky's grey, not the instrument's blue: no channel much stronger than the others.
  let covered = 0;
  for (let a = 0; a < 24; a++) {
    const { through, light } = storm(at(blue, 3, 20), 1300, a * Math.PI / 12);
    if (through > 0.5) continue;
    covered++;
    expect(Math.max(...light) / Math.max(1e-6, Math.min(...light))).toBeLessThan(1.8);
  }
  expect(covered).toBeGreaterThan(6);
  // It turns as the seconds pass.
  const before = Array.from({ length: 72 }, (_, a) => storm(at(blue, 3, 20), 900, a * Math.PI / 36).through);
  const after = Array.from({ length: 72 }, (_, a) => storm(at(blue, 3, 24), 900, a * Math.PI / 36).through);
  expect(before.some((v, a) => Math.abs(v - after[a]!) > 0.1)).toBe(true);
});

test("the energy in an instrument's channels only runs forward, hot at the middle and soft to the walls", () => {
  const [blue] = SITES;
  const frame = new Float32Array(FRAME_FLOATS);
  writeEyeSky(frame, [blue], at(blue, 3, 20), 0, 0, 0);
  // Brightest at the middle, falling to next to nothing at the walls, and whiter where hot than toward the walls.
  const middle = channel(frame, 3000, 400, 4000, 0), half = channel(frame, 3000, 400, 4000, 0.5), wall = channel(frame, 3000, 400, 4000, 1);
  expect(middle).toBeGreaterThan(half);
  expect(half).toBeGreaterThan(wall);
  expect(wall).toBeLessThan(middle * 0.12);
  const e = [0, 0, 0];
  const tint = (across: number) => {
    eyeEnergy(frame, 3000, 400, 4000, NaN, across, 0.05, e);
    return e[0]! / e[2]!;
  };
  expect(tint(0)).toBeGreaterThan(tint(0.6));
  // Along a channel the energy travels up the instrument: a pattern seen at one height is seen higher a moment on.
  const along = (seconds: number) => {
    const f = new Float32Array(FRAME_FLOATS);
    writeEyeSky(f, [blue], at(blue, 3, seconds), 0, 0, 0);
    return Array.from({ length: 400 }, (_, i) => channel(f, 3000, 300 + i * 0.1, 4000));
  };
  const now = along(30), later = along(30.2);
  const shift = (k: number) => now.slice(0, 300).reduce((s, v, i) => s + Math.abs(v - later[i + k]!), 0);
  const best = [...Array(100).keys()].reduce((b, k) => (shift(k) < shift(b) ? k : b), 0);
  expect(best).toBeGreaterThan(0);
});

test("a rebuilt Wynwood keeps its Sextant bow and transfer point, while an older red header keeps the fork", () => {
  const old = { name: "Wynwood", color: "red", x: 192, y: 5, z: 192, yaw: 0, radius: 64 } as const;
  const site = { ...old, form: "sextant" } as const;
  const blue = { ...old, name: "Virginia Key", color: "blue", x: 32 } as const;
  const bytes = writeMap(flatMap(8, { tideEyes: [blue, site] }));
  expect(readHead(bytes).tideEyes).toEqual([blue, site]);
  expect(parseMap(bytes).tideEyes).toEqual([blue, site]);
  expect(readHead(writeMap(flatMap(8, { tideEyes: [old] }))).tideEyes).toEqual([old]);
  const parts = obeliskStatics(reg, site, () => site.y);
  const fork = obeliskStatics(reg, old, () => site.y);
  expect(parts.at(-1)).toEqual(fork.at(-1));
  // At the axle height only the far rim and the keel are solid. The middle is open sky.
  const axle = parts.filter(p => Math.abs(p.y - (site.y + 496)) < 12);
  expect(axle.some(p => p.x < site.x - 140)).toBe(true);
  expect(axle.some(p => Math.abs(p.x - site.x) < 20)).toBe(true);
  expect(axle.some(p => p.x < site.x - 45 && p.x > site.x - 125)).toBe(false);
  expect(fork.some(p => p.x < site.x - 140)).toBe(false);
});

test("the Sextant's white sight leads its red figure above the player's flight ceiling, whichever figure it is", () => {
  const site = { name: "Wynwood", form: "sextant", color: "red", x: 200, z: 340, y: 5, yaw: 0, radius: 64 } as const;
  const figures = new Set<number>();
  for (let cycle = 0; figures.size < 3; cycle++) {
    if (figures.has(eyeFigure(site, cycle))) continue;
    figures.add(eyeFigure(site, cycle));
    const frame = new Float32Array(FRAME_FLOATS);
    writeEyeSky(frame, [site], at(site, cycle, 15.5), site.x + EMITTERS[1].x, 0, site.z);
    expect([...frame.slice(FRAME.eyes, FRAME.eyes + 3)]).toEqual([0, 3450, 0]);
    expect(lanes(frame)).toMatchObject({ phase: 15.5, form: 1 });
    // The cell left out, to see the figure itself: somewhere on it a white sight, and red light about it.
    frame[FRAME.eyes + 11] = 0;
    let white = 0, red = 0;
    for (let r = 300; r <= 1900; r += 25) for (let a = 0; a < 180; a++) {
      const { light } = toward(frame, r * Math.cos(a * Math.PI / 90), 3450, r * Math.sin(a * Math.PI / 90));
      white = Math.max(white, Math.min(light[0]!, light[1]!, light[2]!));
      red = Math.max(red, light[0]! - light[2]!);
    }
    expect(white).toBeGreaterThan(1.5);
    expect(red).toBeGreaterThan(1);
  }
  const frame = new Float32Array(FRAME_FLOATS);
  writeEyeSky(frame, [site], 85, site.x, 0, site.z);
  expect(frame.slice(FRAME.eyes).every(v => v === 0)).toBe(true);
});

test("the Lantern streams on rebuilt maps with three banks of shutters, solid uprights and an open deck", () => {
  const old = { name: "Golf Club", color: "green", x: 192, z: 192, y: 2.1, yaw: 0, radius: 64 } as const;
  const site = { ...old, form: "lantern" } as const;
  const eyes = [site, { ...old, name: "Wynwood", form: "sextant", color: "red" }, old] as const;
  const bytes = writeMap(flatMap(8, { tideEyes: [...eyes] }));
  expect(readHead(bytes).tideEyes).toEqual([...eyes]);
  expect(parseMap(bytes).tideEyes).toEqual([...eyes]);
  const pieces = obeliskStatics(reg, site, () => site.y);
  expect(pieces.pop()).toEqual(obeliskStatics(reg, old, () => old.y).at(-1));
  const across = pieces.filter(p => Math.abs(p.y - site.y - 270 - 168) < 12);
  expect(across).toHaveLength(3);
  expect(across.every(p => Math.hypot(p.x-site.x,p.z-site.z) > 45)).toBe(true);
  const openness = (t: number) => [0,1,2].map(bank => shutterOpening(t,bank));
  expect(openness(2)).toEqual([0,0,0]);
  expect(openness(8)[0]!).toBeGreaterThan(openness(8)[1]!);
  expect(openness(8)[1]!).toBeGreaterThan(openness(8)[2]!);
  expect(openness(16)).toEqual([1,1,1]);
  expect(openness(119)[0]!).toBeGreaterThan(openness(119)[2]!);
});

test("the Lantern's green figure surrounds a dark centre above the flight ceiling, whichever figure it is", () => {
  const site = { name: "Golf", color: "green", form: "lantern", x: 0, y: 3, z: 0, radius: 64, yaw: 0 } as const;
  const figures = new Set<number>();
  for (let cycle = 0; figures.size < 3; cycle++) {
    if (figures.has(eyeFigure(site, cycle))) continue;
    figures.add(eyeFigure(site, cycle));
    const frame = new Float32Array(FRAME_FLOATS);
    writeEyeSky(frame, [site], at(site, cycle, 15.5), 0, 3000, 0);
    expect([...frame.slice(FRAME.eyes,FRAME.eyes+3)]).toEqual([0,450,0]);
    expect(lanes(frame)).toMatchObject({ phase: 15.5, form: 2 });
    // Straight up through its middle next to nothing of the sky behind shows.
    expect(toward(frame, 0, 1, 0).through).toBeLessThan(0.25);
    // The cell left out, to see the figure itself: green folds, and gaps between them.
    frame[FRAME.eyes + 11] = 0;
    const greens: number[] = [];
    for (let r = 300; r <= 1700; r += 100) for (let a = 0; a < 90; a++) {
      const { light } = toward(frame, r * Math.cos(a * Math.PI / 45), 450, r * Math.sin(a * Math.PI / 45));
      greens.push(light[1]! - light[0]!);
    }
    expect(Math.max(...greens)).toBeGreaterThan(1);
    expect(Math.min(...greens)).toBeLessThan(.3);
  }
});

test("a transfer deck and its graded edge stay clear of a road and an inland lake", () => {
  const grid = gridAt([-128, -128, 128, 128]);
  const n = grid.nx * grid.nz, height = new Float32Array(n), surface = new Uint8Array(n).fill(S.GREEN), body = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const col = i % grid.nx;
    height[i] = 2 + col / 20;
    if (col >= 48 && col <= 80) surface[i] = S.STREET;
    if (col > 80) body[i] = 1;
  }
  const at: [number, number] = [64, 64];
  const world = { obelisks: [{ name: "Test", at, face: [64, 65], color: "blue" }] } as unknown as World;
  const ground = { grid, height, surface, water: new Uint8Array(n), lakes: { body } } as unknown as Ground;
  const [site] = placeObelisks(ground, world, (c, r) => [c, r], new Uint8Array(n));
  const col = (grid.x1 - site!.x) / 2;
  expect(site!.radius).toBeGreaterThanOrEqual(16);
  expect(col + (site!.radius! + 4) / 2).toBeLessThan(48);
  const before = height.slice();
  gradeTransferDecks(ground, [site!], 0, .25);
  expect(height).not.toEqual(before);
  expect(height.filter((_, i) => surface[i] === S.STREET || body[i]! > 0)).toEqual(before.filter((_, i) => surface[i] === S.STREET || body[i]! > 0));
});

test("review cameras track the generated site and can watch from a named spawn", () => {
  const head = { tideEyes: [{ name: "Wynwood", x: 170, z: 230, y: 2, yaw: 0, color: "red", radius: 28 }], spawns: [{ name: "Bayfront Park", x: 45, z: 68, yaw: 0 }] } as const;
  const view = { obelisk: "Wynwood", x: 4, z: -2, look: [1, 2, 400] as [number, number, number] };
  expect(placeCamera(view, head)).toMatchObject({ x: 174, z: 228, look: [171, 232, 400] });
  expect(placeCamera({ ...view, fromSpawn: "Bayfront Park" }, head)).toMatchObject({ x: 49, z: 66, look: [171, 232, 400] });
  expect(() => placeCamera(view, { spawns: [] })).toThrow("Wynwood");
});

test("a cast leaves a site at one tick of its cycle, at full power and never with its mechanism shut, by whole ticks alone", () => {
  expect([CAST_PHASE, EYE_KNOT, EYE_PERIOD * TICK_RATE]).toEqual([16, 2790, 3600]);
  for (const color of EYE_COLORS) {
    const site = { color };
    let last = -1;
    for (const from of [0, 1, 479, 480, 481, 3599, 3600, 100000, 2 ** 31 - 5000]) {
      const tick = nextCast(from, color, TICK_RATE);
      // At or after the tick asked, less than a cycle on, and a whole tick.
      expect([Number.isInteger(tick), tick >= from, tick - from < EYE_PERIOD * TICK_RATE]).toEqual([true, true, true]);
      // The display, which reads seconds, is then exactly at the cast phase: full power, mechanism open.
      const phase = eyePhase(tick / TICK_RATE, site);
      expect([Math.abs(phase - CAST_PHASE) < 1e-6, eyePower(phase), aperture(phase)]).toEqual([true, 1, 1]);
      // Asked again at that tick, it is that tick; a tick later, the next cycle's.
      expect([nextCast(tick, color, TICK_RATE), nextCast(tick + 1, color, TICK_RATE)]).toEqual([tick, tick + EYE_PERIOD * TICK_RATE]);
      expect(tick).toBeGreaterThanOrEqual(last);
      last = tick;
    }
  }
  // The three colours' casts are forty seconds apart, so a map with three sites has one about every forty seconds.
  const first = EYE_COLORS.map((c) => nextCast(0, c, TICK_RATE)).sort((a, b) => a - b);
  expect([first[1]! - first[0]!, first[2]! - first[1]!]).toEqual([40 * TICK_RATE, 40 * TICK_RATE]);
});

test("the server's world knows its map's obelisks: those with a display first, then the plain ones, each once", () => {
  const blue: TideEyeSite = { name: "Blue", color: "blue", x: 64, z: 64, y: 0, yaw: 0, radius: 70 };
  const plain = obeliskStatics(reg, { name: "north", x: 180, z: 150, yaw: 0 }, () => 0);
  const world = createMapWorld(reg, parseMap(writeMap(flatMap(4, { tideEyes: [blue], statics: plain }))));
  expect(world.tideEyes.map((s) => [s.name, s.color])).toEqual([["Blue", "blue"]]);
  // The plain obelisk's three blocks are one place.
  expect(world.obelisks).toEqual([{ x: 64, z: 64, eye: 0 }, { x: 180, z: 150, eye: -1 }]);
  const none = createMapWorld(reg, parseMap(writeMap(flatMap(4))));
  expect([none.tideEyes, none.obelisks]).toEqual([[], []]);
});
