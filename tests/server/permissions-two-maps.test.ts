// The life of an admin across two live maps of one cluster: map A and map B each with its own password, the cluster's
// above them, one permissions store, real sessions, travel, console commands, the admin pages' gate and the Permissions
// page, and a restore of A's save. Who may promote whom, where a grant holds, what reaches a connected player, what the
// log keeps, and what a restore may not hand on.
import { expect, spyOn, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { OPERATOR, sessionActor } from "../../server/acts.ts";
import { refused, type AdminGate } from "../../server/admin/gate.ts";
import { adminSite } from "../../server/admin/site.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { POLL_MS } from "../../server/permissions/permissions.ts";
import { permissionsAdmin } from "../../server/permissions/routes.ts";
import { passwordHash, passwordText, staffPasswords } from "../../server/permissions/secrets.ts";
import { idText } from "../../server/survivor-ids.ts";
import { CHEAT_GUESSES, WRONG_PASSWORD } from "../../shared/console.ts";
import { idOf, idParts } from "../../shared/ids.ts";
import { TEXT_NOTICE } from "../../shared/net/protocol.ts";
import type { PermissionOp } from "../../shared/permissions/model.ts";
import { PERMISSIONS_API, PERMISSIONS_STATE, type PermissionsAnswer, type PermissionsPost, type PermissionsState } from "../../shared/permissions/page.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_OPEN, RANK_STAFF } from "../../shared/ranks.ts";
import { MODE_FLY, MODE_WALK } from "../../shared/sim/character.ts";
import { TestCluster, beat, commit, crash, keyAt, rec, rise, travel, type Clock, type Server } from "../fixtures/cluster.ts";
import { listener } from "../fixtures/module.ts";

const MAP_A = "Tui-Map-A-7731";
const MAP_B = "Kea-Map-B-4402";
const CLUSTER = "Moa-Cluster-9915";
const PASSWORD = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/;
const RETIRED = "that password was replaced or cleared";
const NO_STAFF = "You are in no staff group, so there is no password to claim. An admin puts you in one first.";
const NOT_HERE = "signed in, but no group of yours counts on this map";
const NO_CHEATS = "denied: cheats are not enabled for you";
const NOT_ADMIN = "Permissions are managed from an admin's rank.";
const CLUSTER_ONLY = "In a cluster, only the cluster's admins change groups and chat settings.";
const OWN_WORLD = "A staff membership is made on its own world, or by the cluster.";
const HIGHER = "That survivor holds a higher rank than yours.";
const PEOPLED = "A group's rank changes only while it has no members. Take them out first.";
const NOBODY_SETS = "A survivor claims their own password in game. Nobody sets one here.";

interface Maps {
  cluster: TestCluster;
  clock: Clock;
  a: Server;
  b: Server;
  /** What a module on each map heard. */
  heard: { a: string[]; b: string[] };
  /** Stops A as by a crash, puts `backup` in place of its save, and starts it again with the same settings. */
  restoreA(backup: string): Server;
}

/** Map A (world 1) and map B (world 2) over one cluster folder, each with its own password and the cluster's, on one wall clock. */
async function maps(run: (m: Maps) => void | Promise<void>, events: string[] = ["perm.changed"]): Promise<void> {
  const cluster = new TestCluster();
  try {
    const clock = { ms: 1_000_000_000 };
    const ears = { a: listener("ears", events), b: listener("ears", events) };
    const host = (password: string, def: ModuleDef) => ({ host: { adminPassword: password, clusterPassword: CLUSTER, survivorLog: { wall: () => clock.ms }, modules: [def] } });
    const a = cluster.server("a", "f", clock, host(MAP_A, ears.a.def));
    const b = cluster.server("b", "f", clock, host(MAP_B, ears.b.def));
    beat(a, b);
    const m: Maps = {
      cluster,
      clock,
      a,
      b,
      heard: { a: ears.a.heard.lines, b: ears.b.heard.lines },
      restoreA: (backup) => (m.a = cluster.restore(m.a, backup, clock, host(MAP_A, listener("ears", events).def))),
    };
    await run(m);
  } finally {
    cluster.cleanup();
  }
}

const idIn = (s: Server, name: string): string => idText(rec(s, name)!);
const godOf = (s: Server): number => s.h.reg.index.get("core:god")!;
const hasGod = (s: Server, name: string): boolean => s.h.host.buffs.has(rec(s, name)!, godOf(s));
const modeOf = (s: Server, session: ClientSession): number => s.h.world.ents.mode[s.h.ent(session)]!;
const notices = (session: ClientSession): string[] => session.log.filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text);
const keptActs = (s: Server) => s.h.host.acts.recent(0, Number.MAX_SAFE_INTEGER);
const allActs = (s: Server) => s.h.host.acts.recentWithOpen(0, Number.MAX_SAFE_INTEGER);

/** The operator's change on a map, which must be made: it writes one act of the kind "change". */
function must(s: Server, line: string): string {
  const before = keptActs(s).length;
  const out = s.h.host.exec(line);
  const after = keptActs(s);
  if (after.length !== before + 1 || after.at(-1)!.kind !== "change") throw new Error(`${line}: ${out}`);
  return out;
}

/** Lets map `s` read the store again, as it does every 5 s. */
function poll(s: Server, clock: Clock): void {
  clock.ms += POLL_MS;
  s.h.run(200);
}

/** `session` claims its own password, giving `current` if any: the password only its session was sent. */
function claim(s: Server, session: ClientSession, current = ""): string {
  const said = s.h.say(session, current === "" ? "claimpassword" : `claimpassword "${current}"`);
  const password = session.secret;
  session.secret = "";
  if (!PASSWORD.test(password)) throw new Error(`${session.name} claimed no password: ${said.join(" | ")}`);
  return password;
}

function signIn(s: Server, session: ClientSession, password: string): void {
  const said = s.h.say(session, `enablecheats ${password}`);
  if (said[0] !== "cheats enabled") throw new Error(`${session.name} did not sign in: ${said.join(" | ")}`);
}

/** A survivor joined on `s` and signed in with the map's or the cluster's password. */
function hostAdmin(s: Server, cluster: TestCluster, name: string, password: string): ClientSession {
  const { session } = cluster.survivor(s, name);
  signIn(s, session, password);
  return session;
}

/** `session` travels from `from` to `to` through an obelisk, arrives with its ticket and rises there. */
function cross(m: Maps, from: Server, to: Server, session: ClientSession): ClientSession {
  const ticket = travel(from, session, to.world);
  if (!(ticket instanceof Uint8Array)) throw new Error(`${session.name} could not travel: ${ticket}`);
  m.clock.ms += 30_000;
  beat(m.a, m.b);
  const there = to.h.join(session.name, {}, { key: keyAt(session.name, to.world), ticket });
  to.h.run(400);
  rise(to, there);
  return there;
}

/** A map's admin pages, through the real site and its gate: the Permissions page's state and API. */
function pages(s: Server, cluster: TestCluster) {
  const host = s.h.host;
  const gate: AdminGate = {
    dev: false, password: host.adminPassword, cluster: host.clusterPassword, guesses: host.game.sessions.cheatGuesses, tick: () => s.h.world.tick, world: s.world, staff: staffPasswords(host),
  };
  const ask = async (path: string, user: string, password: string, post?: PermissionsPost, who = "1.2.3.4"): Promise<Response> => {
    const headers: Record<string, string> = { authorization: `Basic ${btoa(`${user}:${password}`)}` };
    const init: RequestInit = post ? { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(post) } : { headers };
    const url = `http://localhost${path}`;
    const site = { dir: cluster.dir, base: "", port: 0, id: s.world, who, gate, destinations: () => [], scenes: () => new Response(null), permissions: (call: Request, at: string) => permissionsAdmin(call, at, host) };
    return (await adminSite(new Request(url, init), new URL(url), site))!;
  };
  return {
    gate,
    state: async (user: string, password: string, who?: string): Promise<[number, PermissionsState | null]> => {
      const res = await ask(PERMISSIONS_STATE, user, password, undefined, who);
      return [res.status, res.status === 200 ? ((await res.json()) as PermissionsState) : null];
    },
    op: async (user: string, password: string, op: PermissionOp | Record<string, unknown>, who?: string): Promise<[number, PermissionsAnswer]> => {
      const res = await ask(PERMISSIONS_API, user, password, { do: "op", op: op as PermissionOp }, who);
      return [res.status, (await res.json()) as PermissionsAnswer];
    },
    post: async (user: string, password: string, post: PermissionsPost, who?: string): Promise<[number, PermissionsAnswer]> => {
      const res = await ask(PERMISSIONS_API, user, password, post, who);
      return [res.status, (await res.json()) as PermissionsAnswer];
    },
    /** The status the gate alone gives a sign-in. */
    status: (user: string, password: string, who = "1.2.3.4"): number => {
      const req = new Request("http://localhost/admin/", { headers: { authorization: `Basic ${btoa(`${user}:${password}`)}` } });
      return refused(req, who, gate)?.status ?? 200;
    },
  };
}

