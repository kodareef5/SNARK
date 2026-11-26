// A named person is who it is; each role it plays dresses, arms and drives it. One person, made on the People page in the
// role's clothes, plays a vendor, then a police officer, then a vendor again, through the admin routes and the real Cast
// host, and across a restart; another in a wardrobe of its own keeps it in every role, under the role's armour.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bookOf, newPerson, personDoc, storeStateOf } from "../../client/core/admin/people.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { peopleAdmin, peopleState } from "../../server/admin/people-routes.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { TEMPER_DEFENDS } from "../../server/behavior.ts";
import { Guesses } from "../../server/guesses.ts";
import type { Character } from "../../shared/cast/state.ts";
import type { PersonDoc } from "../../shared/people/doc.ts";
import { WARDROBE_NAMES } from "../../shared/sim/items.ts";
import { Harness } from "../fixtures/net.ts";

const AUTH = { authorization: `Basic ${btoa("admin:kiwi")}`, origin: "http://world.example", host: "world.example", "content-type": "application/json" };
const FLAK = ["core:flak_boots", "core:flak_hat", "core:flak_pants", "core:flak_shirt"];
const SLOT = (name: (typeof WARDROBE_NAMES)[number]) => WARDROBE_NAMES.indexOf(name);

/** A world whose Cast makes nobody by itself, saved at `db`, with Ana online and the admin pages over it. */
function world(db: string, pages: string) {
  const h = new Harness({ entityRadius: 1 }, 2, 30, { dbPath: db, cast: { size: 0, activity: 0, hostility: 0 }, wakeRadius: 1 });
  h.join("Ana");
  h.run(1000);
  h.host.cast.cast.settings.maxPerPlayer = 30;
  const admin = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir: pages, start: { tick: 0, wall: Date.now() } });
  const gate = { dev: false, password: "kiwi", guesses: new Guesses(), tick: () => 0 };
  const cast = async (body: object): Promise<void> => {
    const r = await admin.answer(new Request("http://world.example/admin/cast", { method: "POST", headers: AUTH, body: JSON.stringify(body) }), "1.2.3.4", gate, "/admin/cast")!;
    expect([JSON.stringify(body), r.status, ((await r.json()) as { why: string }).why]).toEqual([JSON.stringify(body), 200, ""]);
  };
  return { h, cast };
}

/** Saves a person as the People page does, in the role's clothes unless `wardrobe` is given; its store id. */
async function makePerson(h: Harness, name: string, seed: number, wardrobe?: PersonDoc["wardrobe"]): Promise<number> {
  const reg = h.world.reg, state = storeStateOf(peopleState(h.host.people, reg) as unknown as Record<string, unknown>)!;
  const draft = { ...newPerson(state, seed), name };
  const doc = { ...personDoc(draft, state, bookOf(state, null)), ...(wardrobe ? { wardrobe } : {}) };
  if (!wardrobe) expect(doc.wardrobe).toBeNull();
  const text = JSON.stringify({ kind: "person", id: null, rev: 0, doc });
  const req = new Request("http://world.example/admin/people/save", { method: "POST", headers: { ...AUTH, "content-length": String(new TextEncoder().encode(text).length) }, body: text });
  const r = await peopleAdmin(req, "/admin/people/save", h.host.people, () => reg, h.host.acts)!;
  const answer = (await r.json()) as { id: number };
  expect(r.status).toBe(200);
  return answer.id;
}

/** The character playing named person `person`. */
const playing = (h: Harness, person: number): Character => [...h.host.cast.cast.people.byId.values()].find((c) => c.person === person && !c.dead)!;

/** Casts `person` in `scene`'s `role`, starts the scene and waits for its body; the body as worn and carried. */
async function play(w: ReturnType<typeof world>, scene: string, role: string, person: number) {
  const { h, cast } = w;
  await cast({ op: "role", scene, role, person });
  await cast({ op: "spawn", scene });
  let pid: number | undefined;
  for (let k = 0; k < 40 && pid === undefined; k++) {
    h.run(2000);
    const c = playing(h, person);
    pid = c && h.host.cast.stage.list().find((b) => b.character === c.id)?.pid;
  }
  expect(pid).toBeDefined();
  const c = playing(h, person), e = h.host.records.entOf.get(pid!)!, rec = h.host.records.byPid.get(pid!)!, inv = rec.inv!, defs = h.world.reg.defs;
  const ids = (from: number, n: number) => Array.from({ length: n }, (_, k) => inv.item[from + k]!);
  return {
    c, pid: pid!, look: [...h.world.ents.looks.get(e)!], born: h.world.ents.born.get(e) ?? null,
    armour: ids(inv.armor, 5).filter((i) => i !== 0).map((i) => defs[i]!.id).sort(),
    wardrobe: ids(inv.wardrobe, WARDROBE_NAMES.length).map((i) => (i ? defs[i]!.id : "")),
    dyes: WARDROBE_NAMES.map((_, k) => inv.dyeOf(inv.wardrobe + k)),
    pistol: inv.total(h.world.reg.index.get("core:pistol")!),
    defends: h.host.creatures.mind.temperOf[e] === TEMPER_DEFENDS,
  };
}

