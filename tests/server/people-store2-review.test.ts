// Faults found in review of the people store's named people, outfits and admin populations: each test fails today.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { peopleAdmin } from "../../server/admin/people-routes.ts";
import { refused, type AdminGate } from "../../server/admin/gate.ts";
import { Guesses } from "../../server/guesses.ts";
import { PeopleStore, type By } from "../../server/people/store.ts";
import { BEACH } from "../../content/people/defaults.ts";
import { refFaults } from "../../shared/content/classes.ts";
import type { Def } from "../../shared/content/defs.ts";
import type { PersonDoc } from "../../shared/people/doc.ts";
import { TestCluster, type Server } from "../fixtures/cluster.ts";

const scratch = join(import.meta.dir, "../../var");
mkdirSync(scratch, { recursive: true });
const root = mkdtempSync(join(scratch, "people-store2-review-"));
const cluster = new TestCluster();
afterAll(() => {
  cluster.cleanup();
  rmSync(root, { recursive: true, force: true });
});
const clock = { ms: Date.now() };
const PASSWORD = "kiwi-7731";
const ADA: By = { name: "ada", id: "S-ADA" };
const mara: PersonDoc = { name: "Mara", look: { seed: 7, population: "core:people_city", revision: 1, locks: {} }, outfit: null, wardrobe: null, notes: "" };

function call(s: Server, path: string, body: unknown): Promise<Response> {
  const host = s.h.host;
  const gate: AdminGate = { dev: false, password: host.adminPassword, guesses: new Guesses(), tick: () => 0, world: s.world };
  const req = new Request(`http://snark.test${path}`, {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", authorization: `Basic ${btoa(`kody:${PASSWORD}`)}` },
  });
  return Promise.resolve(refused(req, "1.2.3.4", gate) ?? peopleAdmin(req, path, host.people, () => host.world.reg, host.acts, host)!);
}

test("an admin population may not wear what a content population may not", async () => {
  const a = cluster.server("Island", "review1", clock, { host: { adminPassword: PASSWORD } });
  try {
    const reg = a.h.host.world.reg;
    const wearsStone = { ...BEACH, id: "core:people_review", outfits: [{ wear: ["core:stone"], weight: 1 }] };
    // The content refuses a population dressed in a stone: its outfits wear armour.
    expect(refFaults([...(reg.defs.filter(Boolean) as Def[]), wearsStone as unknown as Def]).filter((f) => f.includes("people_review"))).toHaveLength(1);
    const { type: _t, id: _i, revision: _r, ...doc } = wearsStone;
    const res = await call(a, "/admin/people/save", { kind: "population", id: null, rev: 0, doc: { ...doc, label: "Stone wearers" } });
    expect(res.status).toBe(400);
  } finally {
    a.h.host.shutdown();
  }
});

test("a wardrobe page's publish is not refused because a person was saved meanwhile", () => {
  const dir = join(root, "publish");
  const store = new PeopleStore({ db: join(dir, "people.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp") });
  try {
    // The wardrobe page shows the store at this revision; no edition changes after it.
    const shown = store.view().revision;
    expect(store.save("person", null, 0, mara, ADA)).toMatchObject({ id: 1 });
    expect(store.view().editions).toEqual([]);
    expect(store.publish(shown, { garment: "core:plain_tee", colours: [0, 0, 0], print: null, name: "Tee" }, ADA)).toMatchObject({ id: 1 });
  } finally {
    store.close();
  }
});