// Passwords and rank

test("A's map password signs in on A, is a wrong guess on B; the cluster's on both", async () => {
  await maps(async ({ cluster, a, b }) => {
    const { session: ada } = cluster.survivor(a, "ada");
    const { session: bob } = cluster.survivor(b, "bob");
    const { session: cyd } = cluster.survivor(a, "cyd");
    const { session: dan } = cluster.survivor(b, "dan");
    expect(a.h.say(ada, `enablecheats ${MAP_A}`)).toEqual(["cheats enabled"]);
    expect([a.h.client(ada)!.rank, a.h.client(ada)!.admin]).toEqual([RANK_MAP, true]);
    expect(b.h.say(bob, `enablecheats ${MAP_A}`)).toEqual([WRONG_PASSWORD]);
    expect([b.h.client(bob)!.rank, b.h.client(bob)!.admin, b.h.client(bob)!.cheatAttempts]).toEqual([RANK_OPEN, false, 1]);
    expect(b.h.say(bob, "god")).toEqual([NO_CHEATS]);
    // B's own password gives B's map rank.
    expect(b.h.say(bob, `enablecheats ${MAP_B}`)).toEqual(["cheats enabled"]);
    expect(b.h.client(bob)!.rank).toBe(RANK_MAP);
    for (const [s, session] of [[a, cyd], [b, dan]] as const) {
      expect(s.h.say(session, `enablecheats ${CLUSTER}`)).toEqual(["cheats enabled"]);
      expect([s.h.client(session)!.rank, s.h.client(session)!.admin]).toEqual([RANK_CLUSTER, true]);
    }
    // The pages take the same passwords at the same ranks.
    const [onA, onB] = [pages(a, cluster), pages(b, cluster)];
    const [okA, stateA] = await onA.state("kody", MAP_A);
    expect([okA, stateA?.me]).toEqual([200, { name: "(kody)", id: "", rank: RANK_MAP, world: a.world }]);
    expect((await onB.state("kody", MAP_A, "5.5.5.5"))[0]).toBe(401);
    const [okB, stateB] = await onB.state("kody", CLUSTER, "5.5.5.6");
    expect([okB, stateB?.me]).toEqual([200, { name: "(kody)", id: "", rank: RANK_CLUSTER, world: b.world }]);
    expect((await onA.state("", CLUSTER))[1]?.me).toEqual({ name: "(cluster password)", id: "", rank: RANK_CLUSTER, world: a.world });
  });
});

test("a staff member has no powers until she claims and signs in; the claim is hers", async () => {
  await maps(({ cluster, a, b }) => {
    const { session: ada } = cluster.survivor(a, "ada");
    const { session: bob } = cluster.survivor(a, "bob");
    const { session: cyd } = cluster.survivor(b, "cyd");
    const id = idIn(a, "ada");
    must(a, `Permissions.Add ${id} Admins`);
    const c = a.h.client(ada)!;
    expect([c.admin, c.rank, a.h.say(ada, "god").at(-1), a.h.say(ada, "Permissions.ListGroups")]).toEqual([false, RANK_OPEN, NO_CHEATS, ["denied: this needs the admin rank or above"]]);
    const password = claim(a, ada);
    // Claimed but not signed in: still nothing.
    expect([c.admin, c.rank, a.h.say(ada, "god")]).toEqual([false, RANK_OPEN, [NO_CHEATS]]);
    a.h.run(500);
    b.h.run(500);
    expect([bob.secret, cyd.secret, ada.secret]).toEqual(["", "", ""]);
    for (const session of [bob, cyd, ada]) for (const l of session.log) expect(l.text.toUpperCase()).not.toContain(passwordText(password));
    signIn(a, ada, password);
    expect([c.admin, c.rank, c.signed, a.h.say(ada, "god")]).toEqual([true, RANK_ADMIN, true, ["god on"]]);
  });
});

// Who may promote whom

test("A's map admin's grant holds on A only, and she cannot make one for every map", async () => {
  await maps(async ({ cluster, clock, a, b }) => {
    const mia = hostAdmin(a, cluster, "mia", MAP_A);
    const { session: ada } = cluster.survivor(a, "ada");
    cluster.survivor(a, "bob");
    const [id, bobId] = [idIn(a, "ada"), idIn(a, "bob")];
    expect(a.h.say(mia, `Permissions.Add ${id} Admins`)[0]).toStartWith(`ada (${id}) is in Admins. It counts once they sign in`);
    expect(a.h.host.permissions.membersOf("survivor", id).map((m) => [m.group, m.world])).toEqual([["Admins", a.world]]);
    signIn(a, ada, claim(a, ada));
    expect(a.h.client(ada)!.rank).toBe(RANK_ADMIN);
    poll(b, clock);
    expect(b.h.host.permissions.rankOf({ id, team: 0, signed: true, world: b.world })).toBe(RANK_OPEN);
    expect(b.h.host.permissions.rankOf({ id, team: 0, signed: true, world: a.world })).toBe(RANK_ADMIN);
    // Every map needs the cluster's rank, by command and by page.
    expect(a.h.say(mia, `Permissions.Add ${bobId} Admins all`)).toEqual([OWN_WORLD]);
    const page = pages(a, cluster);
    expect(await page.op("kody", MAP_A, { op: "addMember", kind: "survivor", key: bobId, group: "Admins", world: 0 })).toEqual([403, { ok: false, why: OWN_WORLD }]);
    expect(await page.op("kody", MAP_A, { op: "addMember", kind: "survivor", key: bobId, group: "Admins", world: b.world })).toEqual([403, { ok: false, why: OWN_WORLD }]);
    expect(a.h.host.permissions.membersOf("survivor", bobId)).toEqual([]);
    // What a group gives holds on every map: only the cluster's rank changes it.
    must(a, "Permissions.AddGroup Vip");
    for (const line of ["Permissions.Grant Admins Cheat.fly", "Permissions.Revoke Admins *", "Permissions.Grant Vip *", "Permissions.Rank Vip staff", "Permissions.AddGroup Mods", "Permissions.RemoveGroup Vip"]) {
      expect([line, a.h.say(mia, line)]).toEqual([line, [CLUSTER_ONLY]]);
    }
    for (const op of [
      { op: "setChat", group: "Admins", chat: '{"Format":"x"}' },
      { op: "setDocument", name: "chat", text: "{}" },
      { op: "addGroup", group: "Mods", rank: RANK_STAFF },
      { op: "grant", group: "Default", permission: "*" },
    ] as PermissionOp[]) {
      expect([op.op, ...(await page.op("kody", MAP_A, op))]).toEqual([op.op, 403, { ok: false, why: CLUSTER_ONLY }]);
    }
    expect(a.h.host.permissions.groups().map((g) => [g.name, g.rank, g.permissions, g.chat])).toEqual([
      ["Default", RANK_OPEN, [], ""],
      ["Admins", RANK_ADMIN, ["*"], ""],
      ["Vip", RANK_OPEN, [], ""],
    ]);
    // The cluster's rank, on either map, may.
    const sam = hostAdmin(b, cluster, "sam", CLUSTER);
    expect(b.h.say(sam, "Permissions.Grant Vip Kit.vip")).toEqual(["Vip holds Kit.vip"]);
    expect(b.h.say(sam, `Permissions.Add ${bobId} Admins all`)[0]).toStartWith(`bob (${bobId}) is in Admins on every map.`);
  });
});

