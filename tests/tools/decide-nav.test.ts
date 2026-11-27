// The lab on the game's own ladder (server/decide/nav.ts): its points found by name, its passes added up as nav.ts adds
// them, nav.snag labelled by what came after, and decisions gathered under a trained scorer (generate.ts --under).
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "../../shared/decide/forward.ts";
import { RING_MID } from "../../shared/decide/profiles.ts";
import { RULE_MID } from "../../shared/decide/rules.ts";
import { writeModel } from "../../shared/decide/weights.ts";
import { GAME_CATALOG, NAV_POINTS } from "../../tools/decide/catalog.ts";
import { READINGS, emptyManifest, readData, type Decision } from "../../tools/decide/dataset.ts";
import { argmax, examples, probabilities, scoreModel } from "../../tools/decide/fit.ts";
import { generate } from "../../tools/decide/generate.ts";
import type { Answer } from "../../tools/decide/label.ts";
import { draw } from "../../tools/decide/random.ts";
import { agreement, layouts } from "../../tools/decide/score.ts";
import { build, clearYaw, gameReplayer, play, policyText } from "../../tools/decide/setups.ts";

const scene = draw("water", 3);

/** Survey answers as decisions whose every open candidate cost the same, so none is dropped. */
const asDecisions = (answers: Answer[]): Decision[] => answers.map((a, i) => {
  const k = a.tables[0]!.k, R = READINGS.length;
  return { seed: i, family: "water", map: "flat", ordinal: i, tick: a.tick, pick: a.pick, label: 0, seeds: 1, readings: R, tables: a.tables, costs: new Float32Array(k * R).fill(1), today: new Float32Array(R).fill(1) };
});

/** Whether the trainer's sum of the passes, `m` scoring `RING_MID`, puts the game's own pick at the top of every answer. */
function agrees(answers: Answer[], m: Model): number {
  const ex = examples(asDecisions(answers), RING_MID, GAME_CATALOG.profiles, GAME_CATALOG.rules, 2, undefined, GAME_CATALOG.passes!["nav.ring"]);
  expect(ex.length).toBe(answers.length);
  let same = 0;
  ex.forEach((e, i) => {
    const p = new Float64Array(e.k);
    probabilities("choice", e, (c) => scoreModel(m, e.x, c * e.n), m.temperature, p);
    if (p[answers[i]!.pick]! >= p[argmax(p, e)]! - 1e-6) same++;
  });
  return same / answers.length;
}

/** RULE_MID made hotter and then cooled by a temperature, so the pass's weight in the sum is not the rule's. */
const warm: Model = { ...RULE_MID, w1: RULE_MID.w1.map((v) => v * 3), temperature: 2 };

test("a long body is put down with its head clear of the wall it was drawn against", () => {
  // A rex drawn 3 m from the wall that closes its U, its head 5 m ahead of it.
  const s = draw("water", 500006), b = build(s), ents = b.lab.world.ents, reg = b.lab.world.reg;
  const move = reg.move[reg.index.get(s.kind)!]!;
  expect(s.kind).toBe("core:rex");
  // As drawn it has no clear facing where it stands, so it stands a little off, facing a way that is.
  expect(clearYaw(b.lab, move, s.start.x, s.start.z, s.start.yaw)).not.toBe(s.start.yaw);
  const x = ents.x[b.mover]!, z = ents.z[b.mover]!, yaw = ents.yaw[b.mover]!;
  expect(clearYaw(b.lab, move, x, z, yaw)).toBe(yaw);
  expect(Math.hypot(x - s.start.x, z - s.start.z)).toBeLessThan(6);
  b.lab.host.shutdown();
});

test("a mover at a crowd or at water arrives with every ladder point under the rule", () => {
  // Scenes the ring alone gets through, which the actions lost by waiting for a body that stands and by sprinting off the ring's heading.
  expect(policyText("nav.ring", "rule")).toContain("nav.do=rule");
  for (const [family, seed] of [["crowd", 500011], ["water", 500039]] as const) {
    const b = build(draw(family, seed)), t = play(b, { point: "nav.ring", policy: "rule" });
    expect([family, t.arrivedAt >= 0]).toEqual([family, true]);
    b.lab.host.shutdown();
  }
});

test("the lab knows every point the ladder declares on a host", () => {
  const b = build(scene);
  expect(b.lab.host.decide.points.map((p) => p.name)).toEqual([...NAV_POINTS, "nav.pick"]);
  expect(Number.isNaN(b.way)).toBe(false);
  b.lab.host.shutdown();
});

