// What an orb is heard by (client/core/sound/orb.ts): a quiet hum at the point of its sphere nearest the ear, from the
// map's sites alone.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample } from "../../client/core/session.ts";
import { LOOP } from "../../client/core/sound/mixer.ts";
import { HUM_LEVEL, HUM_RANGE, ORB_LOOPS, OrbSounds } from "../../client/core/sound/orb.ts";
import { START_FIELDS, type SoundSink } from "../../client/core/sound/packet.ts";
import { Sounds, type SoundView } from "../../client/core/sound/sounds.ts";
import { CUES, KEYS, candidates, cueFaults, cueKey } from "../../shared/sound/cues.ts";
import type { OrbSite } from "../../shared/world/orb.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { buildSounds, writeWav } from "../../tools/pack/sound.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { chirp } from "../fixtures/sounds.ts";
import { coreRegistry } from "../fixtures/world.ts";

const SITE: OrbSite = { name: "Sphere", x: 1000, y: 12, z: -400, yaw: 0, radius: 78, centre: 34 };
const CENTRE = [SITE.x, SITE.y + SITE.centre, SITE.z] as const;
type Vec = readonly [number, number, number];
const far = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** An ear `off` metres out from the skin, along the unit direction `way` from the centre. */
const earAt = (way: Vec, off: number): Vec => [CENTRE[0] + way[0] * (SITE.radius + off), CENTRE[1] + way[1] * (SITE.radius + off), CENTRE[2] + way[2] * (SITE.radius + off)];

/** The loops one frame asks for: those that are on, by their number, and how many were asked for at all. */
function heard(sites: readonly OrbSite[] | undefined, ear: Vec) {
  const on = new Map<number, { key: string; level: number; at: Vec }>();
  let asked = 0;
  new OrbSounds().update(sites, ear[0], ear[1], ear[2], (id, key, x, y, z, level, isOn) => {
    asked++;
    if (isOn) on.set(id, { key: KEYS[key]!.key, level, at: [x, y, z] });
  });
  return { on, asked };
}

test("the orb's hum is a loop that falls back on the obelisk's drone, played lower", () => {
  expect(cueFaults()).toEqual([]);
  const cue = CUES.find((c) => c.name === "orb/hum")!;
  expect([cue.on, cue.kind, cue.space, cue.loop, cue.status]).toEqual([["prop"], "build", "world", true, "fire"]);
  // Asked of the orb: its own take once it has one, and until then the stand-in at four fifths of its rate.
  expect(candidates("core:orb", KEYS[cueKey("orb/hum")]!)).toEqual([
    { id: "core:orb/sound/orb/hum", rate: 1 },
    { id: "core:orb/sound/hum", rate: 1 },
    { id: "core:tech/sound/obelisk", rate: 0.8 },
  ]);
});

test("the hum plays at the point of the sphere nearest the ear", () => {
  // From the street beside it, from the air over it, and from under its curve close to its foot.
  for (const ear of [[1100, 13.7, -400], [1040, 190, -470], [1071, 13.7, -400]] as Vec[]) {
    const { on } = heard([SITE], ear);
    const hum = on.get(ORB_LOOPS)!;
    expect([on.size, hum.key]).toEqual([1, "orb/hum"]);
    expect(far(hum.at, CENTRE)).toBeCloseTo(SITE.radius, 6);
    // No other point of the sphere is nearer: the ear, the point and the centre are in one line.
    expect(far(hum.at, ear)).toBeCloseTo(Math.abs(far(ear, CENTRE) - SITE.radius), 6);
    expect(hum.level).toBe(HUM_LEVEL);
  }
});

