// The Decider page's parts that need no browser (client/core/admin/decide.ts), its place in a world's navigation and
// build, and the gate in front of it.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  answerRing, eceText, gateText, labHtml, mapSvg, microsText, pointAt, policyRows, policyText, readPolicy, recentHtml, regretText, ringSvg, scoreOf,
  passRing, scorersHtml, statusText, wedgeAngles, wedgePath, whyText, withPolicy,
} from "../../client/core/admin/decide.ts";
import { resolveAdmin, sections } from "../../client/core/admin/navigation.ts";
import { adminSite } from "../../server/admin/site.ts";
import { Guesses } from "../../server/guesses.ts";
import type { AnsweredJson, DecideJson } from "../../shared/admin-decide.ts";
import type { EpisodeScore, Score } from "../../shared/decide/scoreboard.ts";
import { buildAdmin } from "../../tools/build-admin.ts";

const root = mkdtempSync(join(tmpdir(), "snark-decide-page-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("DecidePolicy reads as the decider reads it and is written back the same", () => {
  const t = readPolicy("nav.ring=RULE, nav.snag=watch *=off bogus=maybe nav.ring=model =rule");
  expect([...t]).toEqual([["nav.snag", "watch"], ["*", "off"], ["nav.ring", "model"]]);
  expect(policyText(t)).toBe("nav.snag=watch,nav.ring=model,*=off");
  expect([...readPolicy(policyText(t))]).toEqual([["nav.snag", "watch"], ["nav.ring", "model"], ["*", "off"]]);
  expect(policyText(readPolicy(""))).toBe("");
  expect(withPolicy("nav.ring=rule,*=off", "nav.ring", "")).toBe("*=off");
  expect(withPolicy("", "*", "watch")).toBe("*=watch");
  expect(withPolicy("*=watch", "nav.ring", "rule")).toBe("nav.ring=rule,*=watch");
});

test("each point's row says what DecidePolicy names for it and what it has", () => {
  const s = { settings: { DecidePolicy: "nav.ring=rule,*=watch" }, points: [{ name: "nav.ring", policy: "rule" }, { name: "nav.snag", policy: "watch" }] } as unknown as DecideJson;
  expect(policyRows(s)).toEqual([{ name: "nav.ring", own: "rule", now: "rule" }, { name: "nav.snag", own: "", now: "watch" }, { name: "*", own: "watch", now: "watch" }]);
});

test("heading 0 of a ring looks north and the rest go clockwise", () => {
  expect([wedgeAngles(8, 0), wedgeAngles(8, 2), wedgeAngles(8, 7)]).toEqual([[-22.5, 22.5], [67.5, 112.5], [292.5, 337.5]]);
  expect([wedgeAngles(12, 3), wedgeAngles(12, 6)]).toEqual([[75, 105], [165, 195]]);
  expect([wedgeAngles(16, 4), wedgeAngles(16, 15)]).toEqual([[78.75, 101.25], [326.25, 348.75]]);
  // North is up the picture and east to its right.
  expect([pointAt(50, 50, 10, 0), pointAt(50, 50, 10, 90), pointAt(50, 50, 10, 180), pointAt(50, 50, 10, 270)]).toEqual([[50, 40], [60, 50], [50, 60], [40, 50]]);
  expect(wedgePath(4, 0, 50, 50, 10, 40)).toBe("M21.72 21.72A40 40 0 0 1 78.28 21.72L57.07 42.93A10 10 0 0 0 42.93 42.93Z");
});

const table = (score: number[], mask: number[] = score.map(() => 0)) => {
  const top = Math.max(...score.filter((_, i) => !mask[i])), e = score.map((v, i) => (mask[i] ? 0 : Math.exp(v - top))), sum = e.reduce((a, b) => a + b, 0);
  return { profile: "ring.mid", k: score.length, state: [], rows: [], score, bias: score.map(() => 0), mask, out: e.map((v) => v / sum) };
};

test("a ring shades each heading by its chance, greys a masked one and outlines the pick", () => {
  const svg = ringSvg({ label: "ring.mid", out: [0.5, 0.25, 0.25, 0], mask: [0, 0, 0, 1], pick: 0 });
  expect(svg.match(/<path /g)!.length).toBe(5);
  expect(svg).toContain('fill-opacity="1.00"');
  expect(svg).toContain('fill="#9aa7b4"');
  expect(svg).toContain("heading 3: masked");
  expect(svg).toContain('stroke="#a33127"');
});

