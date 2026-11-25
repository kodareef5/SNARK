// The Permissions admin page (client/admin/permissions.ts): its parts that need no browser (client/core/admin/permissions.ts),
// its place in the cluster's navigation and build, the gate in front of it, and the front that passes what it sends.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FREE_CHEATS, addGroupPost, addMemberPost, blankChatForm, chatBlockOf, chatFormOf, coloured, firstInk, freeCheats, grantPost, groupsHtml, importPost, manageWhy, memberRows,
  memberRowsHtml, passwordPost, passwordRows, passwordRowsHtml, removeGroupPost, sampleRuns, settingsFormOf, settingsHtml, settingsTextOf, spanWords, type MemberForm,
} from "../../client/core/admin/permissions.ts";
import { cluster, resolveAdmin } from "../../client/core/admin/navigation.ts";
import { adminSite } from "../../server/admin/site.ts";
import { sitePost } from "../../server/front.ts";
import { Guesses } from "../../server/guesses.ts";
import { idOf } from "../../shared/ids.ts";
import type { Member } from "../../shared/permissions/model.ts";
import { PERMISSIONS_API, PERMISSIONS_STATE, type PermissionsState } from "../../shared/permissions/page.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_STAFF } from "../../shared/ranks.ts";
import { buildAdmin } from "../../tools/build-admin.ts";

const root = mkdtempSync(join(tmpdir(), "snark-permissions-page-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const HOUR = 3600_000;
const NOW = 1_800_000_000_000;
const MARA = idOf(1, 1), KADE = idOf(1, 2), PIP = idOf(1, 3);
const always = { forever: true, from: 0, until: 0 };
const GOLD = 0xffd700;

/** Miami, where Mara is a map admin and Kade an admin; Pip has a timed VIP membership, and a tribe builds. */
function stateAt(rank: number): PermissionsState {
  return {
    me: { name: "Kade", id: KADE, rank, world: 1 },
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
    passwords: [MARA],
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
  expect([mara.has, mara.issueWhy, mara.clearWhy]).toEqual([true, "That survivor holds a higher rank than yours.", "That survivor holds a higher rank than yours."]);
  expect(passwordRowsHtml([mara])).toContain('data-act="issue" data-id="' + MARA + '" disabled title="That survivor holds a higher rank than yours."');
  expect(groupsHtml(admin)).toContain('data-act="remove-group" data-group="MapAdmins" disabled title="That needs the map rank."');
  // The map's admin reaches both.
  const map = stateAt(RANK_MAP);
  expect([rowOf(map, MARA, "MapAdmins").removeWhy, rowOf(map, MARA, "VIP").removeWhy]).toEqual(["", ""]);
});

test("a viewer below admin rank can change nothing", () => {
  const staff = stateAt(RANK_STAFF);
  const why = "Permissions are managed from an admin's rank.";
  expect(manageWhy(staff)).toBe(why);
  expect(memberRows(staff, NOW).map((r) => r.removeWhy)).toEqual(memberRows(staff, NOW).map(() => why));
  const html = groupsHtml(staff) + memberRowsHtml(memberRows(staff, NOW)) + passwordRowsHtml(passwordRows(staff)) + settingsHtml(staff, settingsFormOf(staff.document).form, []);
  expect(enabled(html)).toEqual([]);
  expect(addMemberPost(staff, { kind: "survivor", who: PIP, group: "VIP", hours: "", delay: "", everyMap: false }).why).toBe(why);
  expect([importPost(staff, "commands", "Permissions.AddGroup VIP", false).why, passwordPost(staff, PIP).why]).toEqual([why, why]);
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

test("what is typed becomes the right op, and a bad one is refused before it is sent", () => {
  const admin = stateAt(RANK_ADMIN);
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
    addGroupPost(admin, "bad name!", 0),
    addGroupPost(admin, "vip", 0),
    addGroupPost(admin, "Mods", RANK_MAP),
    removeGroupPost(admin, "Default"),
    grantPost(admin, "VIP", " "),
    grantPost(admin, "VIP", "cheat.FLY"),
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
  expect(addGroupPost(admin, " Mods ", RANK_STAFF).post).toEqual({ do: "op", op: { op: "addGroup", group: "Mods", rank: RANK_STAFF } });
  expect(grantPost(admin, "VIP", "Cheat.kick").post).toEqual({ do: "op", op: { op: "grant", group: "VIP", permission: "Cheat.kick" } });
  expect([passwordPost(admin, PIP).post, importPost(admin, "arkapi", "", true).why, importPost(admin, "crosschat", "{}", true).post]).toEqual([
    { do: "password", id: PIP },
    "Choose the ArkApi Permissions file first.",
    { do: "import", kind: "crosschat", text: "{}" },
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

test("an open group holding a cheat is flagged as needing no password", () => {
  const state = stateAt(RANK_ADMIN);
  const named = (name: string) => state.groups.find((g) => g.name === name)!;
  expect([freeCheats(named("VIP")), freeCheats(named("Builders")), freeCheats(named("Admins")), freeCheats({ ...named("Builders"), permissions: ["*"] })]).toEqual([true, false, false, true]);
  expect(groupsHtml(state).split(FREE_CHEATS).length).toBe(2);
});

test("the cluster nav lists Permissions, which opens at /admin/permissions/", () => {
  expect(cluster.map(([slug]) => slug)).toContain("permissions");
  const at = resolveAdmin("https://snark.test/admin/permissions/", [], (href, base) => new URL(href, base));
  expect([at.view, at.title, at.world]).toEqual(["permissions", "Permissions", null]);
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
  expect([(await get("/admin/permissions/")).status, (await get("/admin/permissions/", "wrong")).status, (await get(PERMISSIONS_STATE)).status]).toEqual([401, 401, 401]);
  const page = await get("/admin/permissions/", "hunter2");
  expect([page.status, (await page.text()).includes('src="/admin/ui/permissions.js"')]).toEqual([200, true]);
  expect((await get("/admin/permissions", "hunter2")).headers.get("location")).toBe("/admin/permissions/");
  const script = await get("/admin/ui/permissions.js");
  expect([script.status, (await script.text()).length > 1000]).toEqual([200, true]);
});

test("the front passes the page's POST to the site", () => {
  expect([sitePost(PERMISSIONS_API), sitePost(PERMISSIONS_STATE), sitePost("/admin/permissions/")]).toEqual([true, false, false]);
});
