// Cast's people from the people store: a look drawn from an admin population, a role played by a named person in an
// admin outfit, and a person met or featured kept byte for byte through a restart and edits of what it was drawn from.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { castAct, castState } from "../../server/admin/cast.ts";
import type { By } from "../../server/people/store.ts";
import { CITY } from "../../content/people/defaults.ts";
import { LOOK_SKIN } from "../../shared/anim/look.ts";
import type { Character } from "../../shared/cast/state.ts";
import type { OutfitDoc, PersonDoc, PopulationDoc } from "../../shared/people/doc.ts";
import { dyeNumber, lookOfSeed, wireNumber } from "../../shared/people/person.ts";
import { WARDROBE_NAMES } from "../../shared/sim/items.ts";
import { Harness } from "../fixtures/net.ts";

const BY: By = { name: "kody", id: "" };
const TOP = WARDROBE_NAMES.indexOf("top"), BOTTOM = WARDROBE_NAMES.indexOf("bottom");
const { type: _t, id: _i, revision: _r, ...cityDoc } = CITY;
const CITY_DOC: PopulationDoc = cityDoc;
/** The city crowd edited: other skins, faces and builds altogether. */
const EDITED: PopulationDoc = { ...CITY_DOC, skin: [0, 0, 0, 0, 0, 0, 0, 0, 1, 5], face: 0.9, build: [0.3, 0.9] };

function world(db?: string): Harness {
  return new Harness({ entityRadius: 1 }, 2, 30, { cast: { size: 0, activity: 0, hostility: 0 }, wakeRadius: 1, ...(db ? { dbPath: db } : {}) });
}

function saved(r: ReturnType<Harness["host"]["people"]["save"]>): { id: number; rev: number } {
  if ("status" in r) throw new Error(r.error);
  return { id: r.id, rev: r.rev };
}

/** An admin population of the city crowd, an edition of the plain tee, an outfit wearing it dyed, and a named person. */
function stock(h: Harness) {
  const store = h.host.people;
  const pop = saved(store.save("population", null, 0, CITY_DOC, BY)).id;
  const ed = store.publish(store.view().revision, { garment: "core:plain_tee", colours: [5, 6, 7], print: null, name: "Orb tee" }, BY);
  if ("status" in ed) throw new Error(ed.error);
  const slots: OutfitDoc["slots"] = [null, null, null, null, null];
  const outfit: OutfitDoc = { name: "Vendor", slots: slots.map((_, k) => (k === TOP ? { choices: [{ garment: "core:plain_tee", edition: ed.id, weight: 1 }], dye: [3, 4, 5] } : k === BOTTOM ? { choices: [{ garment: "core:plain_trousers", edition: 0, weight: 1 }], dye: [0, 0, 0] } : null)) };
  const fit = saved(store.save("outfit", null, 0, outfit, BY)).id;
  const person: PersonDoc = { name: "Marisol Vega", look: { seed: 777, population: pop, revision: 1, locks: {} }, outfit: fit, wardrobe: null, notes: "" };
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
    // An unmet person of the same seed, drawn after an edit, follows it.
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
    const { marisol, edition } = stock(h);
    expect(castAct(h.host, { op: "role", scene: "cast:cart_queue", role: "vendor", person: marisol })).toBe("");
    expect(castAct(h.host, { op: "role", scene: "cast:cart_queue", role: "vendor", person: 404 })).toContain("no person 404");
    h.host.cast.cast.settings.maxPerPlayer = 30;
    expect(castAct(h.host, { op: "spawn", scene: "cast:cart_queue" })).toBe("");
    const story = [...h.host.cast.cast.stories.values()].find((s) => s.scene === "cast:cart_queue")!;
    const part = story.parts.find((p) => p.role === "vendor")!;
    const c = h.host.cast.cast.people.byId.get(part.character)!;
    expect([c.person, c.name, c.tier]).toEqual([marisol, "Marisol Vega", "featured"]);
    // Its body, once the stage brings it in, is the person the record draws, in the outfit's tee and trousers.
    h.run(40_000);
    const pid = h.host.cast.stage.list().find((b) => b.character === c.id)?.pid;
    expect(pid).toBeDefined();
    const e = h.host.records.entOf.get(pid!)!, ents = h.world.ents;
    expect(ents.born.get(e)).toEqual({ seed: 777, population: wireNumber(h.world.reg, 1)!, revision: 1 });
    const worn = ents.wardrobes.get(e)!, reg = h.world.reg;
    expect([worn[TOP * 3], worn[TOP * 3 + 1], worn[TOP * 3 + 2]]).toEqual([reg.index.get("core:plain_tee")!, edition, dyeNumber([3, 4, 5])]);
    expect([worn[BOTTOM * 3], worn[BOTTOM * 3 + 1]]).toEqual([reg.index.get("core:plain_trousers")!, 0]);
    // Dressed by its outfit, it wears none of the look's placeholder cloth.
    const inv = h.host.records.byPid.get(pid!)!.inv!;
    for (let k = 0; k < 5; k++) expect(inv.item[inv.armor + k]).toBe(0);
    expect(c.kept!.rev).toBe(1);
  } finally {
    h.host.shutdown();
  }
});