test("an answer is drawn as the server made it, and says why its heading won", () => {
  const far = { ...table([2, 0, 0, 1]), profile: "ring.far", weight: 0.5 }, near = { ...table([0, 1, 0, 0], [0, 0, 1, 0]), profile: "ring.near", weight: 2 };
  const final = { k: 4, score: [1, 2, 0, 0.5], bias: [0.5, 0, 0, 0], mask: [0, 0, 1, 0], out: [0.4, 0.45, 0, 0.15] };
  const a: AnsweredJson = { id: 0, t: 96, point: "nav.ring", rung: 3, policy: "rule", pick: 0, tables: [far, near], final };
  // A pass is its share of the answer: score times weight, shaded above its least open heading.
  const p = passRing(near, 0);
  expect([p.label, p.out, p.says]).toEqual(["ring.near ×2", [0, 2, 0, 0], ["adds +0.00", "adds +2.00", "adds +0.00", "adds +0.00"]]);
  // The answer's chances are the server's own, the held heading's bonus in them.
  expect(answerRing(a)).toMatchObject({ label: "answer", out: final.out, mask: final.mask, pick: 0 });
  expect(whyText(a)).toBe("heading 0: ring.far +1.00, ring.near +0.00, held and bias +0.50 = +1.50, a 40% chance");
  expect([answerRing({ ...a, final: undefined }), whyText({ ...a, final: undefined })]).toEqual([null, ""]);
});

test("recent answers are drawn as rings for a ring and as a table for the rest", () => {
  const ring: AnsweredJson = { id: 0, t: 40, point: "nav.ring", rung: 2, policy: "rule", pick: 1, x: 12, z: 30, tables: [table([0, 2, 1, 0]), { ...table([1, 0, 0, 0]), profile: "ring.near" }] };
  const pick: AnsweredJson = { id: 0, t: 41, point: "pick", rung: 0, policy: "watch", pick: 0, tables: [{ ...table([2, 1]), profile: "pick" }] };
  const s = { recent: [ring, pick], size: { x: 1000, z: 1000 }, profiles: [{ name: "ring.mid", ring: true }, { name: "ring.near", ring: true }, { name: "pick", ring: false }] } as unknown as DecideJson;
  const html = recentHtml(s);
  expect(html.indexOf("<b>pick</b>")).toBeLessThan(html.indexOf("<b>nav.ring</b>"));
  // With no final table sent, each pass is drawn by its own chances and nothing is made up beside them.
  expect(html.match(/<figure/g)!.length).toBe(2);
  expect(recentHtml({ ...s, recent: [{ ...ring, final: { k: 4, score: [0, 2, 1, 0], bias: [0, 0.5, 0, 0], mask: [0, 0, 0, 0], out: [0.1, 0.6, 0.2, 0.1] } }] })).toContain("<figcaption>answer</figcaption>");
  expect(html).toContain('<table class="candidates"><caption>pick</caption>');
  expect(html).toContain("stuck</span> at 12, 30");
  expect(mapSvg(s).match(/<circle /g)!.length).toBe(1);
  expect(recentHtml({ ...s, recent: [] })).toContain("No answers in the last ten seconds");
});

const score = (o: Partial<Score> = {}): Score => ({
  name: "mid-1", kind: "linear", decisions: 1200, scenes: 40, regret: 3.5, regretRatio: 0.62, interval: [0.5, 0.8], medianFast: 1, medianSlow: 4, worstFamily: 0.8, disagreeRatio: 0.5, logLoss: 0.4, brier: 0.1,
  ece: 0.0314, reliability: [{ said: 0.25, happened: 0.3, answers: 50 }], blind: { state: 0.1, columns: 0.5, shuffled: 0.2 }, microsFast: 3.24, microsSlow: 12.6, bytes: 2400,
  gate: { pass: true, why: [] }, ...o,
});

test("scores read as shares of the rule's, and a failed gate says each reason", () => {
  expect([regretText(0.62), regretText(Number.NaN), eceText(0.0314), microsText(3.24, 12.6)]).toEqual(["62% of the rule's", "–", "0.031", "3.2 / 13 µs"]);
  expect([gateText({ pass: true, why: [] }), gateText({ pass: false, why: ["regret over 0.9 of the rule's", "slow core over 20 µs"] }), gateText(null)])
    .toEqual(["pass", "fail: regret over 0.9 of the rule's; slow core over 20 µs", "not scored"]);
  expect([scoreOf({ score: score() })?.name, scoreOf(score() as unknown as Record<string, unknown>)?.name, scoreOf({ made: "x" }), scoreOf(null)]).toEqual(["mid-1", "mid-1", null, null]);
  const failing = score({ gate: { pass: false, why: ["ECE over 0.05"] } });
  const s = { refused: ["stale.json: made for other columns of ring.mid"], profiles: [
    { name: "ring.mid", kind: "choice", ring: true, rule: { weights: [["run", 2], ["drop", -1.5]], constant: 0 }, trained: { hidden: 0, temperature: 1, about: { score: failing, made: "2026-11-27T10:00:00Z" } } },
    { name: "nav.snag", kind: "yes", ring: false, rule: null, trained: null },
  ] } as unknown as DecideJson;
  const html = scorersHtml(s);
  expect(html).toContain('<td class="bad">fail: ECE over 0.05</td>');
  expect(html).toContain("run +2, drop -1.5");
  expect(html).toContain("2026-11-27");
  expect(html).toContain("none loaded: the rule decides");
  expect(html).toContain("Refused: stale.json");
});