test("the hum fades toward its range and is silent past it", () => {
  const way: Vec = [0.6, 0, -0.8];
  const level = (off: number): number | undefined => heard([SITE], earAt(way, off)).on.get(ORB_LOOPS)?.level;
  expect(HUM_RANGE).toBeGreaterThan(100);
  expect(HUM_RANGE).toBeLessThan(200);
  // Full beside the skin and for most of the way out, then down to nothing at the range.
  expect([level(0), level(HUM_RANGE / 2)]).toEqual([HUM_LEVEL, HUM_LEVEL]);
  const edge = [0.8, 0.9, 0.99].map((share) => level(HUM_RANGE * share)!);
  expect(edge[0]!).toBeLessThan(HUM_LEVEL);
  expect(edge[1]!).toBeLessThan(edge[0]!);
  expect(edge[2]!).toBeLessThan(0.05 * HUM_LEVEL);
  expect(edge[2]!).toBeGreaterThan(0);
  for (const off of [HUM_RANGE + 0.01, HUM_RANGE + 1, 2000]) expect([off, level(off)]).toEqual([off, undefined]);
});

test("each orb of a map hums on a loop of its own, and a map with none asks for nothing", () => {
  const second: OrbSite = { ...SITE, name: "Other", x: SITE.x + 200 };
  // Between two orbs 44 m apart at their skins, both are heard, each at its own near point.
  const { on } = heard([SITE, second], [SITE.x + 100, CENTRE[1], SITE.z]);
  expect([...on.keys()]).toEqual([ORB_LOOPS, ORB_LOOPS + 1]);
  expect([on.get(ORB_LOOPS)!.at, on.get(ORB_LOOPS + 1)!.at]).toEqual([[SITE.x + 78, CENTRE[1], SITE.z], [SITE.x + 122, CENTRE[1], SITE.z]]);
  for (const sites of [undefined, []]) expect(heard(sites, [SITE.x + 80, 14, SITE.z])).toEqual({ on: new Map(), asked: 0 });
});

test("in a session the hum starts beside an orb, and not far from one or on a map without one", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-orb-"));
  try {
    const dir = join(root, "core", "sfx", "tech", "sound");
    mkdirSync(join(dir, "takes"), { recursive: true });
    writeFileSync(join(dir, "takes", "a.wav"), writeWav(chirp(1, 32000), 32000));
    writeFileSync(join(dir, "sounds.json"), JSON.stringify({ sounds: { obelisk: { range: 200, level: -18, loop: true, takes: [{ file: "takes/a.wav" }] } } }));
    const built = buildSounds(1, root, null)!;
    const hf = buildProvingHeightfield();
    /** The looping voices a session starts in three seconds, heard from `ear` on a map with `orbs`. */
    const loops = (orbs: readonly OrbSite[] | undefined, ear: Vec): number[][] => {
      const net = new FakeNet([new Uint8Array(0), built.bytes], { latencyMs: 1, bytesPerSecond: 1e8 });
      const sounds = new Sounds({ sounds: built.sounds }, net, coreRegistry(), () => null);
      const starts: number[][] = [];
      const sink: SoundSink = { running: true, apply: (p) => {
        for (let i = 0; i < p.starts.length; i += START_FIELDS) starts.push(p.starts.slice(i, i + START_FIELDS));
      } };
      const view: SoundView = { ownId: -1, body: null, hour: 12, trees: () => 0, own: { alive: false, x: ear[0], y: ear[1], z: ear[2], act: 0, actTicks: 0, held: 0, female: false, vitals: null, tick: 0, level: 1, engrams: 0 }, ...(orbs ? { orbs } : {}) };
      for (let now = 1000 / 30; now < 3000; now += 1000 / 30) {
        net.advance(now);
        sounds.frame(sink, now, new RemoteSample(), hf, { x: ear[0], y: ear[1], z: ear[2], yaw: 0, pitch: 0 }, { master: 1, effects: 1, ambience: 1, music: 1, interface: 1 }, view);
      }
      return starts.filter((s) => (s[10]! & LOOP) !== 0);
    };
    const ear = earAt([1, 0, 0], 20);
    const near = loops([SITE], ear);
    // One voice, lower than the stand-in was made, 20 m off toward the orb at the ear's own height.
    expect(near.length).toBe(1);
    expect(near[0]![3]).toBeCloseTo(0.8, 6);
    expect(near[0]!.slice(5, 8).map((v) => Math.round(v * 1000) / 1000)).toEqual([-20, 0, 0]);
    expect(loops([SITE], earAt([1, 0, 0], HUM_RANGE + 30))).toEqual([]);
    expect(loops(undefined, ear)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