/** Ends the story `person` is in and waits until its body has gone, so another role may take it. */
async function release(w: ReturnType<typeof world>, person: number): Promise<void> {
  const { h, cast } = w, c = playing(h, person);
  await cast({ op: "retire", story: c.story! });
  for (let k = 0; k < 60 && (c.story || h.host.cast.stage.list().some((b) => b.character === c.id)); k++) h.run(2000);
  // Gone from the stage, the body walks no more.
  for (const b of h.host.cast.stage.list()) if (b.character === c.id) h.host.cast.stage["bodies"].remove(b.pid);
  expect([c.story ?? null, h.host.cast.stage.list().some((b) => b.character === c.id)]).toEqual([null, false]);
}

function asVendor(b: Awaited<ReturnType<typeof play>>): void {
  expect([b.c.archetype, b.c.look]).toEqual(["cast:vendor", "cast:vendor_apron"]);
  expect(b.wardrobe[SLOT("outer")]).toBe("core:apron");
  expect([b.wardrobe[SLOT("top")], b.wardrobe[SLOT("bottom")], b.wardrobe[SLOT("shoes")]]).toEqual(["core:tee", "core:jeans", "core:trainers"]);
  expect([b.armour, b.pistol, b.defends]).toEqual([[], 0, false]);
}

function asOfficer(b: Awaited<ReturnType<typeof play>>): void {
  expect([b.c.archetype, b.c.look]).toEqual(["cast:cop", "cast:police"]);
  expect(b.wardrobe).toEqual(["core:tee", "core:jeans", "", "core:trainers", ""]);
  expect([b.dyes[SLOT("top")], b.dyes[SLOT("bottom")]]).toEqual([30, 30]);
  expect([b.armour, b.pistol > 0, b.defends]).toEqual([FLAK, true, true]);
}

test("a named person plays vendor, officer and vendor again, as itself, across a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cast-roles-")), db = join(dir, "world.db");
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  try {
    const a = world(db, dir);
    const person = await makePerson(a.h, "Marisol Vega", 4242);
    const face = [...a.h.host.people.held().records.person.get(person)!.body.look];

    const vendor = await play(a, "cast:cart_queue", "vendor", person);
    asVendor(vendor);
    expect([vendor.look, vendor.born]).toEqual([face, null]);
    const me = vendor.c.id;
    a.h.host.cast.cast.people.met(vendor.c, "Ana", 0.4, "bought a croqueta", a.h.world.tick);
    a.h.host.cast.cast.people.remember(vendor.c, "Ana is a regular", a.h.world.tick, true);
    await release(a, person);

    const officer = await play(a, "cast:cop_beat", "cops", person);
    asOfficer(officer);
    expect([officer.c.id, officer.c.tier, officer.look, officer.c.relations.Ana?.met, officer.c.facts.some((f) => f.text === "Ana is a regular")]).toEqual([me, "featured", face, 1, true]);
    await release(a, person);

    const again = await play(a, "cast:cart_queue", "vendor", person);
    asVendor(again);
    expect([again.c.id, again.look, again.c.relations.Ana?.met]).toEqual([me, face, 1]);
    await release(a, person);
    a.h.host.cast.saved.dirty = true;
    a.h.run(61_000);
    a.h.host.shutdown();

    // Saved and started again: the same character, who it was and whom it met, and each role dresses it anew.
    const b = world(db, dir);
    try {
      const back = playing(b.h, person);
      expect([back.id, back.tier, back.relations.Ana?.met, back.archetype]).toEqual([me, "featured", 1, "cast:vendor"]);
      const cop = await play(b, "cast:cop_beat", "cops", person);
      asOfficer(cop);
      expect(cop.look).toEqual(face);
      await release(b, person);
      const cart = await play(b, "cast:cart_queue", "vendor", person);
      asVendor(cart);
      expect([cart.c.id, cart.look]).toEqual([me, face]);
    } finally {
      b.h.host.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a named person in a wardrobe of its own keeps it in every role, under the armour the role needs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cast-roles-own-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  const w = world(join(dir, "world.db"), dir);
  try {
    const own: PersonDoc["wardrobe"] = WARDROBE_NAMES.map((n) => (n === "outer" ? { garment: "core:hoodie", edition: 0, dye: [46, 0, 0] } : null));
    const person = await makePerson(w.h, "Rosa Diaz", 77, own);
    const hoodie = ["", "", "core:hoodie", "", ""];
    const officer = await play(w, "cast:cop_beat", "cops", person);
    expect([officer.wardrobe, officer.dyes[SLOT("outer")], officer.armour, officer.pistol > 0, officer.defends]).toEqual([hoodie, 46, FLAK, true, true]);
    await release(w, person);
    const vendor = await play(w, "cast:cart_queue", "vendor", person);
    expect([vendor.wardrobe, vendor.dyes[SLOT("outer")], vendor.armour, vendor.pistol, vendor.defends]).toEqual([hoodie, 46, [], 0, false]);
  } finally {
    w.h.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
