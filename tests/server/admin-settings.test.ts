// The admin's settings page, its server side (server/admin/settings.ts): it lists every setting that takes effect,
// changes one that may change while the server runs, keeps the change beside the save and gives it back.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SettingRow, SettingsPage } from "../../shared/admin.ts";
import { settingsAnswer } from "../../server/admin/settings.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { AT_START, CATALOG, catalogFaults, rowOf } from "../../server/settings/catalog.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { Rules } from "../../server/settings/rules.ts";
import { boxLines, boxValue, countText, isSwitch, matches, rangeText, sentValue, settingsHtml, sourceText } from "../../client/core/admin/settings.ts";
import { Harness } from "../fixtures/net.ts";
import { adminLines } from "../fixtures/acts.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-admin-settings-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const AT = "http://localhost";

function page(h: Harness) {
  const get = async (): Promise<SettingsPage> => (await (await settingsAnswer(h.host, new Request(`${AT}/admin/settings.json`), "/admin/settings.json")!).json()) as SettingsPage;
  const send = async (body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; page: SettingsPage }> => {
    const r = await settingsAnswer(h.host, new Request(`${AT}/admin/settings`, { method: "POST", headers: { "content-type": "application/json", origin: AT, host: "localhost", ...headers }, body: JSON.stringify(body) }), "/admin/settings")!;
    return { status: r.status, page: (r.status === 200 || r.status === 400 ? await r.json() : { ok: false, why: "", note: "", keeps: false, rows: [] }) as SettingsPage };
  };
  return { get, send };
}

const row = (p: SettingsPage, name: string): SettingRow => p.rows.find((r) => r.name === name)!;

test("the page lists every setting that takes effect, says which may change now, and never a password's value", async () => {
  const { rules } = loadConfig({ gus: "[ServerSettings]\nServerPassword=opensesame\nServerAdminPassword=hunter2\nXPMultiplier=2\n" });
  const h = new Harness({}, 1, 60, { dev: true, config: rules });
  const p = await page(h).get();
  expect(p.rows.map((r) => r.name).sort()).toEqual(CATALOG.filter((r) => r.status === "live").map((r) => (r.kind === "flag" ? "-" : "") + r.name).sort());
  expect(row(p, "XPMultiplier")).toMatchObject({ value: "2", def: "1", source: "file", fixed: "", kept: false, kind: "float" });
  // The few that stay read at a start say why, each of them.
  expect(row(p, "Port").fixed).toBe("Set at start. It is the address survivors and the cluster hold for this server.");
  const fixed = p.rows.filter((r) => r.fixed !== "");
  expect(fixed.map((r) => r.name).sort()).toEqual(Object.keys(AT_START).sort());
  for (const r of fixed) expect([r.name, r.fixed.length > "Set at start. ".length]).toEqual([r.name, true]);
  expect(row(p, "ServerPassword")).toMatchObject({ value: "", def: "", has: true, secret: true });
  expect(catalogFaults()).toEqual([]);
  expect(JSON.stringify(p)).not.toMatch(/opensesame|hunter2/);
  expect([p.ok, p.keeps]).toEqual([true, false]);
  h.host.shutdown();
});

