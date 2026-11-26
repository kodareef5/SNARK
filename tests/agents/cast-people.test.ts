// Cast's people from the people store: a look drawn from an admin population, a role played by a named person in its
// saved look and wardrobe, and a role's armour kept under an outfit.

import { expect, test } from "bun:test";
import { castAct, castState } from "../../server/admin/cast.ts";
import type { By } from "../../server/people/store.ts";
import { CITY } from "../../content/people/defaults.ts";
import { LOOK_SKIN } from "../../shared/anim/look.ts";
import type { Character } from "../../shared/cast/state.ts";
import type { OutfitDoc, PersonDoc, PopulationDoc } from "../../shared/people/doc.ts";
import { dyeNumber, lookOfSeed, personFrom, wardrobeFrom, wireNumber } from "../../shared/people/person.ts";
import { WARDROBE_NAMES } from "../../shared/sim/items.ts";
import { Harness } from "../fixtures/net.ts";

const BY: By = { name: "kody", id: "" };
const TOP = WARDROBE_NAMES.indexOf("top"), BOTTOM = WARDROBE_NAMES.indexOf("bottom");
const { type: _t, id: _i, ...cityDoc } = CITY;
const CITY_DOC: PopulationDoc = cityDoc;
/** The city crowd edited: other skins, faces and builds altogether. */
const EDITED: PopulationDoc = { ...CITY_DOC, skin: [0, 0, 0, 0, 0, 0, 0, 0, 1, 5], face: 0.9, build: [0.3, 0.9] };

function world(): Harness {
  return new Harness({ entityRadius: 1 }, 2, 30, { cast: { size: 0, activity: 0, hostility: 0 }, wakeRadius: 1 });
}

function saved(r: ReturnType<Harness["host"]["people"]["save"]>): { id: number; rev: number } {
  if ("status" in r) throw new Error(r.error);
  return { id: r.id, rev: r.rev };
}

/** An admin population of the city crowd, an edition of the plain tee, an outfit wearing it dyed, and a named person. */
function stock(h: Harness) {
  const store = h.host.people;
  const pop = saved(store.save("population", null, 0, CITY_DOC, BY)).id;
  const ed = store.publish(store.view().revision, { garment: "core:tee", colours: [5, 6, 7], print: null, name: "Orb tee" }, BY);
  if ("status" in ed) throw new Error(ed.error);
  const slots: OutfitDoc["slots"] = [null, null, null, null, null];
  const outfit: OutfitDoc = { name: "Vendor", slots: slots.map((_, k) => (k === TOP ? { choices: [{ garment: "core:tee", edition: ed.id, weight: 1 }], dye: [3, 4, 5] } : k === BOTTOM ? { choices: [{ garment: "core:jeans", edition: 0, weight: 1 }], dye: [0, 0, 0] } : null)) };
  const fit = saved(store.save("outfit", null, 0, outfit, BY)).id;
  const look = [...personFrom(777, store.population(pop, 1)!).look];
  const person: PersonDoc = { name: "Marisol Vega", look, wardrobe: wardrobeFrom(777, outfit), source: { seed: 777, population: pop, locks: {}, outfit: fit }, notes: "" };
  const marisol = saved(store.save("person", null, 0, person, BY)).id;
  return { pop, edition: ed.id, outfit, fit, person, marisol };
}

let placed = 0;

/** A body for `c` about the first survivor, each in a place of its own: its entity, look, seed form and wardrobe. */
function body(h: Harness, c: Character) {
  const cast = h.host.cast, bodies = cast.stage["bodies"], at = h.server.clients.find((x) => x?.active)!.body, turn = placed++ * 2.39996;
  const pid = bodies.spawn(c, cast.cast.people.archetype(c.archetype)!, at.x + Math.sin(turn) * 6, at.z + Math.cos(turn) * 6, 0);
  expect(pid).toBeGreaterThan(0);
  const e = h.host.records.entOf.get(pid)!, ents = h.world.ents;
  const shown = { look: [...ents.looks.get(e)!], born: ents.born.get(e) ?? null, wardrobe: [...(ents.wardrobes.get(e) ?? [])], name: ents.names.get(e) };
  return { pid, e, ...shown, gone: () => bodies.remove(pid) };
}

