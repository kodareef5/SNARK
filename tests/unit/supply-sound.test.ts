// What a supply drop is heard by (client/core/sound/supply.ts): each cue at the moment its pose gives, heard once,
// and nothing of what a drop did before a client was told of it.

import { expect, test } from "bun:test";
import { COUNT_EVERY, PASS_AT, SOUND_SPEED, STRIKE_LATEST, SUPPLY_LOOPS, SupplySounds } from "../../client/core/sound/supply.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { SHUTTERS_AFTER, SHUTTERS_TAKE, newPose, supplyPose, supplyTimes, type SupplyList, type SupplyRow } from "../../shared/sim/supply.ts";
import { CUES, KEYS, candidates, cueFaults, cueKey } from "../../shared/sound/cues.ts";
import { EYE_KNOT } from "../../shared/world/tide-eye.ts";

const R = TICK_RATE;
const NAMES = ["call", "shaft", "release", "pass", "ignite", "jet", "cut", "land", "settle", "count", "open", "gone"];
const name = (key: number): string => KEYS[key]!.key.replace("supply/", "");
const row = (more: Partial<SupplyRow> = {}): SupplyRow => ({
  id: 5, tier: 0, cls: 0, ringed: false, landed: false, opened: false, announce: 0, sender: 0, eye: 0, look: 3,
  ox: 200, oy: EYE_KNOT, oz: 200, x: 900, y: 4, z: 700,
  ...supplyTimes(1000, null, 60, 30, 7, 1200, R),
  ...more,
});
const list = (...rows: SupplyRow[]): SupplyList => ({ tiers: [{ name: "Blue", rgb: 0x3a7bff, level: 25, count: 3 }], classes: [{ name: "Arms", mark: 1 }], rows });

/** A listener at the drop's site that keeps what it hears: one-shots as "name@delay", and the loops asked for each frame. */
function listener() {
  const sounds = new SupplySounds();
  const heard: string[] = [];
  const loops = new Map<number, { key: string; level: number; at: number[] }>();
  const step = (l: SupplyList, tick: number, ear: readonly [number, number, number] = [890, 6, 700]): void => {
    loops.clear();
    sounds.update(l, tick, R, ear[0], ear[1], ear[2], 77, (owner, key, _e, _x, _y, _z, _lift, _level, _flat, delay) => void (owner === 77 && heard.push(`${name(key)}${delay ? `@${delay.toFixed(2)}` : ""}`)), (id, key, x, y, z, level, on) => void (on && loops.set(id, { key: name(key), level, at: [x, y, z] })));
  };
  return { heard, loops, step };
}

test("the supply cues are twelve, each with a sound to fall back on that the catalogue can name", () => {
  expect(cueFaults()).toEqual([]);
  const mine = CUES.filter((c) => c.name.startsWith("supply/"));
  expect([mine.map((c) => c.name.slice(7)), mine.filter((c) => c.loop).map((c) => c.name)]).toEqual([NAMES, ["supply/shaft", "supply/jet"]]);
  for (const c of mine) expect([c.name, c.on, c.space, c.status, c.falls.length > 0]).toEqual([c.name, ["prop"], "world", "fire", true]);
  // Asked of the capsule: its own sound first, then the family's take or a neighbour's.
  expect(candidates("core:supply_capsule", KEYS[cueKey("supply/land")]!).map((c) => c.id)).toEqual(["core:supply_capsule/sound/supply/land", "core:supply/sound/land", "core:bang/sound/crate"]);
});