test("the lab's scoreboard leads with whole episodes, then each entry's decisions", () => {
  expect(labHtml(null)).toContain("no scoreboard");
  const run = (name: string, arrived: number): EpisodeScore => ({ name, scenes: 142, arrived, ticks: 900, healthLost: 0, stuckTicks: 72, searches: 3, cells: 4000, cost: 1822, decideMicros: 47 });
  const html = labHtml({ made: "2026-11-27", revision: "abc", notes: ["Made on an older ladder."], points: [
    { point: "nav.ring", profile: "ring.mid", headroom: 0.097, episodes: [run("today", 128), run("rule", 132)], agreement: { checked: 4398, agreed: 4398, ruleChecked: 4398, ruleAgreed: 4398 }, scores: [score()] },
    { point: "pick", profile: "pick", headroom: 0.3, episodes: [], scores: [] },
  ] });
  expect(html).toContain("<li>Made on an older ladder.</li>");
  expect(html).toContain("<td>rule</td><td>132 of 142</td><td>30.0 s</td>");
  // The episodes come before the single decisions.
  expect(html.indexOf("Whole episodes")).toBeLessThan(html.indexOf("Single decisions"));
  expect(html).toContain("made again as the server makes them: 4,398 of 4,398");
  expect(html).toContain("headroom at one decision 10% of the median cost");
  expect(html).toContain("3.50 ticks, 62% of the rule's (50 to 80%)");
  // A point with nothing scored shows no empty table.
  expect(html.match(/<caption>Single decisions/g)!.length).toBe(1);
});

test("the lab's status reads as one line", () => {
  expect(statusText({ step: "fit", point: "nav.ring", done: 1200, of: 4000, at: "09:00" })).toBe("The lab is at fit for nav.ring: 1,200 of 4,000 (said at 09:00).");
  expect([statusText(null), statusText({ step: "idle", point: "", done: 0, of: 0, at: "09:00" })]).toEqual(["No lab run has said what it is doing.", "The lab is idle (said at 09:00)."]);
});

test("a world's navigation lists the Decider under Manage, at its own address", () => {
  const manage = sections.find(([label]) => label === "Manage")![1].map(([slug]) => slug);
  expect(manage).toContain("decide");
  const worlds = [{ id: 3, name: "Miami", map: "Miami", mapId: "core:miami", address: "/miami/", players: 0, max: 10 }];
  const at = resolveAdmin("https://snark.test/admin/worlds/3/decide/", worlds, (href, base) => new URL(href, base));
  expect([at.view, at.title, at.worldUrl("decide")]).toEqual(["decide", "Decider", "/admin/worlds/3/decide/"]);
  expect(at.api("decide.json?look=1")).toBe("https://snark.test/miami/admin/decide.json?look=1");
});

test("the page and its script are built, and served only past the gate", async () => {
  const dist = join(root, "dist");
  await buildAdmin(dist);
  const site = {
    dir: dist, base: "", port: 0, id: "local" as const, who: "test", destinations: () => [], scenes: () => new Response(null),
    gate: { dev: false, password: "hunter2", guesses: new Guesses(), tick: () => 0 },
  };
  const get = async (path: string, password?: string): Promise<Response> => {
    const headers: Record<string, string> = password ? { authorization: `Basic ${btoa(`admin:${password}`)}` } : {};
    return (await adminSite(new Request(`http://snark.test${path}`, { headers }), new URL(`http://snark.test${path}`), site))!;
  };
  expect((await get("/admin/worlds/local/decide/")).status).toBe(401);
  const page = await get("/admin/worlds/local/decide/", "hunter2");
  expect([page.status, (await page.text()).includes('src="/admin/ui/decide.js"')]).toEqual([200, true]);
  const script = await get("/admin/ui/decide.js");
  expect([script.status, (await script.text()).length > 500]).toEqual([200, true]);
});
