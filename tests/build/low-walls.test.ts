// Walls by height, rails, beams and the thin pillar: what offers them, how they stack, what holds them and what they shut.

import { expect, test } from "bun:test";
import { STRUCT_DEMOLISH, STRUCT_PICKUP } from "../../shared/world/upkeep.ts";
import type { EngramDef, ItemDef, StructureDef } from "../../shared/content/defs.ts";
import { RESULT_NO_SUPPORT, RESULT_NO_SNAP, RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { Enclosure, SENSE_BODY, enclose } from "../../shared/world/lattice/rooms.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { builder } from "../fixtures/build.ts";
import { Plot, at, cornerFault, hand, keyOf, send } from "../fixtures/pieces.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const YAWS = [0, 5003];

test("the low pieces are kinds in wood, stone and metal, one item for the two low walls and the thin pillar and beam on the pillar's", () => {
  for (const tier of ["wood", "stone", "metal"]) {
    for (const form of ["half_wall", "quarter_wall", "railing", "beam", "thin_pillar"]) expect([form, tier, reg.forms.def[id(`${form}_${tier}`)] !== null]).toEqual([form, tier, true]);
    expect([...reg.places[id(`piece_half_wall_${tier}`)]!]).toEqual([id(`half_wall_${tier}`), id(`quarter_wall_${tier}`)]);
    expect([...reg.places[id(`piece_pillar_${tier}`)]!]).toEqual([id(`pillar_${tier}`), id(`thin_pillar_${tier}`), id(`beam_${tier}`)]);
    expect([...reg.places[id(`piece_railing_${tier}`)]!]).toEqual([id(`railing_${tier}`)]);
  }
  // Thatch has the half wall and the railing alone of these.
  expect([reg.index.get("core:railing_thatch") !== undefined, [...reg.places[id("piece_half_wall_thatch")]!], reg.index.get("core:beam_thatch"), reg.index.get("core:quarter_wall_thatch")]).toEqual([true, [id("half_wall_thatch")], undefined, undefined]);
  const engram = reg.defs[id("engram-piece_railing_wood")] as EngramDef;
  expect([engram.level, engram.cost]).toEqual([14, 3]);
  expect((reg.defs[id("piece_half_wall_stone")] as ItemDef).label).toBe("stone half wall");
  expect([(reg.defs[id("half_wall_wood")] as StructureDef).hp, (reg.defs[id("railing_metal")] as StructureDef).hp, (reg.defs[id("thin_pillar_stone")] as StructureDef).hp]).toEqual([5000, 10000, 6250]);
});

for (const yaw of YAWS) {
  test(`at yaw ${yaw}: low walls stack by quarter storeys, and nothing stands in a level a taller piece covers`, () => {
    const w = flatWorld(4);
    const p = new Plot(w);
    p.start(100, 100, yaw);
    const south = at(1, 0);
    // A foundation offers its sides to each of them.
    for (const piece of ["half_wall", "quarter_wall", "railing"]) expect([piece, p.offers(`core:${piece}_wood`, south, 0, 0, at(1, 1))]).toEqual([piece, true]);
    // Two half walls are a wall's height: a ceiling lies on them as on a wall, and a wall stands on a half wall.
    const refs = [p.put("core:half_wall_wood", south, 0, 0), p.put("core:half_wall_wood", south, 2, 0)];
    expect(p.offers("core:ceiling_wood", at(1, 1), 4, 0, south, 4)).toBe(true);
    refs.push(p.put("core:ceiling_wood", at(1, 1), 4, 0));
    expect(p.stability(refs[2]!)).toBe(3);
    // The edge is taken at every level they cover: by its key where the floor offers it, and as no place at all higher up.
    expect([p.judge("core:wall_wood", south, 0, 0), p.judge("core:wall_wood", south, 1, 0)]).toEqual([RESULT_OBSTRUCTED, RESULT_NO_SNAP]);
    refs.push(p.put("core:quarter_wall_wood", at(1, 2), 0, 6), p.put("core:quarter_wall_wood", at(1, 2), 1, 6), p.put("core:half_wall_wood", at(1, 2), 2, 6));
    expect([p.judge("core:quarter_wall_wood", at(1, 2), 3, 6), p.judge("core:railing_wood", at(1, 2), 0, 6)]).toEqual([RESULT_OBSTRUCTED, RESULT_OBSTRUCTED]);
    refs.push(p.put("core:wall_wood", at(0, 1), 0, 9), p.put("core:half_wall_wood", at(2, 1), 0, 3), p.put("core:wall_wood", at(2, 1), 2, 3));
    // A half wall's top takes a floor half a storey up.
    expect(p.judge("core:ceiling_wood", at(3, 1), 2, 0)).toBe(RESULT_OK);
    for (const ref of refs) expect(cornerFault(w, ref)).toBe("");
    // Every one of them stands straight on the foundation.
    expect(refs.filter((_, i) => i !== 2).map((ref) => p.stability(ref))).toEqual(refs.slice(1).map(() => 4));
  });

  test(`at yaw ${yaw}: a railing stands on a floor's edge and takes nothing on top; a beam hangs at a wall's head between posts`, () => {
    const w = flatWorld(4);
    const p = new Plot(w);
    p.start(100, 100, yaw);
    p.put("core:foundation_wood", at(3, 1), 0, 0);
    const rail = p.put("core:railing_wood", at(1, 0), 0, 0);
    expect(cornerFault(w, rail)).toBe("");
    // Nothing is offered on a railing: not a wall, not a floor at its top.
    expect([p.offers("core:wall_wood", at(1, 0), 1, 0), p.offers("core:ceiling_wood", at(1, 1), 1, 0, at(1, 0), 1)]).toEqual([false, false]);
    expect(p.judge("core:wall_wood", at(1, 0), 1, 0)).toBe(RESULT_NO_SNAP);
    // Posts at two corners offer the edge between them at their heads to a beam, and hold it.
    const posts = [p.put("core:pillar_wood", at(0, 0), 0, 0), p.put("core:thin_pillar_wood", at(4, 0), 0, 0)];
    expect(p.offers("core:beam_wood", at(3, 0), 3, 0, at(4, 0), 4)).toBe(true);
    const beam = p.put("core:beam_wood", at(3, 0), 3, 0);
    expect([cornerFault(w, beam), p.stability(beam)]).toEqual(["", 3]);
    // A wall is not a beam: no post offers one, and one alone holds none.
    expect(p.offers("core:wall_wood", at(-1, 0), 0, 0, at(0, 0), 0)).toBe(false);
    // The beam's top is the posts': a floor over the posts lies on it too.
    expect(w.reg.halfY[w.kind("core:beam_wood")]! + w.structs.chunks[Math.floor(beam / 65536)]!.y[beam & 0xffff]!).toBeCloseTo(p.height(4), 9);
    // With its post gone the beam falls; a second beam past a wall's end hangs under the floor over it.
    const site = p.site;
    w.structs.remove(posts[1]!);
    site.support.forget();
    expect(p.stability(beam)).toBe(-1);
    w.structs.remove(beam);
    const wall = p.put("core:wall_wood", at(1, 2), 0, 6);
    p.put("core:ceiling_wood", at(1, 1), 4, 0);
    const far = p.put("core:ceiling_wood", at(3, 1), 4, 0);
    // A floor offers the underside of its edges to a beam, and the wall its own head on past its end.
    expect([p.offers("core:beam_wood", at(2, 1), 3, 3, at(2, 1), 4), p.offers("core:beam_wood", at(3, 2), 3, 0, at(3, 2), 4)]).toEqual([true, true]);
    const hung = p.put("core:beam_wood", at(2, 1), 3, 3);
    expect([p.stability(wall), p.stability(far), p.stability(hung)]).toEqual([4, 1, 2]);
    // Under the second floor out it would hang from a floor of 1, which holds no more.
    expect(p.judge("core:beam_wood", at(3, 2), 3, 0)).toBe(RESULT_NO_SUPPORT);
    expect(p.judge("core:wall_wood", at(2, 1), 0, 3)).toBe(RESULT_OBSTRUCTED);
  });
}

test("a thin pillar stands where a pillar does, holds a floor over it as one does, and the two do not share a corner", () => {
  const w = flatWorld(4);
  const p = new Plot(w);
  p.start(100, 100, 777);
  const thin = p.put("core:thin_pillar_wood", at(1, 1), 0, 0);
  expect(p.judge("core:pillar_wood", at(1, 1), 0, 0)).toBe(RESULT_OBSTRUCTED);
  const floor = p.put("core:ceiling_wood", at(1, 1), 4, 0);
  expect([p.stability(thin), p.stability(floor)]).toEqual([4, 4]);
  const corner = p.put("core:thin_pillar_wood", at(2, 2), 0, 0);
  expect(p.stability(p.put("core:ceiling_wood", at(3, 3), 4, 0))).toBe(2);
  expect(cornerFault(w, corner)).toBe("");
});

test("a room walled with a half wall on one side is open, and shut once a second half wall stands on the first", () => {
  const w = flatWorld(4);
  const p = new Plot(w);
  p.start(100, 100, 0);
  for (const [mid, own] of [[at(1, 0), 0], [at(2, 1), 3], [at(0, 1), 9]] as const) p.put("core:wall_wood", mid, 0, own);
  p.put("core:half_wall_wood", at(1, 2), 0, 6);
  p.put("core:ceiling_wood", at(1, 1), 4, 0);
  const rooms = new Enclosure(w.reg.forms, SENSE_BODY);
  const flood = (): number => (enclose(w.structs, p.fr, rooms), rooms.flood(), rooms.found.inside);
  expect(flood()).toBe(0);
  // A half wall closes nothing by itself, so two of them close nothing either: a wall's height of them is still a fence.
  p.put("core:half_wall_wood", at(1, 2), 2, 6);
  expect(flood()).toBe(0);
  // A body is stopped by it all the same.
  const [x, z] = p.metres(at(1, 2));
  expect(capsuleFree(w, x, p.height(0) + 0.01, z, 0.3, 1.8)).toBe(false);
});

test("a builder sets a railing, a quarter wall and a beam down through the server, takes one back and takes one down for half its cost", () => {
  const { h, sessions, structs, act, has } = builder();
  const s = sessions[0]!;
  const w = { dims: h.world.dims, hf: h.world.hf, structs, reg: h.reg, kind: (name: string): number => h.reg.index.get(name)! };
  const p = new Plot(w, h.host.records.byPid.get(h.client(s)!.pid)!.team);
  // The first foundation goes down as the server sets a base's first piece, near the builder.
  p.start(s.own.x, s.own.z + 4, 9001);
  hand(h, s, "piece_railing_wood");
  const rail = send(h, s, 0, keyOf(w, p.fr, "core:railing_wood", at(1, 0), 0, 0));
  expect([rail.code, structs.chunks[Math.floor(rail.ref / 65536)]!.kind[rail.ref & 0xffff]]).toEqual([RESULT_OK, id("railing_wood")]);
  hand(h, s, "piece_half_wall_wood");
  const quarter = send(h, s, 1, keyOf(w, p.fr, "core:quarter_wall_wood", at(2, 1), 0, 3));
  expect([quarter.code, structs.chunks[Math.floor(quarter.ref / 65536)]!.kind[quarter.ref & 0xffff]]).toEqual([RESULT_OK, id("quarter_wall_wood")]);
  // A third form the item does not have is no piece.
  expect(send(h, s, 2, keyOf(w, p.fr, "core:quarter_wall_wood", at(0, 1), 0, 9)).code).not.toBe(RESULT_OK);
  hand(h, s, "piece_pillar_wood");
  expect(send(h, s, 0, keyOf(w, p.fr, "core:pillar_wood", at(0, 2), 0, 0)).code).toBe(RESULT_OK);
  expect(send(h, s, 1, keyOf(w, p.fr, "core:thin_pillar_wood", at(2, 2), 0, 0)).code).toBe(RESULT_OK);
  const beam = send(h, s, 2, keyOf(w, p.fr, "core:beam_wood", at(1, 2), 3, 0));
  expect(beam.code).toBe(RESULT_OK);
  // The client holds the same rows.
  const mine = s.world!.structs.chunks[Math.floor(beam.ref / 65536)]!;
  expect(mine.kind[beam.ref & 0xffff]).toBe(id("beam_wood"));
  // Taken back whole inside the window, as any piece; taken down for half of what it is made of, rounded down.
  const rails = has(s, "piece_railing_wood");
  expect([act(s, rail.ref, STRUCT_PICKUP), has(s, "piece_railing_wood")]).toEqual([RESULT_OK, rails + 1]);
  const wood = has(s, "wood");
  expect([act(s, quarter.ref, STRUCT_DEMOLISH), has(s, "wood") - wood]).toEqual([RESULT_OK, 10]);
});
