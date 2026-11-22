// The music director: the track follows place, hour and danger; the layer follows how near the danger is, rising on
// a bar line and stepping down slowly; calm music plays a pass and rests; the theme greets and the lament mourns once.

import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { MusicDirector, type MusicState, type MusicTrack } from "../../client/core/sound/music.ts";

const LAYERS = ["calm", "tense", "combat", "climax"];
const tracks: MusicTrack[] = [
  { id: "dawn", bpm: 80, seconds: 120, layers: ["theme", "full"], once: true },
  { id: "dread", bpm: 96, seconds: 120, layers: LAYERS },
  { id: "primeval", bpm: 90, seconds: 120, layers: LAYERS },
  { id: "nightfall", bpm: 80, seconds: 120, layers: LAYERS },
  { id: "hunted", bpm: 140, seconds: 120, layers: ["tense", "combat", "climax"] },
  { id: "apex", bpm: 110, seconds: 120, layers: ["tense", "combat", "climax"] },
  { id: "shoreline", bpm: 84, seconds: 120, layers: ["calm", "tense", "combat"] },
  { id: "deep", bpm: 60, seconds: 120, layers: ["calm", "tense"] },
  { id: "hearth", bpm: 80, seconds: 120, layers: ["calm", "tense"] },
  { id: "last_breath", bpm: 60, seconds: 45, layers: ["lament"], once: true },
];

function calm(): MusicState {
  return { alive: true, place: "grass", night: false, hunters: 0, chasers: 0, apex: false, sinceHurt: Infinity, sinceFight: Infinity, health: 1, home: false };
}

test("intensity: calm, a hunter about is tense, a chase or a fight is combat, and near death or an apex chasing is the climax", () => {
  expect(MusicDirector.intensity(calm())).toBe(0);
  expect(MusicDirector.intensity({ ...calm(), hunters: 2 })).toBe(1);
  expect(MusicDirector.intensity({ ...calm(), hunters: 2, chasers: 1 })).toBe(2);
  expect(MusicDirector.intensity({ ...calm(), sinceHurt: 3 })).toBe(2);
  expect(MusicDirector.intensity({ ...calm(), sinceFight: 20 })).toBe(0);
  expect(MusicDirector.intensity({ ...calm(), sinceHurt: 1, health: 0.2 })).toBe(3);
  expect(MusicDirector.intensity({ ...calm(), hunters: 1, chasers: 1, apex: true })).toBe(3);
});

test("the track follows the place, the hour and the danger", () => {
  const d = new MusicDirector(tracks, new Rng(1));
  expect(d.choose(calm(), 0)).toBe("primeval");
  expect(d.choose({ ...calm(), place: "beach" }, 0)).toBe("shoreline");
  expect(d.choose({ ...calm(), night: true }, 0)).toBe("nightfall");
  expect(d.choose({ ...calm(), home: true }, 0)).toBe("hearth");
  expect(d.choose({ ...calm(), place: "under" }, 2)).toBe("deep");
  expect(d.choose({ ...calm(), hunters: 1 }, 1)).toBe("dread");
  expect(d.choose({ ...calm(), hunters: 1, chasers: 1 }, 2)).toBe("hunted");
  expect(d.choose({ ...calm(), hunters: 1, apex: true }, 1)).toBe("apex");
  expect(d.choose({ ...calm(), alive: false }, 0)).toBe("last_breath");
});

test("the theme greets the player once; danger rises to its layer on the next bar line and steps down one layer each 12 s of calm", () => {
  const d = new MusicDirector(tracks, new Rng(1));
  let now = 0;
  const run = (s: MusicState, seconds: number) => {
    for (let k = 0; k < seconds * 60; k++) d.update((now += 1000 / 60), s);
    return d.plan;
  };
  expect(run(calm(), 1).track).toBe("dawn");
  expect(d.plan.gains).toEqual([1, 0]);
  // Danger cuts the greeting short: dread, at combat for a chase.
  const chased = { ...calm(), hunters: 2, chasers: 1 };
  expect(run(chased, 0.1).track).toBe("hunted");
  expect(d.plan.gains.indexOf(1)).toBe(1);
  // In dread by day with hunters about but no chase, tense.
  run({ ...calm(), hunters: 1 }, 1);
  expect(d.plan.track).toBe("dread");
  // Danger rises within a bar: from tense to combat when hurt.
  const bar = (4 * 60) / 96;
  run({ ...calm(), hunters: 1, sinceHurt: 0 }, bar + 0.1);
  expect(d.plan.gains.indexOf(1)).toBe(2);
  // Calm again: still combat for under 12 s, then one layer down each 12 s.
  run({ ...calm(), hunters: 1 }, 10);
  expect(d.plan.gains.indexOf(1)).toBe(2);
  run({ ...calm(), hunters: 1 }, 4);
  expect(d.plan.gains.indexOf(1)).toBe(1);
});

test("calm music plays a pass and rests a minute or more; danger breaks the rest at once", () => {
  const d = new MusicDirector(tracks.filter((t) => t.id !== "dawn"), new Rng(2));
  let now = 0;
  const run = (s: MusicState, seconds: number) => {
    for (let k = 0; k < seconds * 30; k++) d.update((now += 1000 / 30), s);
    return d.plan;
  };
  expect(run(calm(), 1).track).toBe("primeval");
  expect(run(calm(), 121).track).toBe("");
  expect(run(calm(), 40).track).toBe("");
  expect(run({ ...calm(), hunters: 1 }, 0.1).track).toBe("dread");
});

test("a death is mourned once with the lament, which plays to its end", () => {
  const d = new MusicDirector(tracks.filter((t) => t.id !== "dawn"), new Rng(3));
  let now = 0;
  const run = (s: MusicState, seconds: number) => {
    for (let k = 0; k < seconds * 30; k++) d.update((now += 1000 / 30), s);
    return d.plan;
  };
  run({ ...calm(), hunters: 2, chasers: 1 }, 2);
  expect(run({ ...calm(), alive: false }, 1).track).toBe("last_breath");
  expect(d.plan.loop).toBe(false);
  expect(run({ ...calm(), alive: false }, 30).track).toBe("last_breath");
  expect(run({ ...calm(), alive: false }, 20).track).toBe("");
});
