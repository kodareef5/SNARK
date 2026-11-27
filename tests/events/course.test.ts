// A map event walks a body of its own through places in order (server/api/event.ts walker and walk): its kind hears
// each arrival and the end, the body goes with the event, and a walk goes on after a restart.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventRun } from "../../server/api/event.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { WALKER_TAG } from "../../server/mapevent/events.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-event-course-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const MAP = writeMap(flatMap(16));
const POINTS = [{ x: 512, z: 530 }, { x: 530, z: 530 }, { x: 530, z: 512, radius: 2 }];

/** A kind that places a parasaur as it comes and walks it through POINTS once, and what it heard. */
function parade(heard: string[], mode: "once" | "loop" = "once"): ModuleDef {
  return {
    name: "parade",
    api: 1,
    setup(m) {
      m.mapEvent({
        id: "parade",
        label: "Parade",
        about: "",
        tuning: {},
        on: {
          start() {},
          live(run: EventRun) {
            const w = run.walker({ species: "core:parasaur", x: 512, z: 512 });
            run.bag.walker = w;
            run.walk(w, POINTS, mode);
          },
          walkerAt: (_run, w, at) => void heard.push(`at ${w} ${at}`),
          walkerFailed: (_run, w, at) => void heard.push(`failed ${w} ${at}`),
          walkerDone: (_run, w) => void heard.push(`done ${w}`),
        },
      });
    },
  };
}

function world(def: ModuleDef, dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, map: MAP, modules: [def], ...(dbPath ? { dbPath } : {}) });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(ada, "god");
  h.say(ada, "tp 505 505");
  h.run(300);
  return { h, ada, events: h.host.mapEvents };
}

const walkerOf = (h: Harness) => [...h.host.records.byPid.values()].find((r) => r.extra.has(WALKER_TAG));

test("a module walks its walker through three points and hears each arrival and the end", () => {
  const heard: string[] = [];
  const { h, events } = world(parade(heard));
  const ev = events.call("parade", { source: "test", notice: 0 });
  if (typeof ev === "string") throw new Error(ev);
  h.run(500);
  const w = ev.bag.walker as number;
  expect(w).toBeGreaterThan(0);
  expect(events.info(ev).parts).toMatchObject([{ type: "walker", id: w, at: 0 }]);
  h.run(40000);
  expect(heard).toEqual([`at ${w} 0`, `at ${w} 1`, `at ${w} 2`, `done ${w}`]);
  // It stands at the last point.
  const e = h.host.records.entOf.get(walkerOf(h)!.pid)!;
  expect(Math.hypot(h.world.ents.x[e]! - 530, h.world.ents.z[e]! - 512)).toBeLessThan(2);
  // The walker goes with its event.
  events.cancel(ev);
  h.run(100);
  expect(walkerOf(h)).toBeUndefined();
  expect(h.host.courses.count).toBe(0);
});

test("a walker made before its event comes is refused, and a walk of a flyer's kind is no walker", () => {
  const faults: string[] = [];
  const def: ModuleDef = {
    name: "early",
    api: 1,
    setup(m) {
      m.mapEvent({ id: "early", label: "Early", about: "", tuning: {}, on: {
        start(run) {
          try {
            run.walker({ species: "core:parasaur", x: 1, z: 1 });
          } catch (err) {
            faults.push((err as Error).message);
          }
        },
        live(run) {
          try {
            run.walker({ species: "core:pteranodon", x: 512, z: 512 });
          } catch (err) {
            faults.push((err as Error).message);
          }
        },
      } });
    },
  };
  const { h, events } = world(def);
  events.call("early", { source: "test", notice: 0 });
  h.run(500);
  expect(faults).toEqual(["a walker is placed once its event has come", 'a walker: "core:pteranodon" is no species of the content that walks']);
});

test("a walk goes on from the point it was making for after a restart", () => {
  const heard: string[] = [];
  const dbPath = join(dir, "restart.db");
  let pid = 0, w = 0;
  {
    const { h, events } = world(parade(heard, "loop"), dbPath);
    const ev = events.call("parade", { source: "test", notice: 0 });
    if (typeof ev === "string") throw new Error(ev);
    for (let t = 0; t < 400 && !heard.includes(`at ${ev.bag.walker} 0`); t++) h.run(100);
    expect(heard).toEqual([`at ${ev.bag.walker} 0`]);
    pid = walkerOf(h)!.pid;
    w = ev.bag.walker as number;
    h.host.shutdown();
  }
  {
    const { h, events } = world(parade(heard, "loop"), dbPath);
    const e = h.host.records.entOf.get(pid)!;
    expect(h.host.courses.of(e)?.at).toBe(1);
    h.run(30000);
    expect(heard.slice(0, 3)).toEqual([`at ${w} 0`, `at ${w} 1`, `at ${w} 2`]);
    events.cancel(events.events[0]!);
    h.run(100);
    expect(h.host.records.byPid.has(pid)).toBe(false);
    h.host.shutdown();
  }
});