test("a change from the page is in force at once, is refused with its reason, and takes a list and an indexed setting", async () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const { send } = page(h);
  const set = await send({ op: "set", name: "XPMultiplier", value: "3" });
  expect([set.status, set.page.ok, h.host.rules.num("XPMultiplier")]).toEqual([200, true, 3]);
  expect(row(set.page, "XPMultiplier")).toMatchObject({ value: "3", source: "admin page", kept: true });

  for (const [body, why] of [
    [{ op: "set", name: "XPMultiplier", value: "lots" }, /XPMultiplier wants a number, got "lots"/],
    [{ op: "set", name: "Port", value: "9000" }, /Port is read when the server starts/],
    [{ op: "set", name: "Gravity", value: "2" }, /there is no setting called Gravity/],
    [{ op: "set", name: "XPMultiplier" }, /A value is words/],
    [{ op: "reset", name: "TamingSpeedMultiplier" }, /was not set on the page/],
    [{ op: "wipe", name: "XPMultiplier" }, /A change is/],
  ] as const) {
    const no = await send(body);
    expect([no.status, no.page.ok]).toEqual([400, false]);
    expect(no.page.why).toMatch(why);
  }
  expect(h.host.rules.num("XPMultiplier")).toBe(3);

  // A list is its entries one a line, as its file has them with the key or without, and an empty box is an empty list.
  const list = "HarvestResourceItemAmountClassMultipliers";
  const two = await send({ op: "set", name: list, value: `(ClassName="core:wood",Multiplier=2)\n${list}=(ClassName="core:stone",Multiplier=3)\n` });
  expect([two.page.ok, h.host.rules.list(list).length]).toEqual([true, 2]);
  expect(row(two.page, list).value).toBe('(ClassName="core:wood",Multiplier=2)\n(ClassName="core:stone",Multiplier=3)');
  expect((await send({ op: "set", name: list, value: "(ClassName=" })).page.why).toMatch(/line 1/);
  expect(h.host.rules.list(list).length).toBe(2);
  expect([(await send({ op: "set", name: list, value: "" })).page.ok, h.host.rules.list(list).length]).toEqual([true, 0]);

  // A change is only taken as JSON from this server's own page.
  expect((await send({ op: "set", name: "XPMultiplier", value: "9" }, { origin: "http://elsewhere" })).status).toBe(403);
  expect((await send({ op: "set", name: "XPMultiplier", value: "9" }, { "content-type": "text/plain" })).status).toBe(400);
  expect((await settingsAnswer(h.host, new Request(`${AT}/admin/settings`), "/admin/settings")!).status).toBe(405);
  expect(h.host.rules.num("XPMultiplier")).toBe(3);

  // Taking the page's value away gives the setting what it had before.
  const back = await send({ op: "reset", name: "XPMultiplier" });
  expect([back.page.ok, h.host.rules.num("XPMultiplier")]).toEqual([true, 1]);
  expect(row(back.page, "XPMultiplier")).toMatchObject({ value: "1", source: "default", kept: false });
  h.host.shutdown();
});

test("an indexed setting is its numbers with commas between", () => {
  const rules = new Rules();
  const stats = rowOf("PerLevelStatsMultiplier_Player")!;
  const n = (stats.def as readonly number[]).length;
  const words = Array.from({ length: n }, (_, i) => (i === 0 ? 2 : 1)).join(",");
  expect([rules.set(stats, words, "admin page"), rules.indexed(stats.name)[0]]).toEqual(["", 2]);
  expect(rules.set(stats, "1,2", "admin page")).toMatch(new RegExp(`wants ${n} numbers`));
  expect(rules.set(stats, words.replace("2", "x"), "admin page")).toMatch(/wants a number/);
  expect(rules.indexed(stats.name)[0]).toBe(2);
});

test("what the page set is kept beside the save, is in force at the next start over the files, and is in the admin journal", async () => {
  const dbPath = join(dir, "kept.db");
  const kept = `${dbPath}.settings.json`;
  const files = { gus: "[ServerSettings]\nXPMultiplier=2\nTamingSpeedMultiplier=4\n" };
  let h = new Harness({}, 1, 60, { dev: true, dbPath, config: loadConfig(files).rules });
  const first = page(h);
  expect((await first.get()).keeps).toBe(true);
  await first.send({ op: "set", name: "XPMultiplier", value: "5" });
  await first.send({ op: "set", name: "TamingSpeedMultiplier", value: "8" });
  await first.send({ op: "reset", name: "TamingSpeedMultiplier" });
  expect([h.host.rules.num("XPMultiplier"), h.host.rules.num("TamingSpeedMultiplier")]).toEqual([5, 4]);
  expect(JSON.parse(readFileSync(kept, "utf8"))).toEqual({ settings: { XPMultiplier: "5" } });
  h.run(60);
  h.host.shutdown();
  const store = new WorldStore(dbPath, h.reg);
  const typed = adminLines(store);
  store.close();
  expect(typed).toEqual(["(admin page)\tsetting XPMultiplier 5", "(admin page)\tsetting TamingSpeedMultiplier 8", "(admin page)\tsetting TamingSpeedMultiplier (as before the page set it)"]);

  // The files say 2 at the next start, and the page's 5 stands over it until it is taken away.
  const said: string[] = [];
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: loadConfig(files).rules, log: (line) => said.push(line) });
  expect(h.host.rules.num("XPMultiplier")).toBe(5);
  expect(said).toContain("  applied   XPMultiplier=5  (admin page)");
  const again = page(h);
  expect(row(await again.get(), "XPMultiplier")).toMatchObject({ value: "5", source: "admin page", kept: true });
  const back = await again.send({ op: "reset", name: "XPMultiplier" });
  expect([h.host.rules.num("XPMultiplier"), row(back.page, "XPMultiplier").source]).toEqual([2, "file"]);
  expect(JSON.parse(readFileSync(kept, "utf8"))).toEqual({ settings: {} });
  h.host.shutdown();

  // A file that names what is no setting, or gives one a value it cannot have, is reported and the server starts.
  writeFileSync(kept, JSON.stringify({ settings: { Gravity: "2", XPMultiplier: "lots", HarvestAmountMultiplier: "3" } }));
  const told: string[] = [];
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: loadConfig(files).rules, log: (line) => told.push(line) });
  expect([h.host.rules.num("XPMultiplier"), h.host.rules.num("HarvestAmountMultiplier")]).toEqual([2, 3]);
  expect(told.filter((line) => line.includes("(admin page)"))).toEqual(["  refused   Gravity  (admin page): is no setting", '  refused   XPMultiplier  (admin page): wants a number, got "lots"', "  applied   HarvestAmountMultiplier=3  (admin page)"]);
  h.host.shutdown();
  expect(existsSync(kept)).toBe(true);
});