test("a look may draw from an admin population, at its latest revision, as a seed", () => {
  const h = world();
  try {
    h.join("Ana");
    h.run(1000);
    const { pop } = stock(h);
    expect(castAct(h.host, { op: "look", look: "cast:street_plain", population: pop })).toBe("");
    expect(castAct(h.host, { op: "look", look: "cast:street_plain", population: 99 })).toContain("no population 99");
    const people = h.host.cast.cast.people;
    const mint = () => {
      const c = people.mint("cast:pedestrian", 0, 4242, h.world.tick);
      c.look = "cast:street_plain";
      return c;
    };
    const first = body(h, mint());
    expect(first.born).toEqual({ seed: first.born!.seed, population: wireNumber(h.world.reg, pop)!, revision: 1 });
    expect([...lookOfSeed(h.world.reg, first.born!.seed, first.born!.population, 1, h.host.people)!]).toEqual(first.look);
    // A person of the same seed, drawn after an edit, follows it.
    saved(h.host.people.save("population", pop, 1, EDITED, BY));
    const again = body(h, mint());
    expect(again.born!.revision).toBe(2);
    expect(again.look).not.toEqual(first.look);
    expect(again.look[LOOK_SKIN]).toBeGreaterThanOrEqual(8);
    expect(JSON.parse(castState(h.host, Date.now())).looks.find((l: { id: string }) => l.id === "cast:street_plain").chosen).toEqual({ population: pop });
  } finally {
    h.host.shutdown();
  }
});

test("a role's named person wears its admin outfit with its edition and dye", () => {
  const h = world();
  try {
    h.join("Ana");
    h.run(1000);
    const { marisol, edition, person } = stock(h);
    expect(castAct(h.host, { op: "role", scene: "cast:cart_queue", role: "vendor", person: marisol })).toBe("");
    expect(castAct(h.host, { op: "role", scene: "cast:cart_queue", role: "vendor", person: 404 })).toContain("no person 404");
    h.host.cast.cast.settings.maxPerPlayer = 30;
    expect(castAct(h.host, { op: "spawn", scene: "cast:cart_queue" })).toBe("");
    const story = [...h.host.cast.cast.stories.values()].find((s) => s.scene === "cast:cart_queue")!;
    const part = story.parts.find((p) => p.role === "vendor")!;
    const c = h.host.cast.cast.people.byId.get(part.character)!;
    expect([c.person, c.name, c.tier]).toEqual([marisol, "Marisol Vega", "featured"]);
    // Its body, once the stage brings it in, is the person's saved bytes, in the outfit's tee and trousers.
    h.run(40_000);
    const pid = h.host.cast.stage.list().find((b) => b.character === c.id)?.pid;
    expect(pid).toBeDefined();
    const e = h.host.records.entOf.get(pid!)!, ents = h.world.ents;
    expect([ents.born.get(e) ?? null, [...ents.looks.get(e)!]]).toEqual([null, [...person.look]]);
    const worn = ents.wardrobes.get(e)!, reg = h.world.reg;
    expect([worn[TOP * 3], worn[TOP * 3 + 1], worn[TOP * 3 + 2]]).toEqual([reg.index.get("core:tee")!, edition, dyeNumber([3, 4, 5])]);
    expect([worn[BOTTOM * 3], worn[BOTTOM * 3 + 1]]).toEqual([reg.index.get("core:jeans")!, 0]);
    // Dressed by its outfit, it wears none of the look's placeholder cloth.
    const inv = h.host.records.byPid.get(pid!)!.inv!;
    for (let k = 0; k < 5; k++) expect(inv.item[inv.armor + k]).toBe(0);
  } finally {
    h.host.shutdown();
  }
});