test("a regular admin manages members up to her rank and nothing above it", async () => {
  await maps(async ({ cluster, clock, a, b }) => {
    const { session: ada } = cluster.survivor(a, "ada");
    cluster.survivor(a, "bob");
    cluster.survivor(a, "carl");
    const { session: eve } = cluster.survivor(a, "eve");
    const { session: dan } = cluster.survivor(b, "dan");
    const [adaId, bob, carl, danId, eveId] = [idIn(a, "ada"), idIn(a, "bob"), idIn(a, "carl"), idIn(b, "dan"), idIn(a, "eve")];
    for (const line of ["Permissions.AddGroup Vip", "Permissions.AddGroup Mods", "Permissions.Rank Mods staff", "Permissions.AddGroup Owners", "Permissions.Rank Owners map", "Permissions.AddGroup Council", "Permissions.Rank Council cluster"]) must(a, line);
    must(a, `Permissions.Add ${adaId} Admins`);
    // A cluster group's membership is typed with all: without it the command is refused.
    // A cluster group's membership is for every map without saying so.
    expect(a.h.host.exec(`Permissions.Add ${eveId} Council`)).toContain(`is in Council on every map`);
    must(a, `Permissions.Add ${eveId} Vip`);
    // Dan is a map admin of B, made there.
    poll(b, clock);
    must(b, `Permissions.Add ${danId} Owners`);
    must(b, `Permissions.Add ${danId} Vip`);
    const dans = claim(b, dan);
    const eves = claim(a, eve);
    const adas = claim(a, ada);
    signIn(a, ada, adas);
    expect(a.h.client(ada)!.rank).toBe(RANK_ADMIN);
    const say = (line: string): string => a.h.say(ada, line).join("\n");
    // At or below her rank.
    expect(say(`Permissions.Add ${bob} Vip`)).toBe(`bob (${bob}) is in Vip on every map`);
    expect(say(`Permissions.Add ${bob} Mods`)).toStartWith(`bob (${bob}) is in Mods.`);
    expect(say(`Permissions.Remove ${bob} Mods`)).toBe(`bob (${bob}) is out of Mods`);
    expect(say(`Permissions.Add ${carl} Admins`)).toStartWith(`carl (${carl}) is in Admins.`);
    expect(say(`Permissions.Remove ${carl} Admins`)).toBe(`carl (${carl}) is out of Admins`);
    expect(say(`Permissions.Remove ${bob} Vip`)).toBe(`bob (${bob}) is out of Vip`);
    // Above it: a map-rank or cluster-rank group, or a survivor who holds one here or on the other map.
    expect(say(`Permissions.Add ${bob} Owners`)).toBe("That needs the map rank.");
    expect(say(`Permissions.Add ${bob} Council`)).toBe("That needs the cluster rank.");
    expect(say(`Permissions.Remove ${eveId} Council`)).toBe("That needs the cluster rank.");
    expect(say(`Permissions.Remove ${danId} Owners`)).toBe("That needs the map rank.");
    expect(say(`Permissions.Remove ${eveId} Vip`)).toBe(HIGHER);
    expect(say(`Permissions.Remove ${danId} Vip`)).toBe(HIGHER);
    expect(say(`Permissions.Add ${danId} Mods`)).toBe(HIGHER);
    expect(say(`Permissions.Password ${danId} clear`)).toBe(HIGHER);
    expect(say(`Permissions.Password ${eveId} clear`)).toBe(HIGHER);
    // Nor by the page, signed in with her own password.
    const page = pages(a, cluster);
    expect(await page.op(adaId, adas, { op: "addMember", kind: "survivor", key: bob, group: "Owners" })).toEqual([403, { ok: false, why: "That needs the map rank." }]);
    expect(await page.op(adaId, adas, { op: "clearSecret", id: danId })).toEqual([403, { ok: false, why: HIGHER }]);
    expect(await page.op(adaId, adas, { op: "removeMember", kind: "survivor", key: eveId, group: "Vip" })).toEqual([403, { ok: false, why: HIGHER }]);
    expect([a.h.host.permissions.secretOf(danId), a.h.host.permissions.secretOf(eveId)]).toEqual([passwordHash(dans), passwordHash(eves)]);
    expect(a.h.host.permissions.membersOf("survivor", danId).map((m) => m.group).sort()).toEqual(["Owners", "Vip"]);
    expect(a.h.host.permissions.membersOf("survivor", eveId).map((m) => m.group).sort()).toEqual(["Council", "Vip"]);
    expect(a.h.host.permissions.membersOf("survivor", bob)).toEqual([]);
  });
});

test("a group's rank changes only while it has no members, wherever they were added", async () => {
  await maps(({ cluster, clock, a, b }) => {
    cluster.survivor(a, "bob");
    cluster.survivor(b, "cyd");
    const [bob, cyd] = [idIn(a, "bob"), idIn(b, "cyd")];
    must(a, "Permissions.AddGroup Vip");
    must(a, `Permissions.Add ${bob} Vip`);
    expect(a.h.host.exec("Permissions.Rank Vip staff")).toBe(PEOPLED);
    expect(a.h.host.exec("Permissions.Rank Admins cluster")).toBe("Admins is of the cluster rank");
    expect(a.h.host.exec("Permissions.Rank Admins admin")).toBe("Admins is of the admin rank");
    // A member added on B a moment ago, before A has read the store again.
    must(a, "Permissions.AddGroup Night");
    poll(b, clock);
    must(b, `Permissions.Add ${cyd} Night`);
    expect(a.h.host.exec("Permissions.Rank Night staff")).toBe(PEOPLED);
    // A membership whose time has not started is a member too, until its time is over.
    must(a, "Permissions.AddGroup Later");
    must(a, `Permissions.AddTimed ${bob} Later 1 5`);
    expect(a.h.host.exec("Permissions.Rank Later staff")).toBe(PEOPLED);
    clock.ms += 7 * 3600_000;
    a.h.run(200);
    expect(a.h.host.exec("Permissions.Rank Later staff")).toBe("Later is of the staff rank");
    expect(a.h.host.permissions.group("Vip")!.rank).toBe(RANK_OPEN);
    expect(a.h.host.permissions.group("Night")!.rank).toBe(RANK_OPEN);
  });
});

test("nobody, by command, page or terminal, sets or reads a survivor's password", async () => {
  await maps(async ({ cluster, a, b }) => {
    const { session: ada } = cluster.survivor(a, "ada");
    const id = idIn(a, "ada");
    must(a, `Permissions.Add ${id} Admins all`);
    const password = claim(a, ada);
    const hash = passwordHash(password);
    const answers: string[] = [];
    // The terminal, on each map.
    for (const s of [a, b]) {
      answers.push(s.h.host.exec(`Permissions.Password ${id}`));
      answers.push(s.h.host.exec(`Permissions.Password ${id} ABCD-EFGH-JKLM-NPQR`));
      answers.push(s.h.host.exec(`Permissions.SetPassword ${id} ABCD-EFGH-JKLM-NPQR`));
      const set = { op: "setSecret", id, hash: passwordHash("ABCD-EFGH-JKLM-NPQR") } as unknown as PermissionOp;
      expect(s.h.host.changePermissions(OPERATOR, set)).toBe("That is not a permission change.");
    }
    expect(answers[0]).toMatch(new RegExp(`^ada \\(${id}\\) claimed a password on \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC$`));
    // A session at the cluster's rank.
    const sam = hostAdmin(b, cluster, "sam", CLUSTER);
    answers.push(...b.h.say(sam, `Permissions.Password ${id}`), ...b.h.say(sam, `claimpassword ${id}`));
    const samActor = sessionActor(b.h.client(sam)!, b.h.host.records);
    expect(b.h.host.changePermissions(samActor, { op: "setSecret", id, hash: "ab".repeat(32) } as unknown as PermissionOp)).toBe("That is not a permission change.");
    // The page at the cluster's rank: no op sets one, and the state shows none.
    const page = pages(b, cluster);
    expect(await page.op("kody", CLUSTER, { op: "setSecret", id, hash: "ab".repeat(32) })).toEqual([403, { ok: false, why: NOBODY_SETS }]);
    expect(await page.op("kody", CLUSTER, { op: "addMember", kind: "survivor", key: id, group: "Admins", hash: "ab".repeat(32) })).toEqual([403, { ok: false, why: NOBODY_SETS }]);
    const imported = await page.post("kody", CLUSTER, { do: "import", kind: "commands", text: `Permissions.Password ${id} clear\nPermissions.Password ${id} ABCD-EFGH-JKLM-NPQR` });
    expect(imported[0]).toBe(200);
    const [, state] = await page.state("kody", CLUSTER);
    expect(state!.passwords).toEqual([{ id, at: b.h.host.permissions.claimedAt(id) }]);
    const shown = JSON.stringify([state, imported, answers]).toUpperCase();
    for (const secret of [passwordText(password), hash.toUpperCase()]) expect(shown).not.toContain(secret);
    expect([a.h.host.permissions.secretOf(id), b.h.host.permissions.secretOf(id)]).toEqual([hash, hash]);
    expect("issuePassword" in a.h.host || "setPassword" in a.h.host).toBe(false);
    signIn(a, ada, password);
  });
});