test("the trainer adds the three passes with combine as nav.ts does, under the rule", () => {
  const answers = gameReplayer("nav.ring", { policy: "rule", models: [] }).survey(scene);
  expect(answers.length).toBeGreaterThan(5);
  expect(agrees(answers, RULE_MID)).toBe(1);
  // Made again with combine as the survey saw them, every answer is the server's.
  expect(answers.map((a) => a.agrees)).toEqual(answers.map(() => true));
});

test("a trained pass's temperature divides only its own score in the sum", () => {
  const answers = gameReplayer("nav.ring", { policy: "model", models: [warm] }).survey(scene);
  expect(agrees(answers, warm)).toBe(1);
  expect(answers.map((a) => a.agrees)).toEqual(answers.map(() => true));
  // Read as if the temperature divided the other passes too, some answers come out otherwise.
  const ex = examples(asDecisions(answers), RING_MID, GAME_CATALOG.profiles, GAME_CATALOG.rules, 2);
  const wrong = ex.filter((e, i) => {
    const p = new Float64Array(e.k);
    probabilities("choice", e, (c) => scoreModel(warm, e.x, c * e.n), warm.temperature, p);
    return argmax(p, e) !== answers[i]!.pick;
  });
  expect(wrong.length).toBeGreaterThan(0);
});

test("nav.snag is labelled by the progress made in the two seconds after", () => {
  const answers = gameReplayer("nav.snag", { policy: "rule", models: [] }).survey(scene);
  const labels = answers.map((a) => a.outcome);
  expect(answers.length).toBeGreaterThan(20);
  // Stuck in the U, it is snagged; walking out of the water to its goal, it is not.
  expect(labels.filter((v) => v === 1).length).toBeGreaterThan(3);
  expect(labels.filter((v) => v === 0).length).toBeGreaterThan(3);
  expect(labels.every((v) => v === 0 || v === 1 || v === undefined)).toBe(true);
});

test("decisions generated under a trained scorer are its own picks", async () => {
  const root = join(".cache/decide/test", `under-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const file = join(root, "ring.mid.warm.json");
  writeFileSync(file, JSON.stringify(writeModel(warm)));
  try {
    const r = await generate({ point: "nav.ring", families: ["water"], scenes: 2, first: 3, workers: 2, seeds: 1, under: [file], fresh: true, root });
    expect([r.errors, r.thrown]).toEqual([[], 0]);
    const { manifest, decisions } = readData(join(root, "data", "nav.ring"), GAME_CATALOG.profiles);
    expect(manifest.runs.map((x) => x.under)).toEqual([file]);
    expect(decisions.length).toBeGreaterThan(0);
    const answers: Answer[] = decisions.map((d) => ({ tables: d.tables, pick: d.pick, hash: 0, tick: d.tick }));
    expect(agrees(answers, warm)).toBe(1);
    expect(JSON.parse(readFileSync(file, "utf8")).temperature).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stored ring decisions made again with combine give their stored picks", () => {
  const answers = gameReplayer("nav.ring", { policy: "rule", models: [] }).survey(scene);
  const ds = asDecisions(answers).map((d, i) => ({ ...d, final: answers[i]!.final }));
  const manifest = { ...emptyManifest("nav.ring", "choice"), decisions: ds.length, runs: [{ made: "", revision: "", under: "rule", scenes: 1, decisions: ds.length, none: 0, thrown: 0, noReseed: 0 }] };
  expect(agreement("nav.ring", manifest, ds, GAME_CATALOG)).toEqual({ checked: ds.length, agreed: ds.length, ruleChecked: ds.length, ruleAgreed: ds.length });
  // A pick that was not the server's is caught.
  const wrong = ds.map((d, i) => (i === 0 ? { ...d, pick: (d.pick + 1) % d.tables[0]!.k } : d));
  expect(agreement("nav.ring", manifest, wrong, GAME_CATALOG).ruleAgreed).toBe(ds.length - 1);
});

test("held-out layouts are the same seeds of each held-out family and map", () => {
  const list = layouts(GAME_CATALOG, 3);
  expect(list.map((s) => `${s.family}/${s.seed}`)).toEqual(["pen/1", "pen/2", "pen/3", "miami/1", "miami/2", "miami/3"]);
});