test("a named person is its saved look and wardrobe, whatever else is edited", () => {
  const h = world();
  try {
    h.join("Ana");
    h.run(1000);
    const { pop, fit, outfit, person, marisol } = stock(h);
    const c = h.host.cast.cast.people.mintNamed("cast:vendor", 0, marisol, "Marisol Vega", h.world.tick);
    const first = body(h, c);
    expect([first.look, first.born, first.wardrobe[TOP * 3 + 2]]).toEqual([[...person.look], null, dyeNumber([3, 4, 5])]);
    first.gone();
    // Its population and its outfit edited: neither the record nor the body moves.
    saved(h.host.people.save("population", pop, 1, EDITED, BY));
    saved(h.host.people.save("outfit", fit, 1, { ...outfit, slots: outfit.slots.map((s) => s && { ...s, dye: [9, 9, 9] }) }, BY));
    expect(h.host.people.view().records.person.get(marisol)!.body).toEqual(person);
    const same = body(h, c);
    expect([same.look, same.wardrobe, same.born]).toEqual([first.look, first.wardrobe, null]);
    same.gone();
    // Renamed, it is the same body.
    saved(h.host.people.save("person", marisol, 1, { ...person, name: "Marisol Reyes" }, BY));
    const renamed = body(h, c);
    expect([renamed.look, renamed.wardrobe, renamed.born]).toEqual([first.look, first.wardrobe, null]);
    renamed.gone();
    // Its own record given another look and no top: the body follows it.
    const other = [...personFrom(778, h.host.people.population(pop, 2)!).look];
    saved(h.host.people.save("person", marisol, 2, { ...person, look: other, wardrobe: person.wardrobe!.map((w, k) => (k === TOP ? null : w)) }, BY));
    const redone = body(h, c);
    expect([redone.look, redone.born, redone.wardrobe[TOP * 3]]).toEqual([other, null, 0]);
  } finally {
    h.host.shutdown();
  }
});

/** The ids worn in a body's armour slots, and the garment in its top slot. */
function dressOf(h: Harness, pid: number): { armour: string[]; top: string | undefined } {
  const inv = h.host.records.byPid.get(pid)!.inv!, defs = h.world.reg.defs;
  const armour = [0, 1, 2, 3, 4].map((k) => inv.item[inv.armor + k]!).filter((i) => i !== 0).map((i) => defs[i]!.id).sort();
  return { armour, top: defs[inv.item[inv.wardrobe + TOP]!]?.id };
}

const FLAK = ["core:flak_boots", "core:flak_hat", "core:flak_pants", "core:flak_shirt"];

test("a police role in a tee keeps its flak", () => {
  const h = world();
  try {
    h.join("Ana");
    h.run(1000);
    const { person } = stock(h);
    const tee = person.wardrobe!.map((w, k) => (k === TOP ? w : null));
    const officer = saved(h.host.people.save("person", null, 0, { ...person, name: "Officer Vega", wardrobe: tee }, BY)).id;
    const c = h.host.cast.cast.people.mintNamed("cast:cop", 0, officer, "Officer Vega", h.world.tick);
    expect(c.look).toBe("cast:police");
    const cop = body(h, c);
    expect(dressOf(h, cop.pid)).toEqual({ armour: FLAK, top: "core:tee" });
  } finally {
    h.host.shutdown();
  }
});

test("an admin population's outfit takes its slots, and the role's armour the rest", () => {
  const h = world();
  try {
    h.join("Ana");
    h.run(1000);
    const dressed = saved(h.host.people.save("population", null, 0, { ...CITY_DOC, outfits: [{ wear: ["core:tee", "core:cloth_pants"], weight: 1 }] }, BY)).id;
    expect(castAct(h.host, { op: "look", look: "cast:police", population: dressed })).toBe("");
    const c = h.host.cast.cast.people.mint("cast:cop", 0, 31, h.world.tick);
    const cop = body(h, c);
    expect(dressOf(h, cop.pid)).toEqual({ armour: ["core:cloth_pants", "core:flak_boots", "core:flak_hat", "core:flak_shirt"], top: "core:tee" });
  } finally {
    h.host.shutdown();
  }
});