test("a grant to an ID no world issued is refused on both maps", async () => {
  await maps(async ({ cluster, a, b }) => {
    cluster.survivor(b, "bob");
    const bob = idIn(b, "bob");
    must(a, "Permissions.AddGroup Vip");
    const ghosts = [idOf(a.world, 999), idOf(b.world, 999), idOf(b.world, idParts(bob)!.n + 1), idOf(3, 1)];
    for (const s of [a, b]) {
      for (const ghost of ghosts) {
        expect(s.h.host.exec(`Permissions.Add ${ghost} Vip`)).toBe(`No survivor has the ID ${ghost}.`);
        expect(s.h.host.exec(`Permissions.AddTimed ${ghost} Admins 1 0`)).toBe(`No survivor has the ID ${ghost}.`);
        expect(s.h.host.changePermissions(OPERATOR, { op: "addMember", kind: "survivor", key: ghost, group: "Admins", world: 0 })).toBe(`No survivor has the ID ${ghost}.`);
      }
      const [status, answer] = await pages(s, cluster).op("kody", CLUSTER, { op: "addMember", kind: "survivor", key: ghosts[0]!, group: "Vip" });
      expect([status, answer]).toEqual([403, { ok: false, why: `No survivor has the ID ${ghosts[0]}.` }]);
      expect(s.h.host.permissions.membersIn("Vip")).toEqual([]);
      expect(s.h.host.permissions.membersIn("Admins")).toEqual([]);
    }
    // An ID B issued a moment ago is taken on A before A has read the store again.
    expect(must(a, `Permissions.Add ${bob} Vip`)).toStartWith(`bob (${bob}) is in Vip`);
  });
});

// Where a grant holds

test("an open group's membership made on A counts on B within the poll", async () => {
  await maps(({ cluster, clock, a, b }) => {
    const { session: bob } = cluster.survivor(b, "bob");
    const id = idIn(b, "bob");
    must(a, "Permissions.AddGroup Fliers");
    must(a, "Permissions.Grant Fliers Cheat.fly");
    expect(must(a, `Permissions.Add ${id} Fliers`)).toBe(`bob (${id}) is in Fliers on every map. bob is on another map, b.`);
    expect(b.h.say(bob, "groups")).toEqual(["your groups: Default"]);
    poll(b, clock);
    expect(b.h.say(bob, "groups")).toEqual(["your groups: Fliers, Default"]);
    expect(b.h.say(bob, "fly")).toEqual(["flying"]);
    expect(modeOf(b, bob)).toBe(MODE_FLY);
    expect(b.h.say(bob, "god")).toEqual([NO_CHEATS]);
  });
});

test("a map admin's staff grant on A does not count on B; the cluster's counts on all", async () => {
  await maps((m) => {
    const { cluster, a, b } = m;
    const mia = hostAdmin(a, cluster, "mia", MAP_A);
    const { session: ada } = cluster.survivor(a, "ada");
    const id = idIn(a, "ada");
    a.h.say(mia, `Permissions.Add ${id} Admins`);
    const password = claim(a, ada);
    signIn(a, ada, password);
    expect([a.h.client(ada)!.rank, a.h.say(ada, "god")]).toEqual([RANK_ADMIN, ["god on"]]);
    const there = cross(m, a, b, ada);
    // B does not tell her to sign in: no group of hers would count there.
    expect(notices(there).filter((t) => t.includes("password") || t.includes("enablecheats"))).toEqual([]);
    expect(b.h.say(there, `enablecheats ${password}`)).toEqual([NOT_HERE]);
    const c = b.h.client(there)!;
    expect([c.signed, c.admin, c.rank, b.h.say(there, "fly"), b.h.say(there, "Permissions.ListGroups")]).toEqual([true, false, RANK_OPEN, [NO_CHEATS], ["denied: this needs the admin rank or above"]]);
    expect(b.h.say(there, "groups")).toEqual(["your groups: Default"]);
    // Nor do B's pages take her password: no group of hers makes her an admin there.
    expect([pages(b, cluster).status(id, password, "8.8.8.8"), pages(a, cluster).status(id, password, "8.8.8.8")]).toEqual([401, 200]);
    // The cluster's admin makes another's membership for every map.
    const sam = hostAdmin(a, cluster, "sam", CLUSTER);
    const { session: bob } = cluster.survivor(a, "bob");
    const bobId = idIn(a, "bob");
    expect(a.h.say(sam, `Permissions.Add ${bobId} Admins all`)[0]).toStartWith(`bob (${bobId}) is in Admins on every map.`);
    const his = claim(a, bob);
    signIn(a, bob, his);
    expect(a.h.client(bob)!.rank).toBe(RANK_ADMIN);
    const bobThere = cross(m, a, b, bob);
    expect(b.h.say(bobThere, `enablecheats ${his}`)).toEqual(["cheats enabled"]);
    expect([b.h.client(bobThere)!.rank, b.h.say(bobThere, "god")]).toEqual([RANK_ADMIN, ["god on"]]);
  });
});