test("a drop heard from its call to its going: each sound at its moment and once, the count a chime to each step of its tier", () => {
  const { heard, loops, step } = listener();
  const d = row();
  const l = list(d);
  const jets = d.land - d.brake;
  // Told of it as it is called: the call, and the shaft's hum where it stands, level with the ear.
  step(l, d.called + 2);
  expect([heard, [...loops].map(([id, v]) => [id - SUPPLY_LOOPS, v.key, v.at])]).toEqual([["call"], []]);
  step(l, d.called + 3 * R);
  expect([...loops].map(([id, v]) => [id - SUPPLY_LOOPS - d.id * 2, v.key, v.at, v.level > 0.8])).toEqual([[0, "shaft", [900, 6, 700], true]]);
  for (let tick = d.called + 3 * R; tick < d.release; tick += 7) step(l, tick);
  expect(heard).toEqual(["call"]);
  // The cast leaves: the strike is heard as late as the knot is far.
  step(l, d.release + 1);
  const far = Math.hypot(d.ox - 890, d.oy - 6, d.oz - 700);
  expect([heard.slice(1), far / SOUND_SPEED < STRIKE_LATEST]).toEqual([[`release@${(far / SOUND_SPEED).toFixed(2)}`], true]);
  // In flight: nothing more until it is most of the way, then its pass, once.
  const pose = newPose();
  let passed = -1;
  for (let tick = d.release + 2; tick < jets; tick++) {
    step(l, tick);
    if (passed < 0 && heard.includes("pass")) passed = tick;
  }
  supplyPose(d, passed, R, pose);
  expect([heard.slice(2), pose.along > PASS_AT, pose.along < PASS_AT + 0.02]).toEqual([["pass"], true, true]);
  // Its jets light, and burn where it is until it lands.
  step(l, jets);
  step(l, jets + 30);
  const jet = loops.get(SUPPLY_LOOPS + d.id * 2 + 1)!;
  supplyPose(d, jets + 30, R, pose);
  expect([heard.slice(3), jet.key, jet.at, jet.level > 0.8]).toEqual([["ignite"], "jet", [pose.x, pose.y, pose.z], true]);
  for (let tick = jets + 31; tick <= d.land + 2 * R; tick++) step(l, tick);
  const first = SHUTTERS_AFTER + SHUTTERS_TAKE / 2;
  expect(heard.slice(4)).toEqual(["cut", "land", `settle@${SHUTTERS_AFTER.toFixed(2)}`, `count@${first.toFixed(2)}`, `count@${(first + COUNT_EVERY).toFixed(2)}`, `count@${(first + 2 * COUNT_EVERY).toFixed(2)}`]);
  expect([...loops.values()].map((v) => v.key)).toEqual(["shaft"]);
  // Opened, once; emptied, it goes on its jets, and then nothing of it is heard.
  d.opened = true;
  step(l, d.land + 20 * R);
  step(l, d.land + 21 * R);
  d.left = d.land + 30 * R;
  step(l, d.left + 1);
  // Four seconds on its shaft has faded, and its jets carry it up.
  step(l, d.left + 4 * R);
  expect([heard.slice(10), [...loops.values()].map((v) => v.key).sort()]).toEqual([["open", "gone"], ["jet"]]);
  step(list(), d.left + 13 * R);
  expect([heard.length, loops.size]).toEqual([12, 0]);
});

test("a client told of a drop that is already under way hears what it does from then, and nothing it did before", () => {
  const d = row();
  const jets = d.land - d.brake;
  // Told while it brakes: no call, no strike, no pass, no ignition. Its jets, and then its landing.
  const late = listener();
  late.step(list(d), jets + 60);
  expect([late.heard, [...late.loops.values()].map((v) => v.key).sort()]).toEqual([[], ["jet", "shaft"]]);
  for (let tick = jets + 61; tick <= d.land + 1; tick++) late.step(list(d), tick);
  expect(late.heard.slice(0, 2)).toEqual(["cut", "land"]);
  // Told once it stands, opened already: only its hum.
  const after = listener();
  const stood = row({ landed: true, opened: true });
  after.step(list(stood), stood.land + 60 * R);
  after.step(list(stood), stood.land + 61 * R);
  expect([after.heard, [...after.loops.values()].map((v) => v.key)]).toEqual([[], ["shaft"]]);
  // From up beside its shaft the hum is level with the ear, and above its head it is at its head.
  after.step(list(stood), stood.land + 62 * R, [905, 150, 700]);
  expect(after.loops.get(SUPPLY_LOOPS + stood.id * 2)!.at).toEqual([900, 150, 700]);
  after.step(list(stood), stood.land + 63 * R, [905, 900, 700]);
  expect(after.loops.get(SUPPLY_LOOPS + stood.id * 2)!.at).toEqual([900, 404, 700]);
});
