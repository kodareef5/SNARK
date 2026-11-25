// A world's Permissions admin page (client/admin/permissions.ts): its parts that need no browser (client/core/admin/permissions.ts),
// its place in a world's navigation and build, the gate in front of it, and the front that passes what it sends.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FREE_CHEATS, addGroupPost, addMemberPost, blankChatForm, blankTag, chatBlockOf, chatFormOf, chatGroupHtml, chatPost, clearPasswordPost, coloured, defineWhy, editAfter, editOf,
  everyMapOf, firstInk, freeCheats, grantPost, groupsHtml, headingOf, historyHtml, importHtml, importPost, manageWhy, memberRows, rankPost,
  memberRowsHtml, readFault, passwordRows, passwordRowsHtml, removeGroupPost, sampleRuns, settingsFormOf, settingsHtml, settingsPost, settingsTextOf, spanWords, type MemberForm,
} from "../../client/core/admin/permissions.ts";
import { cluster, resolveAdmin, sections } from "../../client/core/admin/navigation.ts";
import { adminSite } from "../../server/admin/site.ts";
import { START_BOOK } from "../../server/permissions/chat-tags.ts";
import { frontPasses, sitePost } from "../../server/front.ts";
import { Guesses } from "../../server/guesses.ts";
import { idOf } from "../../shared/ids.ts";
import { readChatSettings } from "../../shared/permissions/chat.ts";
import { CHANGED_MEANWHILE, type HistoryRow, type Member } from "../../shared/permissions/model.ts";
import { OLD_PERMISSIONS_PATHS, PERMISSIONS_API, PERMISSIONS_STATE, type PermissionsState } from "../../shared/permissions/page.ts";
import { readRichColor } from "../../shared/permissions/richcolor.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_STAFF } from "../../shared/ranks.ts";
import { buildAdmin } from "../../tools/build-admin.ts";