test("the page's rows: a box of its kind for each, found by a search's words, and a password never written out", async () => {
  const { rules } = loadConfig({ gus: "[ServerSettings]\nServerPassword=opensesame\nXPMultiplier=2\n" });
  const h = new Harness({}, 1, 60, { dev: true, config: rules });
  const { get, send } = page(h);
  await send({ op: "set", name: "TamingSpeedMultiplier", value: "3" });
  const p = await get();
  const [xp, tame, pve, port, pass, list, flag] = ["XPMultiplier", "TamingSpeedMultiplier", "serverPVE", "Port", "ServerPassword", "HarvestResourceItemAmountClassMultipliers", "-NoDinos"].map((name) => row(p, name));
  const html = settingsHtml(p.rows);
  // One box a row, of the kind its value is: a number in its range, a switch, lines, a password, and a start-only one shut.
  for (const r of p.rows) expect(html.split(`id="v-${r.name}"`).length).toBe(2);
  expect(html).toContain('<input id="v-XPMultiplier" type="number" min="0" max="100000" step="any" aria-label="XPMultiplier">');
  expect(html).toContain('<input id="v-serverPVE" type="checkbox" aria-label="serverPVE">');
  expect(html).toContain('<textarea id="v-HarvestResourceItemAmountClassMultipliers" rows="2" spellcheck="false"');
  expect(html).toContain('<input id="v-ServerPassword" type="password" autocomplete="new-password" aria-label="ServerPassword">');
  expect(html).toContain('<input id="v-ServerAdminPassword" type="password" autocomplete="new-password" aria-label="ServerAdminPassword" disabled>');
  expect(html).toMatch(/<input id="v-Port" type="number" min="1" max="65535" step="1" aria-label="Port" disabled>/);
  expect(html).not.toContain("opensesame");
  expect(html.split('<section class="glass group">').length - 1).toBe(new Set(p.rows.map((r) => r.group)).size);
  expect([isSwitch(pve!), isSwitch(flag!), isSwitch(xp!), isSwitch(list!)]).toEqual([true, true, false, false]);
  expect([boxValue(xp!), boxValue(pve!), boxValue(pass!), sentValue(pve!, true), sentValue(pve!, false), sentValue(xp!, "4")]).toEqual(["2", false, "", "True", "False", "4"]);
  expect([sourceText(xp!), sourceText(tame!), sourceText(pass!), rangeText(xp!), rangeText(pve!)]).toEqual(["file", "admin page", "set · file", "0 to 100000", ""]);
  expect([boxLines(""), boxLines("a"), boxLines("a\nb"), boxLines(Array(20).fill("a").join("\n"))]).toEqual([1, 2, 3, 8]);
  // A search's words are each found in the name, the meaning or the heading; the choice narrows it.
  expect([matches(xp!, "", "all"), matches(xp!, "xp MULT", "all"), matches(xp!, "taming", "all"), matches(port!, "", "live"), matches(xp!, "", "live")]).toEqual([true, true, false, false, true]);
  expect([matches(xp!, "", "kept"), matches(tame!, "", "kept"), matches(xp!, "", "changed"), matches(pve!, "", "changed"), matches(pass!, "", "changed")]).toEqual([false, true, true, false, true]);
  expect([countText(187, 187), countText(3, 187)]).toEqual(["187 settings", "3 of 187 settings"]);
  h.host.shutdown();
});
