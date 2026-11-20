// Runs one skill on a scenario's world with the rules policies, no model, and says how it played: time, distance,
// turning, controls a second and why, blocks, decisions, health, and the reports the Director would have had.
//
//   bun tools/grunt/measure.ts grunt/scenarios/chop-raptor.json harvest '{"kind":"tree"}' [--seconds 300]

import { readFileSync } from "node:fs";
import { memoryLink } from "../../grunt/link.ts";
import { Runtime } from "../../grunt/runtime.ts";
import { type Clock, Session } from "../../grunt/session.ts";
import { GameEndpoint } from "./game.ts";
import type { Scenario } from "./play.ts";
import { makeWorld, type Scene } from "./scenes.ts";

export async function measure(scene: Scene, skill: string, args: Record<string, unknown>, ms: number, owners: string[] = []) {
  const world = makeWorld(scene), game = new GameEndpoint(world);
  const timers: { every: number; next: number; fn: () => void; on: boolean }[] = [];
  const clock: Clock = {
    now: () => world.t,
    every: (e, fn) => {
      const t = { every: e, next: world.t + e, fn, on: true };
      timers.push(t);
      return () => void (t.on = false);
    },
  };
  const rt = new Runtime({ session: new Session(memoryLink((s) => game.connect(s)), clock), clock, owners });
  await rt.connect(scene.me?.name ?? "Scout");
  rt.run();
  const task = rt.start(skill, args);
  let walked = 0, turned = 0, px = world.me.x, pz = world.me.z, py = world.me.yaw;
  const end = world.t + ms;
  while (world.t < end && (task.status === "running" || task.status === "suspended") && world.me.alive) {
    world.step();
    game.afterStep();
    for (const t of timers) while (t.on && world.t >= t.next) (t.next += t.every), t.fn();
    walked += Math.hypot(world.me.x - px, world.me.z - pz);
    let d = Math.abs(world.me.yaw - py);
    if (d > Math.PI) d = 2 * Math.PI - d;
    turned += d;
    [px, pz, py] = [world.me.x, world.me.z, world.me.yaw];
  }
  const acts = rt.trace.of("act");
  const why: Record<string, number> = {};
  for (const a of acts) {
    const k = String(a.why).split(" ")[0]!;
    why[k] = (why[k] ?? 0) + 1;
  }
  const s = world.t / 1000;
  return {
    status: task.status, summary: task.result?.summary, seconds: Math.round(s * 10) / 10, walked_m: Math.round(walked), turned_rad: Math.round(turned),
    acts: acts.length, acts_per_s: Math.round((acts.length / s) * 10) / 10, by_why: why,
    blocked_events: rt.trace.of("event").filter((e) => e.event === "blocked").length, decisions: rt.trace.of("decision").length,
    alive: world.me.alive, health: world.me.health, reports: rt.reports.map((r) => `${r.kind}: ${r.text}`),
  };
}

if (import.meta.main) {
  const [file, skill, json] = process.argv.slice(2);
  if (!file || !skill) throw new Error("usage: bun tools/grunt/measure.ts <scenario.json> <skill> ['{args}'] [--seconds N]");
  const sc = JSON.parse(readFileSync(file, "utf8")) as Scenario;
  const i = process.argv.indexOf("--seconds");
  const ms = (i > 0 ? Number(process.argv[i + 1]) : sc.budget.seconds) * 1000;
  console.log(JSON.stringify(await measure(sc.world, skill, json ? JSON.parse(json) : {}, ms, sc.owners ?? []), null, 1));
}