const root = mkdtempSync(join(tmpdir(), "snark-permissions-page-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const HOUR = 3600_000;
const NOW = 1_800_000_000_000;
const MARA = idOf(1, 1), KADE = idOf(1, 2), PIP = idOf(1, 3);
const always = { forever: true, from: 0, until: 0 };
const GOLD = 0xffd700;

/** Miami, where Mara is a map admin and Kade an admin; Pip has a timed VIP membership, and a tribe builds. World 0 is in no cluster. */
function stateAt(rank: number, world = 1): PermissionsState {
  return {
    key: "k1",
    me: { name: "Kade", id: KADE, rank, world },
    saved: true,
    revision: 7,
    groups: [
      { name: "Default", rank: 0, permissions: [], chat: "" },
      { name: "Admins", rank: RANK_ADMIN, permissions: ["*"], chat: "" },
      { name: "MapAdmins", rank: RANK_MAP, permissions: ["*"], chat: "" },
      { name: "VIP", rank: 0, permissions: ["ArkShop.Kits.vip", "Cheat.fly"], chat: "" },
      { name: "Builders", rank: 0, permissions: ["Build.extra"], chat: "" },
    ],
    members: [
      { kind: "survivor", key: MARA, group: "MapAdmins", world: 1, ...always, name: "Mara" },
      { kind: "survivor", key: MARA, group: "VIP", world: 0, ...always, name: "Mara" },
      { kind: "survivor", key: KADE, group: "Admins", world: 1, ...always, name: "Kade" },
      { kind: "survivor", key: PIP, group: "VIP", world: 0, forever: false, from: NOW - HOUR, until: NOW + 3 * HOUR + 12 * 60_000, name: "<b>Pip</b>" },
      { kind: "tribe", key: "42", group: "Builders", world: 0, ...always, name: "River Folk" },
    ],
    passwords: [{ id: MARA, at: NOW - 2 * HOUR }],
    document: JSON.stringify({
      ChatTags: { StackChatTags: true, VIP: { Priority: 1, Icon: "", Text: '<RichColor Color="1, 0.843, 0, 1">[VIP]</>', CanBeDisabled: true } },
      MutedPermissionGroup: "Muted",
      MapColors: { Miami: [0, 128, 255] },
    }),
    survivors: [
      { id: PIP, name: "<b>Pip</b>", online: true },
      { id: MARA, name: "Mara", online: false },
      { id: idOf(1, 5), name: "Twin", online: true },
      { id: idOf(1, 6), name: "twin", online: false },
    ],
    tribes: [{ team: 42, name: "River Folk" }],
    register: [MARA, KADE, PIP, idOf(1, 5), idOf(1, 6)].map((id, i) => ({ id, name: ["Mara", "Kade", "<b>Pip</b>", "Twin", "twin"][i]!, world: 1 })),
    commands: ["kick", "fly", "give"],
    worlds: [{ id: 1, name: "Miami" }, { id: 2, name: "Tampa" }],
  };
}

const rowOf = (state: PermissionsState, key: string, group: string) => memberRows(state, NOW).find((r) => r.member.key === key && r.group === group)!;
/** The controls of some HTML that are not disabled, leaving out the buttons that only undo a draft. */
const enabled = (html: string): string[] => [...html.matchAll(/<(?:button|input|select)\b[^>]*>/g)].map((m) => m[0]).filter((c) => !/ disabled/.test(c) && !/-undo"/.test(c));

test("a regular admin's controls on a map admin's membership are off, with the reason", () => {
  const admin = stateAt(RANK_ADMIN);
  expect(rowOf(admin, MARA, "MapAdmins").removeWhy).toBe("That needs the map rank.");
  // Rule 5: an open group's membership is out of reach too, for what else the survivor holds.
  expect(rowOf(admin, MARA, "VIP").removeWhy).toBe("That survivor holds a higher rank than yours.");
  expect(rowOf(admin, PIP, "VIP").removeWhy).toBe("");
  const mara = passwordRows(admin).find((r) => r.id === MARA)!;
  expect([mara.has, mara.at, mara.clearWhy]).toEqual([true, NOW - 2 * HOUR, "That survivor holds a higher rank than yours."]);
  expect(passwordRowsHtml([mara])).toContain('data-act="clear-password" data-id="' + MARA + '" disabled title="That survivor holds a higher rank than yours."');
  expect(groupsHtml(stateAt(RANK_ADMIN, 0))).toContain('data-act="remove-group" data-group="MapAdmins" disabled title="That needs the map rank."');
  // The map's admin reaches both.
  const map = stateAt(RANK_MAP);
  expect([rowOf(map, MARA, "MapAdmins").removeWhy, rowOf(map, MARA, "VIP").removeWhy]).toEqual(["", ""]);
});

/** The control in some HTML whose tag holds `marker`. */
const control = (html: string, marker: string): string => [...html.matchAll(/<(?:button|input|select)\b[^>]*>/g)].map((m) => m[0]).find((c) => c.includes(marker)) ?? "";
const CLUSTER_ONLY = "In a cluster, only the cluster's admins change groups and chat settings.";

test("a map admin in a cluster finds a group's permissions and rank off, with the reason", () => {
  const map = stateAt(RANK_MAP);
  const groups = groupsHtml(map);
  const markers = ['data-act="rank" data-group="VIP"', 'data-grant="VIP"', 'data-act="grant" data-group="VIP"', 'data-perm="Cheat.fly"', 'data-act="remove-group" data-group="VIP"'];
  expect(markers.map((m) => control(groups, m).includes(` disabled title="${CLUSTER_ONLY}"`))).toEqual(markers.map(() => true));
  const vip = map.groups.find((g) => g.name === "VIP")!;
  expect(enabled(chatGroupHtml(map, vip, blankChatForm(), []) + settingsHtml(map, settingsFormOf(map.document).form, []))).toEqual([]);
  expect([chatPost(map, "VIP", "{}", "").why, settingsPost(map, "{}", "").why, defineWhy(map), manageWhy(map)]).toEqual([CLUSTER_ONLY, CLUSTER_ONLY, CLUSTER_ONLY, ""]);
  // An import may be checked, not applied.
  expect([importPost(map, "commands", "Permissions.AddGroup VIP", false).why, importPost(map, "commands", "Permissions.AddGroup VIP", true).why]).toEqual(["", CLUSTER_ONLY]);
  // Who is in which group is still theirs.
  expect([rowOf(map, PIP, "VIP").removeWhy, addMemberPost(map, { kind: "survivor", who: PIP, group: "Builders", hours: "", delay: "", everyMap: false }).why]).toEqual(["", ""]);
  // The cluster's admin has the same controls on.
  const top = stateAt(RANK_CLUSTER);
  expect(markers.slice(1).map((m) => control(groupsHtml(top), m).includes(" disabled"))).toEqual(markers.slice(1).map(() => false));
});

test("the page offers a group's rank only while the group is empty", () => {
  const top = { ...stateAt(RANK_CLUSTER), groups: [...stateAt(RANK_CLUSTER).groups, { name: "Helpers", rank: 0, permissions: [], chat: "" }] };
  const html = groupsHtml(top);
  expect(control(html, 'data-act="rank" data-group="VIP"')).toContain(' disabled title="A group\'s rank changes only while it has no members. Take them out first."');
  expect(control(html, 'data-act="rank" data-group="Admins"')).toContain(" disabled");
  expect(control(html, 'data-act="rank" data-group="Helpers"')).not.toContain(" disabled");
});

test("a viewer below admin rank can change nothing", () => {
  const staff = stateAt(RANK_STAFF);
  const why = "Permissions are managed from an admin's rank.";
  expect(manageWhy(staff)).toBe(why);
  expect(memberRows(staff, NOW).map((r) => r.removeWhy)).toEqual(memberRows(staff, NOW).map(() => why));
  const html = groupsHtml(staff) + memberRowsHtml(memberRows(staff, NOW)) + passwordRowsHtml(passwordRows(staff)) + settingsHtml(staff, settingsFormOf(staff.document).form, []);
  expect(enabled(html)).toEqual([]);
  expect(addMemberPost(staff, { kind: "survivor", who: PIP, group: "VIP", hours: "", delay: "", everyMap: false }).why).toBe(why);
  expect([importPost(staff, "commands", "Permissions.AddGroup VIP", false).why, clearPasswordPost(staff, MARA).why]).toEqual([why, why]);
});

test("a row says how long a timed membership has left", () => {
  expect(rowOf(stateAt(RANK_ADMIN), PIP, "VIP").span).toBe("3 h 12 min left");
  const m = (from: number, until: number, forever = false): Member => ({ kind: "survivor", key: PIP, group: "VIP", world: 0, forever, from, until });
  expect(spanWords(m(NOW + 2 * HOUR, NOW + 5 * HOUR), NOW)).toBe("Starts in 2 h, then lasts 3 h");
  expect([spanWords(m(NOW - 5 * HOUR, NOW - HOUR), NOW), spanWords(m(NOW - 5 * HOUR, NOW - HOUR, true), NOW)]).toEqual(["Ended", "For good"]);
  expect(rowOf(stateAt(RANK_ADMIN), "42", "Builders")).toMatchObject({ who: "Tribe River Folk", where: "Every map", span: "For good" });
});

test("rows show each survivor's ID beside its name, and escape the name", () => {
  const html = memberRowsHtml(memberRows(stateAt(RANK_ADMIN), NOW));
  expect(html).toContain(`&#60;b&#62;Pip&#60;/b&#62; <code>${PIP}</code>`);
  expect(html).not.toContain("<b>Pip");
  expect(passwordRowsHtml(passwordRows(stateAt(RANK_ADMIN)))).toContain(`Mara <code>${MARA}</code>`);
});

test("the staff passwords say who has claimed one and offer only a clear", () => {
  const rows = passwordRows(stateAt(RANK_MAP));
  expect(rows.map((r) => [r.name, r.groups, r.has])).toEqual([["Kade", ["Admins"], false], ["Mara", ["MapAdmins"], true]]);
  const html = passwordRowsHtml(rows);
  const states = [...html.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((m) => m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  expect(states[0]).toContain("Not claimed yet");
  expect(states[1]).toMatch(/Claimed on \d{4}-\d\d-\d\d \d\d:\d\d/);
  expect([...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1])).toEqual(["clear-password", "clear-password"]);
  expect([control(html, KADE).includes(" disabled"), control(html, MARA).includes(" disabled")]).toEqual([true, false]);
});

test("what is typed becomes the right op, and a bad one is refused before it is sent", () => {
  const admin = stateAt(RANK_ADMIN);
  // A group and an applied import are a cluster's admins' to make, so those are typed on a world outside one.
  const alone = stateAt(RANK_ADMIN, 0);
  const add = (form: Partial<MemberForm>, state = admin) => addMemberPost(state, { kind: "survivor", who: "", group: "VIP", hours: "", delay: "", everyMap: false, ...form });
  expect(add({ who: ` ${PIP} ` }).post).toEqual({ do: "op", op: { op: "addMember", kind: "survivor", key: PIP, group: "VIP" } });
  expect(add({ who: `<b>Pip</b> (${PIP})`, hours: "24", delay: "2" }).post).toEqual({ do: "op", op: { op: "addMember", kind: "survivor", key: PIP, group: "VIP", hours: 24, delayHours: 2 } });
  // A cluster admin chooses the map: this one, or every one.
  const top = stateAt(RANK_CLUSTER);
  expect(add({ who: "mara", group: "Builders" }, top).post).toEqual({ do: "op", op: { op: "addMember", kind: "survivor", key: MARA, group: "Builders", world: 1 } });
  expect(add({ who: "Mara", group: "Builders", everyMap: true }, top).post).toMatchObject({ op: { world: 0 } });
  expect(add({ kind: "tribe", who: "River Folk" }).post).toEqual({ do: "op", op: { op: "addMember", kind: "tribe", key: "42", group: "VIP" } });
  const refused = [
    add({ who: "12345" }),
    add({ who: "Twin" }),
    add({ who: "Nobody" }),
    add({ who: PIP, hours: "lots" }),
    add({ who: PIP, hours: "-1" }),
    add({ who: PIP, delay: "2" }),
    add({ who: "Mara" }),
    add({ kind: "tribe", who: "42", group: "Admins" }),
    addGroupPost(alone, "bad name!", 0),
    addGroupPost(alone, "vip", 0),
    addGroupPost(alone, "Mods", RANK_MAP),
    removeGroupPost(alone, "Default"),
    grantPost(alone, "VIP", " "),
    grantPost(alone, "VIP", "cheat.FLY"),
  ];
  expect(refused.map((b) => [b.post, b.why])).toEqual([
    [null, "That is not a survivor's ID."],
    [null, "2 survivors are named Twin. Type the ID of the one you mean."],
    [null, "No survivor of this world is named Nobody. Type their ID instead."],
    [null, "Hours are a number."],
    [null, "Hours are more than none and at most a hundred years."],
    [null, "A delay goes with hours."],
    [null, "That survivor holds a higher rank than yours."],
    [null, "A tribe is put only in an open group."],
    [null, "A group's name is up to 32 letters, digits and _ . : -"],
    [null, "There is already a group vip."],
    [null, "That needs the map rank."],
    [null, "Default is always there."],
    [null, "Type a permission, such as Cheat.kick or *."],
    [null, "VIP holds cheat.FLY already."],
  ]);
  expect(addGroupPost(alone, " Mods ", RANK_STAFF).post).toEqual({ do: "op", op: { op: "addGroup", group: "Mods", rank: RANK_STAFF } });
  expect(grantPost(alone, "VIP", "Cheat.kick").post).toEqual({ do: "op", op: { op: "grant", group: "VIP", permission: "Cheat.kick" } });
  expect([clearPasswordPost(admin, KADE).post, importPost(alone, "arkapi", "", true).why, importPost(alone, "crosschat", "{}", true).why, importPost(alone, "crosschat", "{}", true, "d1").post]).toEqual([
    { do: "op", op: { op: "clearSecret", id: KADE } },
    "Choose the ArkApi Permissions file first.",
    "Check it first.",
    { do: "import", kind: "crosschat", text: "{}", digest: "d1" },
  ]);
  // An ArkApi database's -wal file goes beside it, and beside nothing else.
  expect([importPost(alone, "arkapi", "AAAA", false, "", "BBBB").post, importPost(alone, "commands", "x", false, "", "BBBB").why]).toEqual([
    { do: "plan", kind: "arkapi", text: "AAAA", wal: "BBBB" },
    "A -wal file goes only beside an ArkApi database.",
  ]);
});

test("a chat block round-trips through its form, and a faulty one says where", () => {
  const form = blankChatForm();
  form.format = "{map} {tags} {sender} [{tribe}]: {message}";
  form.priority = "3";
  form.parts.sender = coloured("{name}", 0x33cc66);
  expect(firstInk(form.parts.sender)).toBe(0x33cc66);
  const block = chatBlockOf(form);
  expect(block.faults).toEqual([]);
  expect(JSON.parse(block.text)).toEqual({ ChatFormat: form.format, Priority: 3, Icon: "", FormattingParts: form.parts });
  expect(chatFormOf(block.text)).toEqual({ form, faults: [] });
  expect(chatFormOf("")).toEqual({ form: null, faults: [] });
  const bad = chatBlockOf({ ...form, format: "{tags}: {message}", priority: "high" });
  expect(bad.faults.map((f) => f.at)).toEqual(["priority", "format"]);
  // The settings round-trip too, and a tag's fault names its row.
  const settings = settingsFormOf(stateAt(RANK_ADMIN).document);
  expect(settings.faults).toEqual([]);
  expect(settingsFormOf(settingsTextOf(settings.form).text).form).toEqual(settings.form);
  expect(settingsTextOf({ ...settings.form, tags: [...settings.form.tags, { ...settings.form.tags[0]!, name: "vip" }] }).faults).toEqual([{ at: "tag.1", text: "Two tags are named vip." }]);
});

test("the sample line shows the tag, the map and the sender in their colours", () => {
  const state = stateAt(RANK_ADMIN);
  const form = { ...blankChatForm(), format: "{map} {tags} {sender}: {message}" };
  form.parts.sender = coloured("{name}", 0x33cc66);
  const runs = sampleRuns(state, "VIP", form, settingsFormOf(state.document).form);
  expect(runs.map((r) => r.text).join("")).toBe("Miami [VIP] Rowan: Meet at the river at dusk.");
  expect(runs).toContainEqual({ text: "Miami", ink: 0x0080ff });
  expect(runs).toContainEqual({ text: "[VIP]", ink: GOLD });
  expect(runs).toContainEqual({ text: "Rowan", ink: 0x33cc66 });
  // A group with no tag and no block of its own shows the built-in line.
  expect(sampleRuns(state, "Builders", null, settingsFormOf(state.document).form).map((r) => r.text).join("")).toBe("Rowan: Meet at the river at dusk.");
});

test("with no chat settings stored, the page shows the server's red Admin tag", () => {
  const state = { ...stateAt(RANK_CLUSTER), document: "" };
  const form = settingsFormOf(state.document).form;
  expect(form.tags.map((t) => [t.name, readRichColor(t.text)])).toEqual(START_BOOK.tags.map((t) => [t.name, readRichColor(t.text)]));
  expect(form.muted).toBe(START_BOOK.mutedGroup);
  expect(sampleRuns(state, "Admins", null, form)).toContainEqual({ text: "[Admin]", ink: 0xff0000 });
  // A tag added on the page is saved beside it, not in its place.
  const saved = readChatSettings(JSON.parse(settingsTextOf({ ...form, tags: [...form.tags, { ...blankTag(), name: "VIP", text: "[VIP]" }] }).text)).value;
  expect(saved.tags.map((t) => t.name)).toEqual(["Admins", "VIP"]);
});

test("a refused sign-in asks for a reload, which brings the browser's own", () => {
  // The page's address is behind the gate, so a sign-in on the overview never reaches it.
  expect(readFault(401, "")).not.toContain("overview");
  expect(readFault(401, "")).toContain("Reload the page");
  expect(readFault(500, "broken")).toBe("The permissions answered 500: broken");
});

test("an open group holding a cheat is flagged as needing no password", () => {
  const state = stateAt(RANK_ADMIN);
  const named = (name: string) => state.groups.find((g) => g.name === name)!;
  expect([freeCheats(named("VIP")), freeCheats(named("Builders")), freeCheats(named("Admins")), freeCheats({ ...named("Builders"), permissions: ["*"] })]).toEqual([true, false, false, true]);
  expect(groupsHtml(state).split(FREE_CHEATS).length).toBe(2);
});

test("a world's navigation lists Permissions, which opens at its own address", () => {
  expect(cluster.map(([slug]) => slug)).not.toContain("permissions");
  expect(sections.find(([label]) => label === "Manage")![1].map(([slug]) => slug)).toContain("permissions");
  const worlds = [{ id: 2, name: "Tampa", map: "Miami", mapId: "core:miami", address: "/tampa/", players: 0, max: 10 }];
  const at = resolveAdmin("https://snark.test/admin/worlds/2/permissions/", worlds, (href, base) => new URL(href, base));
  expect([at.view, at.title, at.world?.id, at.worldUrl("permissions")]).toEqual(["permissions", "Permissions", 2, "/admin/worlds/2/permissions/"]);
  expect([at.api(PERMISSIONS_STATE.slice("/admin/".length)), at.api(PERMISSIONS_API.slice("/admin/".length))]).toEqual([
    "https://snark.test/tampa/admin/permissions.json",
    "https://snark.test/tampa/admin/permissions-change",
  ]);
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
  const at = "/admin/worlds/local/permissions/";
  expect([(await get(at)).status, (await get(at, "wrong")).status]).toEqual([401, 401]);
  const page = await get(at, "hunter2");
  const html = await page.text();
  expect([page.status, html.includes('src="/admin/ui/permissions.js"'), html.includes('data-tab="history"'), html.includes('id="import-wal"')]).toEqual([200, true, true, true]);
  // The cluster's old address goes to this world's page, its query kept; the old API is gone.
  for (const old of ["/admin/permissions", "/admin/permissions/"]) expect((await get(`${old}?x=1`)).headers.get("location")).toBe(`${at}?x=1`);
  for (const old of OLD_PERMISSIONS_PATHS) expect((await get(old, "hunter2")).status).toBe(404);
  const script = await get("/admin/ui/permissions.js");
  expect([script.status, (await script.text()).length > 1000]).toEqual([200, true]);
});

test("the front passes the page's POST to its world, and none to the site", () => {
  expect([frontPasses("POST", PERMISSIONS_API), sitePost(PERMISSIONS_API), ...OLD_PERMISSIONS_PATHS.map(sitePost)]).toEqual([true, false, false, false]);
});

test("the heading names the map the page acts on and says what is whose", () => {
  expect(headingOf(stateAt(RANK_ADMIN, 2))).toEqual({
    title: "Permissions on Tampa",
    scope: "Groups and memberships are the whole cluster's, while a staff membership made here and your sign-in to this page are this map's.",
  });
  const alone: PermissionsState = { ...stateAt(RANK_ADMIN, 0), worlds: [{ id: 0, name: "Kiwi" }] };
  expect(headingOf(alone).title).toBe("Permissions on Kiwi");
});

test("Every map starts unticked and is offered only to a cluster admin for a staff group", () => {
  const top = stateAt(RANK_CLUSTER);
  const mapAdmin = stateAt(RANK_MAP);
  expect([everyMapOf(top, "Admins"), everyMapOf(mapAdmin, "Admins"), everyMapOf(top, "VIP"), everyMapOf(stateAt(RANK_CLUSTER, 0), "Admins")]).toEqual([
    { offer: true, note: "A staff membership holds on this map unless you tick Every map." },
    { offer: false, note: "A staff membership made here holds on this map only." },
    { offer: false, note: "An open group's membership holds on every map." },
    { offer: false, note: "" },
  ]);
  const add = (state: PermissionsState, everyMap: boolean) => addMemberPost(state, { kind: "survivor", who: PIP, group: "Admins", hours: "", delay: "", everyMap });
  expect([add(top, false).post, add(top, true).post]).toMatchObject([{ op: { world: 1 } }, { op: { world: 0 } }]);
  expect(add(mapAdmin, true)).toEqual({ post: null, why: "Only a cluster admin makes a staff membership for every map." });
  expect(add(mapAdmin, false).post).toEqual({ do: "op", op: { op: "addMember", kind: "survivor", key: PIP, group: "Admins" } });
  const html = readFileSync(join(import.meta.dir, "../../client/admin/permissions.html"), "utf8");
  expect(html).toMatch(/<input id="member-every" type="checkbox">/);
});

test("a whole value is sent with what it began from, and a conflict keeps the draft", () => {
  const base = stateAt(RANK_CLUSTER);
  const state: PermissionsState = { ...base, groups: [...base.groups, { name: "Empty", rank: 0, permissions: [], chat: "" }] };
  expect([chatPost(state, "VIP", "{}", "old").post, settingsPost(state, "{}", "doc").post, rankPost(state, "Empty", 1, 0).post]).toEqual([
    { do: "op", op: { op: "setChat", group: "VIP", chat: "{}", was: "old" } },
    { do: "op", op: { op: "setDocument", name: "chat", text: "{}", was: "doc" } },
    { do: "op", op: { op: "setRank", group: "Empty", rank: 1, was: 0 } },
  ]);
  const draft = { ...blankChatForm(), priority: "9" };
  const edit = editOf("old", draft);
  const overtaken = editAfter(edit, { ok: false, why: CHANGED_MEANWHILE, current: "theirs" })!;
  // The draft stays as it was, and the next send goes over theirs.
  expect([overtaken.draft, overtaken.from, overtaken.theirs]).toEqual([draft, "theirs", "theirs"]);
  expect(chatPost(state, "VIP", "{}", String(overtaken.from)).post).toMatchObject({ op: { was: "theirs" } });
  expect([editAfter(edit, { ok: true, why: "" }), editAfter(edit, { ok: false, why: "That needs the map rank." })]).toEqual([null, edit]);
  const box = chatGroupHtml(state, state.groups[3]!, draft, [], '<b>theirs</b>');
  expect([box.includes("Someone saved this meanwhile"), box.includes("&#60;b&#62;theirs"), box.includes('data-act="chat-again"'), box.includes('data-act="chat-keep"')]).toEqual([true, true, true, true]);
  const ranks = new Map([["builders", { from: 2, draft: 1, theirs: 2 }]]);
  const groups = groupsHtml(state, ranks);
  expect([groups.includes('data-act="rank-again" data-group="Builders"'), groups.includes("Make it staff over theirs")]).toEqual([true, true]);
});

test("an apply whose plan changed shows the plan as it is now", () => {
  const html = importHtml({ ok: false, why: "What the import would do changed since it was checked.", ops: 2, digest: "d2", notes: ["Permissions.AddGroup <x>"] }, true);
  expect([html.includes("changed since it was checked. It would make 2 changes."), html.includes("&#60;x&#62;")]).toEqual([true, true]);
  expect(importHtml({ ok: false, why: "That needs the map rank." }, true)).toBe('<p class="bad">That needs the map rank.</p>');
});

test("the history says when, who, at which rank and how, on which map, and escapes it all", () => {
  const state = stateAt(RANK_ADMIN);
  const rows: HistoryRow[] = [
    { seq: 9, at: NOW, world: 2, name: "<i>Mara</i>", id: MARA, rank: RANK_MAP, via: "session", what: "Permissions.Add <x> VIP all", revision: 4 },
    { seq: 8, at: NOW, world: 1, name: "(server)", id: "", rank: -1, via: "server", what: "took out 1 row", revision: 3 },
  ];
  const html = historyHtml(state, rows);
  expect([html.includes("&#60;i&#62;Mara"), html.includes(MARA), html.includes("map, In game"), html.includes("Tampa"), html.includes("By the server"), html.includes("&#60;x&#62;")]).toEqual([true, true, true, true, true, true]);
  expect(historyHtml(state, [])).toContain("No changes yet.");
});

test("the page adds a survivor of another map by name, and no ID never issued", () => {
  const base = stateAt(RANK_CLUSTER);
  const away = idOf(2, 4);
  const state: PermissionsState = { ...base, register: [...base.register, { id: away, name: "Rook", world: 2 }] };
  const add = (who: string) => addMemberPost(state, { kind: "survivor", who, group: "VIP", hours: "", delay: "", everyMap: true });
  expect(add("rook").post).toEqual({ do: "op", op: { op: "addMember", kind: "survivor", key: away, group: "VIP", world: 0 } });
  expect(add(idOf(2, 5))).toEqual({ post: null, why: `No survivor has the ID ${idOf(2, 5)}.` });
  // A tribe of another map is the server's to judge.
  expect(addMemberPost(state, { kind: "tribe", who: "3145729", group: "VIP", hours: "", delay: "", everyMap: true }).why).toBe("");
  const m: Member = { kind: "survivor", key: away, group: "VIP", world: 0, forever: true, from: 0, until: 0 };
  expect(memberRows({ ...state, members: [{ ...m, name: "" }] }, NOW)[0]!.who).toBe("Rook");
});