test("a staff member of A alone may claim on B, and that password signs her in on A", async () => {
  await maps((m) => {
    const { cluster, a, b } = m;
    const { session: ada } = cluster.survivor(a, "ada");
    const id = idIn(a, "ada");
    must(a, `Permissions.Add ${id} Admins`);
    const there = cross(m, a, b, ada);
    const password = claim(b, there);
    expect(b.h.say(there, `enablecheats ${password}`)).toEqual([NOT_HERE]);
    const home = cross(m, b, a, there);
    expect(a.h.say(home, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
    expect([idIn(a, "ada"), a.h.client(home)!.rank]).toEqual([id, RANK_ADMIN]);
  });
});

test("a survivor keeps her ID through travel, and no two survivors share one", async () => {
  await maps((m) => {
    const { cluster, a, b } = m;
    const names = { a: ["ada", "bob", "cyd"], b: ["dan", "eve"] };
    const { session: ada } = cluster.survivor(a, "ada");
    for (const n of names.a.slice(1)) cluster.survivor(a, n);
    for (const n of names.b) cluster.survivor(b, n);
    const id = idIn(a, "ada");
    expect(a.h.say(ada, "id")).toEqual([`ada  ${id}`]);
    const there = cross(m, a, b, ada);
    expect([b.h.say(there, "id"), idIn(b, "ada")]).toEqual([[`ada  ${id}`], id]);
    // More on each map after she left A.
    cluster.survivor(a, "fay");
    cluster.survivor(b, "gus");
    const all = [...names.a.map((n) => (n === "ada" ? id : idIn(a, n))), idIn(a, "fay"), ...names.b.map((n) => idIn(b, n)), idIn(b, "gus")];
    expect(new Set(all).size).toBe(all.length);
    for (const n of [...names.a.slice(1), "fay"]) expect(idParts(idIn(a, n))!.world).toBe(a.world);
    for (const n of [...names.b, "gus"]) expect(idParts(idIn(b, n))!.world).toBe(b.world);
    expect(idParts(id)!.world).toBe(a.world);
    expect(b.h.host.permissions.issued(id)?.name).toBe("ada");
  });
});

// What reaches a connected player

test("taken out of her group on A, a flier on B walks again within the poll", async () => {
  await maps(({ cluster, clock, a, b, heard }) => {
    const { session: ada } = cluster.survivor(b, "ada");
    const id = idIn(b, "ada");
    must(a, "Permissions.AddGroup Pilots");
    must(a, "Permissions.Rank Pilots staff");
    must(a, "Permissions.Grant Pilots Cheat.fly");
    must(a, `Permissions.Add ${id} Pilots all`);
    poll(b, clock);
    signIn(b, ada, claim(b, ada));
    const c = b.h.client(ada)!;
    expect([c.rank, c.admin, b.h.say(ada, "fly")]).toEqual([RANK_STAFF, false, ["flying"]]);
    expect(modeOf(b, ada)).toBe(MODE_FLY);
    const sam = hostAdmin(a, cluster, "sam", CLUSTER);
    b.h.run(100);
    heard.b.length = 0;
    expect(a.h.say(sam, `Permissions.Remove ${id} Pilots`)).toEqual([`ada (${id}) is out of Pilots. ada is on another map, b.`]);
    poll(b, clock);
    b.h.run(100);
    expect([modeOf(b, ada), c.rank, c.admin]).toEqual([MODE_WALK, RANK_OPEN, false]);
    expect(b.h.say(ada, "fly")).toEqual([NO_CHEATS]);
    expect(heard.b).toContain(`perm.changed: {"account":"${id}","group":"Pilots"}`);
  });
});

test("a password cleared on A signs her out on B in the poll; the old one is no guess", async () => {
  await maps(async ({ cluster, clock, a, b, heard }) => {
    const { session: ada } = cluster.survivor(b, "ada");
    const id = idIn(b, "ada");
    must(a, `Permissions.Add ${id} Admins all`);
    poll(b, clock);
    const old = claim(b, ada);
    signIn(b, ada, old);
    const c = b.h.client(ada)!;
    expect([c.signed, c.rank]).toEqual([true, RANK_ADMIN]);
    const page = pages(b, cluster);
    expect(page.status(id, old, "6.6.6.6")).toBe(200);
    expect(a.h.host.exec(`Permissions.Password ${id} clear`)).toBe(`ada (${id}) has no password now`);
    poll(b, clock);
    expect([c.signed, c.admin, c.rank, b.h.say(ada, "god")]).toEqual([false, false, RANK_OPEN, [NO_CHEATS]]);
    b.h.run(100);
    expect(heard.b).toContain(`perm.changed: {"account":"${id}","group":""}`);
    for (let i = 0; i < CHEAT_GUESSES + 2; i++) expect(b.h.say(ada, `enablecheats ${old}`)).toEqual([RETIRED]);
    expect([c.cheatAttempts, c.closed]).toEqual([0, false]);
    for (let i = 0; i < CHEAT_GUESSES + 2; i++) expect(page.status(id, old, "6.6.6.6")).toBe(401);
    // Not counted: the cluster's password still opens the pages from the same address.
    expect(page.status("kody", CLUSTER, "6.6.6.6")).toBe(200);
    expect(b.h.say(ada, `enablecheats ${CLUSTER}`)).toEqual(["cheats enabled"]);
  });
});

test("a password cleared on A is still refused uncounted on B after B restarts", async () => {
  await maps(async (m) => {
    const { cluster, clock, a } = m;
    let b = m.b;
    const { session: ada } = cluster.survivor(a, "ada");
    const id = idIn(a, "ada");
    must(a, `Permissions.Add ${id} Admins all`);
    const old = claim(a, ada);
    poll(b, clock);
    // Her page on B is open with it, and B knew it.
    expect(pages(b, cluster).status(id, old, "9.9.9.9")).toBe(200);
    expect(a.h.host.exec(`Permissions.Password ${id} clear`)).toBe(`ada (${id}) has no password now`);
    poll(b, clock);
    expect(pages(b, cluster).status(id, old, "9.9.9.8")).toBe(401);
    // B stops and starts again within the day; the page goes on sending the old password.
    commit(b);
    crash(b);
    b = cluster.server("b", "f", clock, { host: { adminPassword: MAP_B, clusterPassword: CLUSTER, survivorLog: { wall: () => clock.ms } } });
    beat(a, b);
    b.h.run(200);
    const page = pages(b, cluster);
    for (let i = 0; i < CHEAT_GUESSES + 1; i++) expect(page.status(id, old, "9.9.9.9")).toBe(401);
    expect(page.status("kody", CLUSTER, "9.9.9.9")).toBe(200);
  });
});

test("a timed membership ends at its time on the other map, with what it left running", async () => {
  await maps(({ cluster, clock, a, b }) => {
    const { session: ada } = cluster.survivor(b, "ada");
    const id = idIn(b, "ada");
    must(a, "Permissions.AddGroup Gods");
    must(a, "Permissions.Grant Gods *");
    const until = clock.ms + 3600_000;
    must(a, `Permissions.AddTimed ${id} Gods 1 0`);
    poll(b, clock);
    const c = b.h.client(ada)!;
    expect([c.admin, b.h.say(ada, "god"), b.h.say(ada, "fly")]).toEqual([true, ["god on"], ["flying"]]);
    clock.ms = until - 2000;
    b.h.run(200);
    expect([c.admin, modeOf(b, ada), hasGod(b, "ada")]).toEqual([true, MODE_FLY, true]);
    // She types nothing more: the end reaches her by the clock alone.
    clock.ms = until + 1;
    b.h.run(100);
    expect([c.admin, modeOf(b, ada), hasGod(b, "ada"), b.h.host.permissions.groupsOf(b.h.host.subjectOf(c)!).map((g) => g.name)]).toEqual([false, MODE_WALK, false, ["Default"]]);
  });
});

test("a reconnect must sign in again, and keeps only the cheats it may still run", async () => {
  await maps(({ cluster, a }) => {
    const { session: ada } = cluster.survivor(a, "ada");
    const { session: bob } = cluster.survivor(a, "bob");
    const [id, bobId] = [idIn(a, "ada"), idIn(a, "bob")];
    must(a, `Permissions.Add ${id} Admins`);
    must(a, "Permissions.AddGroup Saints");
    must(a, "Permissions.Grant Saints Cheat.god");
    must(a, `Permissions.Add ${bobId} Saints`);
    const password = claim(a, ada);
    signIn(a, ada, password);
    expect([a.h.say(ada, "god"), a.h.say(ada, "fly"), a.h.say(bob, "god")]).toEqual([["god on"], ["flying"], ["god on"]]);
    ada.close();
    bob.close();
    a.h.run(500);
    const back = a.h.join("ada", {}, { key: keyAt("ada", a.world) });
    a.h.join("bob", {}, { key: keyAt("bob", a.world) });
    a.h.run(600);
    const c = a.h.client(back)!;
    expect([idIn(a, "ada"), c.signed, c.admin, c.rank]).toEqual([id, false, false, RANK_OPEN]);
    expect([modeOf(a, back), hasGod(a, "ada")]).toEqual([MODE_WALK, false]);
    expect(a.h.say(back, "fly")).toEqual([NO_CHEATS]);
    // Bob's group still lets him run god.
    expect(hasGod(a, "bob")).toBe(true);
    signIn(a, back, password);
    expect([c.admin, c.rank, hasGod(a, "ada")]).toEqual([true, RANK_ADMIN, false]);
  });
});

test("an admin lowered on A a moment ago cannot use the old rank on B", async () => {
  await maps(async ({ cluster, clock, a, b }) => {
    const { session: ada } = cluster.survivor(b, "ada");
    cluster.survivor(b, "bob");
    cluster.survivor(b, "carl");
    const [id, bob, carl] = [idIn(b, "ada"), idIn(b, "bob"), idIn(b, "carl")];
    must(a, "Permissions.AddGroup Owners");
    must(a, "Permissions.Rank Owners map");
    must(a, "Permissions.AddGroup Vip");
    must(a, `Permissions.Add ${id} Owners all`);
    must(a, `Permissions.Add ${id} Admins all`);
    must(a, `Permissions.Add ${carl} Owners all`);
    poll(b, clock);
    const password = claim(b, ada);
    signIn(b, ada, password);
    const c = b.h.client(ada)!;
    expect(c.rank).toBe(RANK_MAP);
    // Lowered from the map's rank to an admin's on A, and at once she acts on B, which has not read the store again.
    must(a, `Permissions.Remove ${id} Owners`);
    expect(b.h.say(ada, `Permissions.Add ${bob} Owners`)).toEqual(["That needs the map rank."]);
    expect(b.h.say(ada, `Permissions.Password ${carl} clear`)).toEqual([HIGHER]);
    const page = pages(b, cluster);
    expect(await page.op(id, password, { op: "addMember", kind: "survivor", key: bob, group: "Owners" })).toEqual([403, { ok: false, why: "That needs the map rank." }]);
    // Taken out of Admins too, she makes no change at all: first by the page, whose gate still reads B's older view.
    must(a, `Permissions.Remove ${id} Admins`);
    expect(await page.op(id, password, { op: "addMember", kind: "survivor", key: bob, group: "Vip" })).toEqual([403, { ok: false, why: NOT_ADMIN }]);
    // B has read the store inside that write: her session stands lower, and the pages no longer take her password.
    expect(b.h.say(ada, `Permissions.Add ${bob} Vip`)).toEqual(["denied: this needs the admin rank or above"]);
    expect(page.status(id, password)).toBe(401);
    expect(b.h.host.permissions.membersOf("survivor", bob)).toEqual([]);
    expect(b.h.host.permissions.membersOf("survivor", carl).map((x) => x.group)).toEqual(["Owners"]);
    expect(c.rank).toBe(RANK_OPEN);
  });
});

test("a change judged before this map's poll is logged at the rank it was judged at", async () => {
  await maps(async ({ cluster, clock, a, b }) => {
    const { session: ada } = cluster.survivor(b, "ada");
    cluster.survivor(b, "bob");
    const [id, bob] = [idIn(b, "ada"), idIn(b, "bob")];
    must(a, "Permissions.AddGroup Owners");
    must(a, "Permissions.Rank Owners map");
    must(a, "Permissions.AddGroup Vip");
    must(a, `Permissions.Add ${id} Owners all`);
    must(a, `Permissions.Add ${id} Admins all`);
    poll(b, clock);
    signIn(b, ada, claim(b, ada));
    expect(b.h.client(ada)!.rank).toBe(RANK_MAP);
    // Lowered to an admin's rank on A; B has not read the store again when she acts there.
    must(a, `Permissions.Remove ${id} Owners`);
    expect(b.h.say(ada, `Permissions.Add ${bob} Vip`)).toEqual([`bob (${bob}) is in Vip on every map`]);
    const made = keptActs(b).at(-1)!;
    expect([made.kind, made.name, made.rank, made.what]).toEqual(["change", "ada", RANK_ADMIN, `Permissions.Add ${bob} Vip all`]);
    // Raised again and lowered again, and this time refused before the poll.
    must(a, `Permissions.Add ${id} Owners all`);
    poll(b, clock);
    expect(b.h.client(ada)!.rank).toBe(RANK_MAP);
    must(a, `Permissions.Remove ${id} Owners`);
    expect(b.h.say(ada, `Permissions.Add ${bob} Owners`)).toEqual(["That needs the map rank."]);
    const no = keptActs(b).at(-1)!;
    expect([no.kind, no.name, no.rank, no.what]).toEqual(["refused", "ada", RANK_ADMIN, `Permissions.Add ${bob} Owners: That needs the map rank.`]);
  });
});

// The log

test("each change is in the log of its own map, with who, ID, rank and how it came", async () => {
  await maps(async ({ cluster, clock, a, b }) => {
    const mia = hostAdmin(a, cluster, "mia", MAP_A);
    const { session: ada } = cluster.survivor(a, "ada");
    for (const n of ["bob", "carl", "dora"]) cluster.survivor(a, n);
    const [miaId, adaId, bob, carl, dora] = ["mia", "ada", "bob", "carl", "dora"].map((n) => idIn(a, n)) as [string, string, string, string, string];
    const start = keptActs(a).length;
    a.h.host.exec("Permissions.AddGroup Vip");
    a.h.say(mia, `Permissions.Add ${adaId} Admins`);
    const adas = claim(a, ada);
    signIn(a, ada, adas);
    a.h.say(mia, `Permissions.Add ${bob} Vip`);
    a.h.say(ada, `Permissions.Add ${carl} Vip`);
    const page = pages(a, cluster);
    expect((await page.op("kody", MAP_A, { op: "addMember", kind: "survivor", key: dora, group: "Vip" }))[0]).toBe(200);
    expect((await page.op(adaId, adas, { op: "removeMember", kind: "survivor", key: carl, group: "Vip" }))[0]).toBe(200);
    expect((await page.op("", CLUSTER, { op: "grant", group: "Vip", permission: "Kit.vip" }))[0]).toBe(200);
    // A change on B is B's.
    poll(b, clock);
    b.h.host.exec("Permissions.AddGroup Bees");
    const onA = keptActs(a).slice(start).map((x) => [x.name, x.id, x.rank, x.via, x.kind, x.what]);
    expect(onA).toEqual([
      ["(operator)", "", RANK_CLUSTER, "operator", "change", "Permissions.AddGroup Vip"],
      ["mia", miaId, RANK_MAP, "session", "change", `Permissions.Add ${adaId} Admins`],
      ["ada", adaId, RANK_OPEN, "session", "change", "claimed their own password"],
      ["ada", adaId, RANK_ADMIN, "session", "sign-in", "enablecheats with their own password"],
      ["mia", miaId, RANK_MAP, "session", "change", `Permissions.Add ${bob} Vip all`],
      ["ada", adaId, RANK_ADMIN, "session", "change", `Permissions.Add ${carl} Vip all`],
      ["(kody)", "", RANK_MAP, "page", "change", `Permissions.Add ${dora} Vip all`],
      ["ada", adaId, RANK_ADMIN, "page", "change", `Permissions.Remove ${carl} Vip`],
      ["(cluster password)", "", RANK_CLUSTER, "page", "change", "Permissions.Grant Vip Kit.vip"],
    ]);
    // A name typed with a shared password is in round brackets, which no survivor's name holds.
    expect(a.h.say(mia, "acts 3").join("\n")).toContain("(kody)  map  change: Permissions.Add");
    const onB = keptActs(b).map((x) => x.what);
    expect(onB).toContain("Permissions.AddGroup Bees");
    expect(onB.some((w) => w.includes("Vip"))).toBe(false);
    expect(keptActs(a).some((x) => x.what.includes("Bees"))).toBe(false);
  });
});

test("an admin's refused change is logged with what and why; a player's is not", async () => {
  await maps(async ({ cluster, a, b }) => {
    const said = a.log;
    const mia = hostAdmin(a, cluster, "mia", MAP_A);
    const { session: ada } = cluster.survivor(a, "ada");
    const { session: bob } = cluster.survivor(a, "bob");
    const { session: mo } = cluster.survivor(b, "mo");
    const [adaId, bobId, moId] = [idIn(a, "ada"), idIn(a, "bob"), idIn(b, "mo")];
    must(a, "Permissions.AddGroup Owners");
    must(a, "Permissions.Rank Owners map");
    must(a, `Permissions.Add ${adaId} Admins`);
    signIn(a, ada, claim(a, ada));
    expect(a.h.say(mia, "Permissions.Grant Admins Cheat.fly")).toEqual([CLUSTER_ONLY]);
    let act = keptActs(a).at(-1)!;
    expect([act.name, act.rank, act.via, act.kind, act.what]).toEqual(["mia", RANK_MAP, "session", "refused", `Permissions.Grant Admins Cheat.fly: ${CLUSTER_ONLY}`]);
    expect(said).toContain(`admin: mia (map rank) refused: Permissions.Grant Admins Cheat.fly: ${CLUSTER_ONLY}`);
    expect(a.h.say(mia, `Permissions.Add ${bobId} Admins all`)).toEqual([OWN_WORLD]);
    act = keptActs(a).at(-1)!;
    expect([act.name, act.kind, act.what]).toEqual(["mia", "refused", `Permissions.Add ${bobId} Admins all: ${OWN_WORLD}`]);
    const page = pages(a, cluster);
    expect((await page.op("kody", MAP_A, { op: "setRank", group: "Owners", rank: RANK_OPEN }))[0]).toBe(403);
    act = keptActs(a).at(-1)!;
    expect([act.name, act.via, act.kind, act.what]).toEqual(["(kody)", "page", "refused", `Permissions.Rank Owners open: ${CLUSTER_ONLY}`]);
    expect(a.h.say(ada, `Permissions.Add ${bobId} Owners`)).toEqual(["That needs the map rank."]);
    act = keptActs(a).at(-1)!;
    expect([act.name, act.id, act.rank, act.kind, act.what]).toEqual(["ada", adaId, RANK_ADMIN, "refused", `Permissions.Add ${bobId} Owners: That needs the map rank.`]);
    // A plain player and a signed-in moderator are refused and nothing is written.
    must(b, "Permissions.AddGroup Mods");
    must(b, "Permissions.Rank Mods staff");
    must(b, "Permissions.Grant Mods Cheat.kick");
    must(b, `Permissions.Add ${moId} Mods`);
    signIn(b, mo, claim(b, mo));
    expect(b.h.client(mo)!.rank).toBe(RANK_STAFF);
    const [beforeA, beforeB] = [allActs(a).length, allActs(b).length];
    expect(a.h.say(bob, "Permissions.AddGroup Vip")).toEqual(["denied: this needs the admin rank or above"]);
    expect(a.h.host.changePermissions(sessionActor(a.h.client(bob)!, a.h.host.records), { op: "addGroup", group: "Vip" })).toBe(NOT_ADMIN);
    expect(b.h.say(mo, `Permissions.Add ${moId} Admins`)).toEqual(["denied: this needs the admin rank or above"]);
    expect(b.h.host.changePermissions(sessionActor(b.h.client(mo)!, b.h.host.records), { op: "addMember", kind: "survivor", key: moId, group: "Admins" })).toBe(NOT_ADMIN);
    expect([allActs(a).length, allActs(b).length]).toEqual([beforeA, beforeB]);
  });
});

test("a moderator holding only Cheat.kick kicks someone, and it is in the log", async () => {
  await maps(({ cluster, a, b }) => {
    const said = b.log;
    const { session: mo } = cluster.survivor(b, "mo");
    const { session: carl } = cluster.survivor(b, "carl");
    const moId = idIn(b, "mo");
    must(b, "Permissions.AddGroup Mods");
    must(b, "Permissions.Rank Mods staff");
    must(b, "Permissions.Grant Mods Cheat.kick");
    must(b, `Permissions.Add ${moId} Mods`);
    expect(b.h.say(mo, "kick carl").at(-1)).toBe(NO_CHEATS);
    signIn(b, mo, claim(b, mo));
    expect([b.h.say(mo, "god"), b.h.say(mo, "kick carl")]).toEqual([[NO_CHEATS], ["kicked carl"]]);
    b.h.run(300);
    expect(b.h.client(carl)?.closed ?? true).toBe(true);
    const act = keptActs(b).at(-1)!;
    expect([act.name, act.id, act.rank, act.open, act.kind, act.what]).toEqual(["mo", moId, RANK_STAFF, false, "command", "kick carl"]);
    expect(said).toContain("admin: mo (staff rank) kick carl");
    expect(b.h.host.exec("acts 1")).toEndWith(`mo ${moId}  staff  kick carl`);
    expect(keptActs(a).some((x) => x.what === "kick carl")).toBe(false);
  });
});

test("no password, claimed or typed, is in an act, log, journal, page or answer", async () => {
  const out = spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    await maps(
      async (m) => {
        const { cluster, clock, a, b, heard } = m;
        const { session: ada } = cluster.survivor(a, "ada");
        const mia = hostAdmin(a, cluster, "mia", MAP_A);
        const { session: sam } = cluster.survivor(a, "sam");
        const id = idIn(a, "ada");
        must(a, `Permissions.Add ${id} Admins all`);
        const first = claim(a, ada);
        signIn(a, ada, first);
        a.h.say(mia, `enablecheats ${MAP_B}`);
        a.h.say(sam, `cheat enablecheats ${CLUSTER}`);
        a.h.say(sam, `admincheat enablecheats ${MAP_A}`);
        const second = claim(a, ada, first);
        a.h.say(ada, `cheat claimpassword ${second}`);
        const third = ada.secret;
        ada.secret = "";
        expect(third).toMatch(PASSWORD);
        a.h.say(ada, "acts 50");
        const there = cross(m, a, b, ada);
        b.h.say(there, `enablecheats ${second}`);
        b.h.say(there, `enablecheats ${third}`);
        const states: unknown[] = [];
        states.push(await pages(b, cluster).state(id, third), await pages(a, cluster).state("kody", MAP_A), await pages(b, cluster).state("", CLUSTER));
        states.push(await pages(b, cluster).state("kody", MAP_A, "7.7.7.7"));
        a.h.host.exec(`Permissions.Password ${id} clear`);
        poll(b, clock);
        b.h.say(there, `enablecheats ${third}`);
        b.h.say(there, "acts 50");
        commit(a, b);
        const journal = (s: Server): string[] => (s.h.host.persistence!.store.db.query("SELECT data FROM journal").all() as { data: Uint8Array }[]).map((r) => Buffer.from(r.data).toString("latin1"));
        const texts = [
          ...a.log,
          ...b.log,
          ...heard.a,
          ...heard.b,
          ...[a, b].flatMap((s) => allActs(s).map((x) => JSON.stringify(x))),
          ...[a, b].flatMap((s) => s.h.sessions.flatMap((session) => session.log.map((l) => l.text))),
          ...journal(a),
          ...journal(b),
          JSON.stringify(states),
          ...out.mock.calls.map((call) => String(call[0])),
        ];
        expect(heard.a.some((l) => l.startsWith("command.ran"))).toBe(true);
        expect(texts.length).toBeGreaterThan(50);
        const secrets = [MAP_A, MAP_B, CLUSTER, ...[first, second, third].flatMap((p) => [p, passwordText(p), passwordHash(p)])];
        for (const text of texts) for (const secret of secrets) expect(text.toUpperCase()).not.toContain(secret.toUpperCase());
      },
      ["perm.changed", "command.ran"],
    );
  } finally {
    out.mockRestore();
  }
});

// One restore

test("after A is restored, a new survivor gets no lost one's ID, group or password", async () => {
  await maps((m) => {
    const { cluster, b } = m;
    let a = m.a;
    const { session: ada } = cluster.survivor(a, "ada");
    const adaId = idIn(a, "ada");
    must(a, `Permissions.Add ${adaId} Admins`);
    const adas = claim(a, ada);
    commit(a);
    const backup = cluster.backup(a, "a-backup.db");
    const { session: cyd } = cluster.survivor(a, "cyd");
    const cydId = idIn(a, "cyd");
    must(a, `Permissions.Add ${cydId} Admins`);
    const cyds = claim(a, cyd);
    const before = new Set(b.h.host.permissions.allIssued().map((r) => r.id));
    const mark = a.h.host.permissions.marks(a.world).survivor;
    a = m.restoreA(backup);
    expect(a.log.some((l) => l.startsWith(`the save is behind the permissions register: survivor numbers go on from ${mark}, not `))).toBe(true);
    // A new survivor, and one with the lost one's name and browser key.
    const { session: dan } = cluster.survivor(a, "dan");
    const danId = idIn(a, "dan");
    const back = a.h.join("cyd", {}, { key: keyAt("cyd", a.world) });
    a.h.run(500);
    const newCyd = idIn(a, "cyd");
    for (const [session, id] of [[dan, danId], [back, newCyd]] as const) {
      expect(before.has(id)).toBe(false);
      expect(id).not.toBe(cydId);
      expect(a.h.host.permissions.groupsOf({ id, team: 0, signed: true, world: a.world }).map((g) => g.name)).toEqual(["Default"]);
      expect(a.h.host.permissions.secretOf(id)).toBe("");
      expect(a.h.say(session, "claimpassword")).toEqual([NO_STAFF]);
    }
    expect(danId).not.toBe(newCyd);
    expect(a.h.say(back, `enablecheats ${cyds}`)).toEqual([WRONG_PASSWORD]);
    expect(a.h.client(back)!.admin).toBe(false);
    // The lost survivor's ID stays in the register with its name, and its membership until an admin takes it out.
    expect(a.h.host.permissions.issued(cydId)?.name).toBe("cyd");
    expect(a.h.host.permissions.membersOf("survivor", cydId).map((x) => x.group)).toEqual(["Admins"]);
    expect(must(a, `Permissions.Remove ${cydId} Admins`)).toBe(`cyd (${cydId}) is out of Admins. cyd is not on this map now.`);
    // A survivor from before the backup keeps her ID, her groups and her password.
    const adaBack = a.h.join("ada", {}, { key: keyAt("ada", a.world) });
    a.h.run(500);
    expect(idIn(a, "ada")).toBe(adaId);
    signIn(a, adaBack, adas);
    expect([a.h.client(adaBack)!.rank, a.h.say(adaBack, "groups")]).toEqual([RANK_ADMIN, ["your groups: Admins, Default"]]);
  });
});

test("after A is restored, a new tribe inherits no lost tribe's number or group", async () => {
  await maps((m) => {
    const { cluster } = m;
    let a = m.a;
    cluster.survivor(a, "ada");
    const recOf = (s: Server, name: string) => rec(s, name)!;
    expect(a.h.host.tribes.create(recOf(a, "ada"), "Raptors")).toBe("");
    const raptors = recOf(a, "ada").team;
    must(a, "Permissions.AddGroup Vip");
    must(a, "Permissions.Grant Vip Kit.vip");
    must(a, "Permissions.AddGroup Gold");
    must(a, "Permissions.Grant Gold Kit.gold");
    must(a, `Permissions.AddTribe ${raptors} Vip`);
    commit(a);
    const backup = cluster.backup(a, "a-team-backup.db");
    cluster.survivor(a, "cyd");
    expect(a.h.host.tribes.create(recOf(a, "cyd"), "Lost")).toBe("");
    const lost = recOf(a, "cyd").team;
    must(a, `Permissions.AddTribe ${lost} Gold`);
    const mark = a.h.host.permissions.marks(a.world).team;
    a = m.restoreA(backup);
    expect(a.log.some((l) => l.startsWith(`the save is behind the permissions register: team numbers go on from ${mark}, not `))).toBe(true);
    const { session: dan } = cluster.survivor(a, "dan");
    expect(a.h.host.tribes.create(recOf(a, "dan"), "Dans")).toBe("");
    const dans = recOf(a, "dan").team;
    expect([dans === lost, dans === raptors]).toEqual([false, false]);
    const subject = a.h.host.subjectOf(a.h.client(dan)!)!;
    expect([a.h.host.permissions.has(subject, "Kit.gold"), a.h.host.permissions.has(subject, "Kit.vip")]).toEqual([false, false]);
    expect(a.h.host.permissions.membersOf("tribe", String(lost)).map((x) => x.group)).toEqual(["Gold"]);
    // A tribe from before the backup keeps its number and its group.
    const adaBack = a.h.join("ada", {}, { key: keyAt("ada", a.world) });
    a.h.run(500);
    expect(recOf(a, "ada").team).toBe(raptors);
    expect(a.h.host.permissions.has(a.h.host.subjectOf(a.h.client(adaBack)!)!, "Kit.vip")).toBe(true);
  });
});

// More attacks

test("A's map admin cannot reach B's staff, nor raise herself to the cluster", async () => {
  await maps((m) => {
    const { cluster, clock, a, b } = m;
    const mia = hostAdmin(a, cluster, "mia", MAP_A);
    const miaId = idIn(a, "mia");
    cluster.survivor(b, "dan");
    cluster.survivor(a, "ada");
    const [dan, adaId] = [idIn(b, "dan"), idIn(a, "ada")];
    must(a, "Permissions.AddGroup Owners");
    must(a, "Permissions.Rank Owners map");
    must(a, "Permissions.AddGroup Council");
    must(a, "Permissions.Rank Council cluster");
    poll(b, clock);
    // Dan is an admin on B by B's own grant, and Ada on every map by the cluster's.
    must(b, `Permissions.Add ${dan} Admins`);
    must(a, `Permissions.Add ${adaId} Admins all`);
    expect(a.h.say(mia, `Permissions.Remove ${dan} Admins`)).toEqual([`${dan} is not in Admins.`]);
    expect(a.h.say(mia, `Permissions.Remove ${adaId} Admins`)).toEqual([`${adaId} is not in Admins.`]);
    expect(b.h.host.permissions.membersOf("survivor", dan).map((x) => [x.group, x.world])).toEqual([["Admins", b.world]]);
    expect(a.h.host.permissions.membersOf("survivor", adaId).map((x) => [x.group, x.world])).toEqual([["Admins", 0]]);
    // She cannot put herself above the map's rank, nor make her own map rank count on B.
    expect(a.h.say(mia, `Permissions.Add ${miaId} Council`)).toEqual(["That needs the cluster rank."]);
    expect(a.h.say(mia, `Permissions.Add ${miaId} Owners`).some((l) => l.startsWith(`mia (${miaId}) is in Owners.`))).toBe(true);
    const hers = claim(a, mia);
    const there = cross(m, a, b, mia);
    expect(b.h.say(there, `enablecheats ${hers}`)).toEqual([NOT_HERE]);
    expect(b.h.client(there)!.rank).toBe(RANK_OPEN);
    expect(b.h.say(there, `Permissions.Add ${dan} Owners`)).toEqual(["denied: this needs the admin rank or above"]);
  });
});

test("A's admins clear the password of A's staff, and never of B's alone", async () => {
  await maps((m) => {
    const { cluster, clock, a, b } = m;
    const mia = hostAdmin(a, cluster, "mia", MAP_A);
    const { session: dan } = cluster.survivor(b, "dan");
    const { session: ada } = cluster.survivor(a, "ada");
    const [danId, adaId] = [idIn(b, "dan"), idIn(a, "ada")];
    // Dan is an admin on B alone, by B's own grant; Ada on A alone.
    must(b, `Permissions.Add ${danId} Admins`);
    must(a, `Permissions.Add ${adaId} Admins`);
    const [dans, adas] = [claim(b, dan), claim(a, ada)];
    signIn(b, dan, dans);
    signIn(a, ada, adas);
    poll(a, clock);
    const ELSEWHERE = "That survivor's staff groups are on other maps. An admin there or the cluster's clears their password.";
    // Neither A's map admin nor A's regular admin reaches him, and the attempt is in A's log.
    expect(a.h.say(mia, `Permissions.Password ${danId} clear`)).toEqual([ELSEWHERE]);
    expect(a.h.say(ada, `Permissions.Password ${danId} clear`)).toEqual([ELSEWHERE]);
    expect(keptActs(a).filter((act) => act.kind === "refused" && act.what.includes(danId)).map((act) => act.name)).toEqual(["mia", "ada"]);
    poll(b, clock);
    expect([b.h.client(dan)!.signed, b.h.host.permissions.secretOf(danId) !== ""]).toEqual([true, true]);
    // A's map admin clears the password of A's own staff, and the cluster's admin, from A, clears Dan's.
    expect(a.h.say(mia, `Permissions.Password ${adaId} clear`)).toEqual([`ada (${adaId}) has no password now`]);
    expect(a.h.client(ada)!.signed).toBe(false);
    expect(a.h.host.exec(`Permissions.Password ${danId} clear`)).toContain("has no password now");
    poll(b, clock);
    expect(b.h.client(dan)!.signed).toBe(false);
  });
});
