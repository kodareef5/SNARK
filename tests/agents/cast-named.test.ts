// cast.json lists who plays a named person, so the people page can feature one; the feature op keeps it.
import { expect, test } from "bun:test";
import { castAct, castState } from "../../server/admin/cast.ts";
import { CITY } from "../../content/people/defaults.ts";
import type { PopulationDoc } from "../../shared/people/doc.ts";
import { personFrom } from "../../shared/people/person.ts";
import { Harness } from "../fixtures/net.ts";

const { type: _t, id: _i, revision: _r, ...cityDoc } = CITY;

test("cast.json names who plays a named person, and feature keeps them", () => {
  const h = new Harness({ entityRadius: 1 }, 2, 30, { cast: { size: 0, activity: 0, hostility: 0 }, wakeRadius: 1 });
  try {
    h.join("Ana");
    h.run(1000);
    const store = h.host.people, by = { name: "kody", id: "" };
    const pop = store.save("population", null, 0, cityDoc as PopulationDoc, by);
    if ("status" in pop) throw new Error(pop.error);
    const made = store.save("person", null, 0, { name: "Rosa Diaz", look: [...personFrom(3, CITY).look], wardrobe: null, source: { seed: 3, population: pop.id, locks: {}, outfit: null }, notes: "" }, by);
    if ("status" in made) throw new Error(made.error);
    expect(castAct(h.host, { op: "role", scene: "cast:cart_queue", role: "vendor", person: made.id })).toBe("");
    const before = JSON.parse(castState(h.host, Date.now()));
    expect(before.roles.find((r: { key: string }) => r.key === "cast:cart_queue/vendor").person).toBe(made.id);
    expect(before.named).toEqual([]);
    // A body minted for the person and not yet featured is listed, and the page's feature op features it.
    const c = h.host.cast.cast.people.mint("cast:pedestrian", 0, 99, h.world.tick);
    c.person = made.id;
    const named = JSON.parse(castState(h.host, Date.now())).named;
    expect(named).toEqual([{ id: c.id, name: c.name, person: made.id, featured: false, dead: false, story: null }]);
    expect(castAct(h.host, { op: "feature", character: c.id })).toBe("");
    expect(JSON.parse(castState(h.host, Date.now())).named[0].featured).toBe(true);
  } finally {
    h.host.shutdown();
  }
});
