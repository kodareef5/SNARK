// Staff give a published garment edition to a survivor (server/people/give.ts): from the Wardrobe page's give route or
// the console's `dress`, worn where its slot is empty and in the bag where it is not, dyed as asked, and in the admin log.
import { afterAll, expect, test } from "bun:test";
import { peopleAdmin } from "../../server/admin/people-routes.ts";
import { refused, type AdminGate } from "../../server/admin/gate.ts";
import { OPERATOR } from "../../server/acts.ts";
import { Guesses } from "../../server/guesses.ts";
import { dressFromPage } from "../../server/people/give.ts";
import { TestCluster, keyAt, rec, type Server } from "../fixtures/cluster.ts";

const cluster = new TestCluster();
afterAll(() => cluster.cleanup());
const clock = { ms: Date.now() };
const PASSWORD = "kiwi-7731";

function call(s: Server, path: string, body?: unknown): Promise<Response> {
  const host = s.h.host;
  const gate: AdminGate = { dev: false, password: host.adminPassword, guesses: new Guesses(), tick: () => 0, world: s.world };
  const init: RequestInit = body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } };
  const req = new Request(`http://snark.test${path}`, { ...init, headers: { authorization: `Basic ${btoa(`kody:${PASSWORD}`)}`, ...(init.headers as Record<string, string>) } } as RequestInit);
  return Promise.resolve(refused(req, "1.2.3.4", gate) ?? peopleAdmin(req, path, host.people, () => host.world.reg, host.acts, host, (e, who, dye, by) => dressFromPage(host, e, who, dye, by))!);
}

test("the Wardrobe page dresses a survivor in an edition, then gives one to the bag", async () => {
  const s = cluster.server("Island", "give1", clock, { host: { adminPassword: PASSWORD } });
  try {
    const host = s.h.host, reg = host.world.reg, tee = reg.index.get("core:tee")!;
    const made = await call(s, "/admin/people/publish", { revision: 0, garment: "core:tee", colours: [10, 0, 0], name: "Truth tee" });
    expect(made.status).toBe(200);
    s.h.join("ada", {}, { key: keyAt("ada", s.world) });
    s.h.run(300);
    const me = rec(s, "ada")!, inv = host.items.inv(me);

    const first = await call(s, "/admin/people/give", { edition: 1, survivor: "ada", dye: [12, 40, 200] });
    const said = (await first.json()) as { said: string; line: string; survivor: string };
    expect([first.status, said.survivor, said.line]).toEqual([200, "ada", `dress 1 #${me.pid} -dye=12,40,200`]);
    expect(said.said).toBe(`dressed ada in edition 1 "Truth tee" of core:tee dyed 12,40,200`);
    const top = inv.wardrobe;
    expect([inv.item[top], inv.editionOf(top), inv.dyeOf(top)]).toEqual([tee, 1, 12 | (40 << 8) | (200 << 16)]);

    // Its slot taken, the next goes in the bag, in its edition.
    const second = (await (await call(s, "/admin/people/give", { edition: 1, survivor: `#${me.pid}` })).json()) as { said: string };
    expect(second.said).toBe(`gave ada edition 1 "Truth tee" of core:tee, in the bag`);
    const bag = [...inv.item.subarray(0, inv.bag)].indexOf(tee);
    expect([bag >= 0, inv.editionOf(bag), inv.dyeOf(bag)]).toEqual([true, 1, 0]);

    const lines = host.acts.recent(0, 1e9).filter((a) => a.what.startsWith("dress")).map((a) => [a.name, a.what]);
    expect(lines).toEqual([["(kody)", `dress 1 #${me.pid} -dye=12,40,200`], ["(kody)", `dress 1 #${me.pid}`]]);
  } finally {
    s.h.host.shutdown();
  }
});

test("a give names a published edition and a survivor who is here", async () => {
  const s = cluster.server("Island", "give2", clock, { host: { adminPassword: PASSWORD } });
  try {
    await call(s, "/admin/people/publish", { revision: 0, garment: "core:tee", colours: [0, 0, 0], name: "Plain" });
    s.h.join("ada", {}, { key: keyAt("ada", s.world) });
    s.h.run(300);
    const status = async (body: unknown): Promise<number> => (await call(s, "/admin/people/give", body)).status;
    expect(await status({ edition: 9, survivor: "ada" })).toBe(404);
    expect(await status({ edition: 1, survivor: "nobody" })).toBe(404);
    expect(await status({ edition: 1, survivor: "#99999999" })).toBe(404);
    expect(await status({ edition: 1, survivor: "ada", dye: [1, 2] })).toBe(400);
    expect(await status({ edition: "1", survivor: "ada" })).toBe(400);
    expect(s.h.host.items.inv(rec(s, "ada")!).item.some((i) => i === s.h.host.world.reg.index.get("core:tee"))).toBe(false);
  } finally {
    s.h.host.shutdown();
  }
});

test("the console's dress gives an edition by name, and says why it cannot", () => {
  const s = cluster.server("Island", "give3", clock, { host: { adminPassword: PASSWORD } });
  try {
    const host = s.h.host;
    host.people.publish(0, { garment: "core:tee", colours: [0, 0, 0], name: "Plain", print: null }, { name: "kody", id: "" });
    s.h.join("ada", {}, { key: keyAt("ada", s.world) });
    s.h.run(300);
    const run = (line: string): string => host.console.exec({ host, client: null, actor: OPERATOR }, line);
    expect(run("dress 1 Ada")).toBe(`dressed ada in edition 1 "Plain" of core:tee`);
    expect(run("dress 1")).toStartWith("name a survivor");
    expect(run("dress 7 ada")).toBe("no edition 7 is published");
    expect(run("dress 1 ada -dye=300,0,0")).toBe("each dye colour is a palette number, 0 to 255");
  } finally {
    s.h.host.shutdown();
  }
});
