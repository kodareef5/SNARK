import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import type { Tier } from "../../client/core/assets/tiers.ts";
import { ladder } from "../../client/core/governor.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

const pack = parsePack(corePackBytes());

test("a tier chosen, or a governor's step, is drawn once the card has linked its programs, the one before until then, and the steps of a tier chosen are begun a frame at a time", () => {
  const h = new Harness();
  const app = new App(h.join("tiers", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const linked = new Set<Tier>(), asked: Tier[] = [];
  app.tierReady = (tier) => (asked.push(tier), linked.has(tier));
  app.ui.settings.tier = "medium";
  app.ui.settings.steady = false;
  h.run(500, (now) => app.frame(now, 1280, 720));
  // The first tier is drawn at once: the join's first frame waits for its links as it always did.
  const medium = app.scene!.assets.tier;
  expect(medium.name).toBe("medium");
  // Its governor's steps were begun, one a frame, each once.
  const steps = ladder(medium, app.dpr).map((l) => l.tier);
  expect(steps.every((t) => asked.includes(t))).toBe(true);
  expect(steps.map((t) => asked.filter((a) => a === t).length).every((n) => n >= 1)).toBe(true);

  app.ui.settings.tier = "high";
  asked.length = 0;
  h.run(500, (now) => app.frame(now, 1280, 720));
  expect(app.scene!.assets.tier).toBe(medium);
  const high = asked.find((t) => t.name === "high" && t === ladder(t, app.dpr)[0]!.tier)!;
  linked.add(high);
  h.run(100, (now) => app.frame(now, 1280, 720));
  expect(app.scene!.assets.tier).toBe(high);

  // A step the governor takes waits for its programs the same way.
  app.governor.held = 1;
  const step = ladder(high, app.dpr)[1]!.tier;
  h.run(300, (now) => app.frame(now, 1280, 720));
  expect(app.scene!.assets.tier).toBe(high);
  linked.add(step);
  h.run(100, (now) => app.frame(now, 1280, 720));
  expect(app.scene!.assets.tier).toBe(step);
});