test("a featured person is byte-identical after a restart and edits of its sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "cast-people-"));
  try {
    const db = join(dir, "world.db");
    const a = world(db);
    a.join("Ana");
    a.run(1000);
    const { pop, fit, outfit } = stock(a);
    expect(castAct(a.host, { op: "look", look: "cast:vendor_apron", population: pop, outfit: fit })).toBe("");
    // A vendor is featured from the start: what it is drawn as now it keeps.
    const vendor = a.host.cast.cast.people.mint("cast:vendor", 0, 99, a.world.tick);
    const first = body(a, vendor);
    expect(vendor.kept).toBeDefined();
    expect(first.wardrobe[TOP * 3 + 1]).toBeGreaterThan(0);
    first.gone();
    // Its population and outfit edited, it is the same person in the same clothes, still sent as its seed.
    saved(a.host.people.save("population", pop, 1, EDITED, BY));
    saved(a.host.people.save("outfit", fit, 1, { ...outfit, slots: outfit.slots.map((s) => s && { ...s, dye: [9, 9, 9] }) }, BY));
    const edited = body(a, vendor);
    expect([edited.look, edited.wardrobe, edited.born]).toEqual([first.look, first.wardrobe, first.born]);
    edited.gone();
    a.host.cast.saved.dirty = true;
    a.host.shutdown();

    const b = world(db);
    b.join("Ana");
    b.run(1000);
    const back = b.host.cast.cast.people.byId.get(vendor.id)!;
    expect(back.kept).toEqual(vendor.kept);
    const after = body(b, back);
    expect([after.look, after.wardrobe, after.born]).toEqual([first.look, first.wardrobe, first.born]);
    // What the admin chose is kept with Cast too.
    expect(b.host.cast.cast.casting.looks["cast:vendor_apron"]).toEqual({ population: pop, outfit: fit });
    b.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a person a player met keeps the body it had; one nobody met keeps none", () => {
  const h = world();
  try {
    h.join("Ana");
    h.run(1000);
    const { pop } = stock(h);
    expect(castAct(h.host, { op: "look", look: "cast:street_plain", population: pop })).toBe("");
    const people = h.host.cast.cast.people;
    const met = people.mint("cast:pedestrian", 0, 5150, h.world.tick), passer = people.mint("cast:pedestrian", 0, 5151, h.world.tick);
    met.look = passer.look = "cast:street_plain";
    const seen = body(h, met), other = body(h, passer);
    people.met(met, "Ana", 0.05, "Ana waved", h.world.tick);
    expect([met.tier, !!met.kept, !!passer.kept]).toEqual(["featured", true, false]);
    expect([...Buffer.from(met.kept!.look, "base64")]).toEqual(seen.look);
    seen.gone();
    other.gone();
    saved(h.host.people.save("population", pop, 1, EDITED, BY));
    const again = body(h, met);
    expect([again.look, again.born]).toEqual([seen.look, seen.born]);
    // An admin may feature a person too.
    const third = people.mint("cast:pedestrian", 0, 5152, h.world.tick);
    const shown = body(h, third);
    expect(castAct(h.host, { op: "feature", character: third.id })).toBe("");
    expect([third.tier, [...Buffer.from(third.kept!.look, "base64")]]).toEqual(["featured", shown.look]);
  } finally {
    h.host.shutdown();
  }
});

test("a named person follows its own record's edits, and nothing else's", () => {
  const h = world();
  try {
    h.join("Ana");
    h.run(1000);
    const { pop, fit, outfit, person, marisol } = stock(h);
    const c = h.host.cast.cast.people.mintNamed("cast:vendor", 0, marisol, "Marisol Vega", h.world.tick);
    const first = body(h, c);
    first.gone();
    // Its population and its outfit edited: it is as it was.
    saved(h.host.people.save("population", pop, 1, EDITED, BY));
    saved(h.host.people.save("outfit", fit, 1, { ...outfit, slots: outfit.slots.map((s) => s && { ...s, dye: [9, 9, 9] }) }, BY));
    const same = body(h, c);
    expect([same.look, same.wardrobe, same.born]).toEqual([first.look, first.wardrobe, first.born]);
    same.gone();
    // Its own record edited, with a face locked: it is drawn again, and goes as its bytes since no seed form holds a lock.
    saved(h.host.people.save("person", marisol, 1, { ...person, look: { seed: 778, population: pop, revision: 2, locks: { face: 31 } } }, BY));
    const redone = body(h, c);
    expect(redone.look).not.toEqual(first.look);
    expect(redone.born).toBeNull();
    expect(redone.wardrobe[TOP * 3 + 2]).toBe(dyeNumber([9, 9, 9]));
    expect(c.kept!.rev).toBe(2);
    redone.gone();
    // Its edited body is now the kept one.
    const kept = body(h, c);
    expect([kept.look, kept.wardrobe]).toEqual([redone.look, redone.wardrobe]);
  } finally {
    h.host.shutdown();
  }
});
