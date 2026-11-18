import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { PATH_TICK_CELLS } from "../../server/behavior.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

test("a growing follower keeps a route through tiny growth, then replans before following a now-too-low doorway", () => {
  const built = compileContent(CORE_CONTENT.map(d => d.id === "core:dodo" && d.type === "species" ? {...d,radius:.6,height:3.96,eyeHeight:1.32} : d));
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const h = new Harness({},1,60,{dev:true,map:writeMap(flatMap())},built.registry);
  try {
    const ada = h.join("observer"); h.run(300); h.say(ada,"enablecheats"); h.say(ada,"tp 120 126");
    const ents = h.world.ents, mind = h.host.creatures.mind, owner = h.host.records.byPid.get(h.client(ada)!.pid)!;
    const e = h.host.spawnCreature("core:dodo",114,114,1), rec = h.host.records.byPid.get(ents.pid[e]!)!;
    expect(h.host.taming.give(rec,owner,0,"forced")).toBe(true);
    const resize = (size:number) => {
      const birth = h.reg.birthScale[rec.kind]!;
      rec.span = 100000; rec.grown = h.world.tick+Math.round(rec.span*(1-(size-birth)/(1-birth)));
      ents.setYoung(e,rec.span,rec.grown);
    };
    const birth = h.reg.birthScale[rec.kind]!; resize(birth);
    for (let i = -5; i <= 5; i++) {
      const kind = h.reg.index.get(i === 0 ? "core:doorframe_wood" : "core:wall_wood")!;
      h.world.structs.add(kind,120+i*3,1.5,120,0,0,10000);
    }
    rec.follow = owner.pid; mind.follow(e,h.ent(ada));
    for (let i = 0; i < 120 && mind.wayLeft(e) === 0; i++) h.run(1000/30);
    expect(mind.wayLeft(e)).toBeGreaterThan(0);
    const searches = mind.searches;
    expect(ents.z[e]!).toBeLessThan(117);
    resize(birth*1.005); h.run(250);
    expect(mind.wayLeft(e)).toBeGreaterThan(0); expect(mind.searches).toBe(searches);
    // It has not reached the opening. A replan here cannot be the ordinary stuck-body fallback.
    resize(.8); h.run(600);
    expect(ents.z[e]!).toBeLessThan(118);
    expect(mind.searches).toBeGreaterThan(searches);
    expect(mind.searches).toBeLessThanOrEqual(searches+2);
  } finally { h.host.shutdown(); }
});

test("growth during a budgeted incremental search rejects its old footprint before publishing the route", () => {
  const h = new Harness({},1,60,{dev:true,map:writeMap(flatMap())});
  try {
    const ada = h.join("observer"); h.run(300); h.say(ada,"enablecheats"); h.say(ada,"tp 120 126");
    const ents = h.world.ents, mind = h.host.creatures.mind, owner = h.host.records.byPid.get(h.client(ada)!.pid)!;
    const e = h.host.spawnCreature("core:dodo",120,114,1), rec = h.host.records.byPid.get(ents.pid[e]!)!;
    expect(h.host.taming.give(rec,owner,0,"forced")).toBe(true);
    rec.span = 100000; rec.grown = h.world.tick+rec.span; ents.setYoung(e,rec.span,rec.grown);
    for (let i = -30; i <= 30; i++) h.world.structs.add(h.reg.index.get("core:wall_wood")!,120+i*3,1.5,120,0,0,10000);
    rec.follow = owner.pid; mind.follow(e,h.ent(ada));
    let pending = false;
    for (let i = 0; i < 30 && !pending; i++) {
      h.run(1000/30); expect(mind.spent).toBeLessThanOrEqual(PATH_TICK_CELLS);
      pending = mind.searched > 0 && mind.searches === 0;
    }
    expect(pending).toBe(true); expect(mind.wayLeft(e)).toBe(0);
    rec.grown = h.world.tick+Math.round(rec.span*.2); ents.setYoung(e,rec.span,rec.grown);
    for (let i = 0; i < 20 && mind.searches === 0; i++) {
      h.run(1000/30); expect(mind.spent).toBeLessThanOrEqual(PATH_TICK_CELLS);
    }
    expect(mind.searches).toBeGreaterThan(0);
    expect(mind.wayLeft(e)).toBe(0);
  } finally { h.host.shutdown(); }
});
