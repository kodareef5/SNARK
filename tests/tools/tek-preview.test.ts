import { expect, test } from "bun:test";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { outpostCrew, stageOutpost, stageWalls } from "../../tools/pieces/tek-preview.ts";
import { Harness } from "../fixtures/net.ts";
import { flatWorld } from "../fixtures/world.ts";

test("two Tek walls and a Metal wall stand on one rotated base", () => {
  const w = flatWorld(8);
  const walls = stageWalls(w);
  const frame = w.structs.frameAt(walls[0]!);
  expect(frame).toBeGreaterThan(0);
  expect(walls.map((ref) => w.structs.frameAt(ref))).toEqual([frame, frame, frame]);
  expect(walls.map((ref) => w.reg.defs[w.structs.chunks[ref >>> 16]!.kind[ref & 65535]!]!.id)).toEqual(["core:wall_tek", "core:wall_tek", "core:wall_metal"]);
});

test("the Tek outpost fits a gate, working entrance and pitched roof on one base", () => {
  const w = flatWorld(8);
  const refs = stageOutpost(w, 12);
  const frame = w.structs.frameAt(refs[0]!);
  const names = refs.map(ref => {
    const t = w.structs.chunks[ref >>> 16]!, s = ref & 65535;
    expect(w.structs.frameAt(ref)).toBe(frame);
    expect(t.owner[s]).toBe(12);
    return w.reg.ids[t.kind[s]!]!;
  });
  for (const form of ["gate", "gateway", "door", "doorframe", "stairs", "ceiling", "railing"]) expect(names).toContain(`core:${form}_tek`);
  expect(names.filter(n => n === "core:roof_tek")).toHaveLength(6);
});

test("joining reviewers share the staged outpost and can use its sensor", () => {
  const h = new Harness({}, 1, 60, { dev: true, modules: [outpostCrew(() => h.host)] });
  try {
    const first = h.join("builder"), next = h.join("guest");
    h.run(450);
    const team = h.host.records.byPid.get(h.client(first)!.pid)!.team;
    expect(team).toBeGreaterThan(0);
    expect(h.host.records.byPid.get(h.client(next)!.pid)!.team).toBe(team);
    const door = h.reg.index.get("core:door_tek")!;
    const entry = h.world.structs.chunks.find(chunk => chunk?.kind.includes(door))!;
    const slot = entry.kind.indexOf(door);
    expect(entry.owner[slot]).toBe(team);
    frameOf(entry.yaw[slot]!, entry.twAt(slot));
    h.world.ents.setPosition(h.ent(next), entry.x[slot]! + frame.sin * 1.75,
      entry.y[slot]! - h.reg.halfY[door]! + .05, entry.z[slot]! + frame.cos * 1.75);
    h.run(450);
    expect(h.reg.ids[entry.kind[slot]!]).toBe("core:door_open_tek");
  } finally {
    h.host.shutdown();
  }
});
