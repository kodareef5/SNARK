// The Admin log page (client/admin/acts.ts): its parts that need no browser (client/core/admin/acts.ts), its place in a
// world's navigation and build, and the gate in front of it.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_FILTER, TYPED, actRow, actsHtml, countText, mergeActs, moreAfter, nextAfter, shownActs } from "../../client/core/admin/acts.ts";
import { resolveAdmin, sections } from "../../client/core/admin/navigation.ts";
import { adminSite } from "../../server/admin/site.ts";
import { Guesses } from "../../server/guesses.ts";
import type { Act } from "../../shared/acts.ts";
import { ACTS_PAGE } from "../../shared/admin-acts.ts";
import { idOf } from "../../shared/ids.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_STAFF } from "../../shared/ranks.ts";
import { buildAdmin } from "../../tools/build-admin.ts";

const root = mkdtempSync(join(tmpdir(), "snark-acts-page-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const MARA = idOf(1, 1);
const act = (seq: number, o: Partial<Act> = {}): Act => ({
  seq, at: 0, tick: seq * 30, name: "Mara", id: MARA, pid: 1, rank: RANK_ADMIN, via: "session", from: "", kind: "command", what: `cmd ${seq}`, open: false, ...o,
});

/** Mara at admin, a map password typed as (kody), the cluster at the terminal, and Pip's staff sign-in. */
const log: Act[] = [
  act(1, { what: "give wood 10" }),
  act(2, { name: "(kody)", id: "", pid: 0, rank: RANK_MAP, via: "page", what: "settings MaxPlayers 40", from: "10.0.0.5" }),
  act(3, { name: "(operator)", id: "", pid: 0, rank: RANK_CLUSTER, via: "operator", what: "broadcast Restart soon" }),
  act(4, { name: "Pip", id: idOf(1, 2), rank: RANK_STAFF, kind: "sign-in", what: "signed in" }),
  act(5, { name: "(kody)", id: "", pid: 0, rank: RANK_MAP, via: "page", kind: "change", what: "group Admins rank admin" }),
];

test("answers merge in order with no doubles, a later copy kept", () => {
  const held = mergeActs([], log.slice(0, 3));
  const merged = mergeActs(held, [log[4]!, { ...log[2]!, what: "again" }, log[3]!]);
  expect(merged.map((a) => a.seq)).toEqual([1, 2, 3, 4, 5]);
  expect(merged[2]!.what).toBe("again");
  expect(mergeActs(merged, []).map((a) => a.seq)).toEqual([1, 2, 3, 4, 5]);
});

test("the next question asks after the highest act held", () => {
  expect(nextAfter([])).toBe(0);
  expect(nextAfter(mergeActs([], [log[3]!, log[0]!]))).toBe(4);
  expect([moreAfter(ACTS_PAGE), moreAfter(ACTS_PAGE - 1), moreAfter(0)]).toEqual([true, false, false]);
});

test("the table lists the newest first", () => {
  expect(shownActs(log, NO_FILTER).map((a) => a.seq)).toEqual([5, 4, 3, 2, 1]);
});

test("filters by who, lowest rank, words and kind", () => {
  const seqs = (f: Partial<typeof NO_FILTER>) => shownActs(log, { ...NO_FILTER, ...f }).map((a) => a.seq);
  expect(seqs({ who: "KOD" })).toEqual([5, 2]);
  expect(seqs({ who: idOf(1, 2).slice(-5) })).toEqual([4]);
  expect(seqs({ who: MARA })).toEqual([1]);
  expect(seqs({ rank: RANK_MAP })).toEqual([5, 3, 2]);
  expect(seqs({ rank: RANK_CLUSTER })).toEqual([3]);
  expect(seqs({ words: "MaxPlayers 40" })).toEqual([2]);
  expect(seqs({ words: "restart broadcast" })).toEqual([3]);
  expect(seqs({ kind: "sign-in" })).toEqual([4]);
  expect(seqs({ kind: "change", who: "kody" })).toEqual([5]);
  expect(seqs({ kind: "command", rank: RANK_ADMIN })).toEqual([3, 2, 1]);
});

test("a row names the rank, how it came in, the ID, and marks a typed name", () => {
  const at = new Date(2026, 10, 25, 9, 4, 5).getTime();
  const typed = actRow({ ...log[1]!, at });
  expect(typed).toMatchObject({ when: "2026-11-25 09:04:05", name: "(kody)", nameTitle: TYPED, id: "", rank: "map", how: "On a page", from: "10.0.0.5" });
  expect(actRow(log[0]!)).toMatchObject({ when: "tick 30", name: "Mara", nameTitle: "", id: MARA, rank: "admin", how: "In game", kind: "" });
  expect(actRow(log[2]!)).toMatchObject({ rank: "cluster", how: "At the terminal" });
  expect(actRow(log[3]!)).toMatchObject({ rank: "staff", kind: "sign-in" });
  expect(actRow(act(9, { rank: -1, name: "" }))).toMatchObject({ rank: "not known", name: "Not known" });
});

test("the rows escape what the server gave", () => {
  const html = actsHtml([act(1, { name: '<b>"Pip"</b>', what: "say <script>", from: "<x>" })]);
  expect(html).not.toContain("<b>");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&#60;b&#62;&#34;Pip&#34;&#60;/b&#62;");
  expect(actsHtml([log[1]!])).toContain(`title="${TYPED}"`);
  expect(actsHtml([log[0]!])).toContain(MARA);
});

test("the count says how many of how many it shows", () => {
  expect([countText(0, 0), countText(5, 5), countText(2, 5), countText(1, 1)]).toEqual(["No acts yet", "5 acts", "2 of 5 acts", "1 act"]);
});

test("a world's navigation lists Admin log, which opens at its own address", () => {
  const investigate = sections.find(([label]) => label === "Investigate")![1].map(([slug]) => slug);
  expect(investigate).toContain("acts");
  const worlds = [{ id: 3, name: "Miami", map: "Miami", mapId: "core:miami", address: "/miami/", players: 0, max: 10 }];
  const at = resolveAdmin("https://snark.test/admin/worlds/3/acts/", worlds, (href, base) => new URL(href, base));
  expect([at.view, at.title, at.worldUrl("acts")]).toEqual(["acts", "Admin log", "/admin/worlds/3/acts/"]);
  expect(at.api("acts.json?after=12")).toBe("https://snark.test/miami/admin/acts.json?after=12");
});

test("the page and its script are built, and served only past the gate", async () => {
  const dist = join(root, "dist");
  await buildAdmin(dist);
  const site = {
    dir: dist, base: "", port: 0, id: "local" as const, who: "test", destinations: () => [], scenes: () => new Response(null),
    gate: { dev: false, password: "hunter2", guesses: new Guesses(), tick: () => 0 },
  };
  const get = async (path: string, password?: string): Promise<Response> => {
    const headers: Record<string, string> = password ? { authorization: `Basic ${btoa(`admin:${password}`)}` } : {};
    return (await adminSite(new Request(`http://snark.test${path}`, { headers }), new URL(`http://snark.test${path}`), site))!;
  };
  expect([(await get("/admin/worlds/local/acts/")).status, (await get("/admin/worlds/local/acts/", "wrong")).status]).toEqual([401, 401]);
  const page = await get("/admin/worlds/local/acts/", "hunter2");
  expect([page.status, (await page.text()).includes('src="/admin/ui/acts.js"')]).toEqual([200, true]);
  expect((await get("/admin/worlds/local/acts", "hunter2")).headers.get("location")).toBe("/admin/worlds/local/acts/");
  const script = await get("/admin/ui/acts.js");
  expect([script.status, (await script.text()).length > 500]).toEqual([200, true]);
});
