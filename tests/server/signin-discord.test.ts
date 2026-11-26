// Signing in with Discord (server/signin/discord.ts) against a Discord made of maps (tests/fixtures/discord.ts).
import { afterAll, expect, test } from "bun:test";
import { defaultLook, setFace } from "../../shared/anim/look.ts";
import { hashKey } from "../../server/records.ts";
import { NOT_MEMBER, NOT_SET_UP, NO_ROLE, SIGN_IN, UNREACHABLE } from "../../server/signin/discord.ts";
import { SurvivorAccess, ownerOf } from "../../server/survivor-access.ts";
import { REJECT_DENIED, REJECT_SIGNIN } from "../../shared/net/protocol.ts";
import { TestCluster, keyAt, rec, travel } from "../fixtures/cluster.ts";
import { FakeDiscord, PAGE, discordReturn, discordWorld, hexKey, signInAs, signinPost, startSignIn } from "../fixtures/discord.ts";
import { Harness, testKey } from "../fixtures/net.ts";
import { loadConfig } from "../../server/settings/config.ts";

const ADA = "4400000000000000001";
const BEN = "4400000000000000002";
const SURVIVOR = "3300000000000000003";
const HELPER = "3300000000000000004";

/** Lets what waits on Discord's answer go on. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Joins `name` with `key` and says how it stands once Discord has answered about it. */
async function joined(h: Harness, name: string, key: Uint8Array): Promise<[string, number]> {
  const s = h.join(name, {}, { key });
  h.run(300);
  await settle();
  h.run(300);
  return [s.state, s.state === "closed" ? s.closeReason : 0];
}

const roster = async (h: Harness, key: Uint8Array): Promise<{ status: number; names: string[]; signin: boolean }> => {
  const req = new Request(`${PAGE}/survivors`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "roster", key: hexKey(key) }) });
  const res = await new SurvivorAccess(h.host).answer(req, "203.0.113.5");
  const body = (await res.json()) as { survivors?: { name: string }[]; signin?: boolean };
  return { status: res.status, names: (body.survivors ?? []).map((s) => s.name), signin: body.signin === true };
};

test("a browser joins only once it has signed in, and its survivor is its Discord account's", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const h = discordWorld(fake);
  const key = testKey("ada-laptop");
  expect(h.host.signin.entry()).toEqual({ method: "discord" });
  expect(await joined(h, "Ada", key)).toEqual(["closed", REJECT_SIGNIN]);
  expect(await roster(h, key)).toEqual({ status: 403, names: [], signin: true });
  expect((await signinPost(h.host, { action: "status", key: hexKey(key) })).body).toEqual({ method: "discord", signed: false, ok: false, why: "" });

  const { body, cookie } = await signinPost(h.host, { action: "start", key: hexKey(key) });
  const ask = new URL(String(body.url));
  expect(`${ask.origin}${ask.pathname}`).toBe("https://discord.com/oauth2/authorize");
  expect([ask.searchParams.get("client_id"), ask.searchParams.get("scope"), ask.searchParams.get("response_type"), ask.searchParams.get("redirect_uri")]).toEqual([fake.clientId, "identify", "code", `${PAGE}/signin/discord/callback`]);
  const state = ask.searchParams.get("state")!;
  expect(cookie).toMatch(/^__Host-.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
  expect(await discordReturn(h.host, `code=${fake.code(ADA, "Ada L")}&state=${state}`, cookie)).toBe(`/?signin=${state}`);
  expect((await signinPost(h.host, { action: "finish", key: hexKey(key), state })).body).toEqual({ method: "discord", signed: true, name: "Ada L", ok: true, why: "" });
  // The token Discord gave was handed back.
  expect(fake.calls.filter((c) => c.endsWith("/oauth2/token/revoke"))).toHaveLength(1);

  expect(await joined(h, "Ada", key)).toEqual(["active", 0]);
  expect(ownerOf(h.host.survivorRecord("Ada")!)).toBe(`discord:${ADA}`);
  expect(await roster(h, key)).toEqual({ status: 200, names: ["Ada"], signin: false });
});

test("only the browser that began a sign-in finishes it, once, and in time", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const clock = { ms: 1_700_000_000_000 };
  const h = discordWorld(fake, {}, clock);
  const [laptop, phone] = [testKey("laptop"), testKey("phone")];
  const { state, cookie } = await startSignIn(h.host, laptop);
  const other = await startSignIn(h.host, phone);
  const callback = `code=${fake.code(ADA, "Ada")}&state=${state}`;
  await discordReturn(h.host, callback, other.cookie);
  await discordReturn(h.host, callback);
  expect(fake.calls).toBeEmpty();
  expect((await signinPost(h.host, { action: "finish", key: hexKey(laptop), state })).status).toBe(409);
  expect(h.host.signin.method.subject(hashKey(laptop))).toBe("");
  await discordReturn(h.host, callback, cookie);
  expect((await signinPost(h.host, { action: "finish", key: hexKey(phone), state })).status).toBe(410);
  expect((await signinPost(h.host, { action: "finish", key: hexKey(laptop), state })).status).toBe(200);
  expect((await signinPost(h.host, { action: "finish", key: hexKey(laptop), state })).status).toBe(410);

  const late = await startSignIn(h.host, phone);
  expect((await signinPost(h.host, { action: "finish", key: hexKey(phone), state: late.state })).status).toBe(409);
  clock.ms += 601_000;
  await discordReturn(h.host, `code=${fake.code(ADA, "Ada")}&state=${late.state}`, late.cookie);
  expect((await signinPost(h.host, { action: "finish", key: hexKey(phone), state: late.state })).status).toBe(410);

  const refused = await startSignIn(h.host, phone);
  await discordReturn(h.host, `error=access_denied&state=${refused.state}`, refused.cookie);
  expect(await signinPost(h.host, { action: "finish", key: hexKey(phone), state: refused.state })).toEqual({ status: 403, body: { error: "Discord sign-in was cancelled." } });
  const forged = await startSignIn(h.host, phone);
  await discordReturn(h.host, `code=${fake.code(ADA, "Ada")}&state=${forged.state}&iss=${encodeURIComponent("https://evil.example")}`, forged.cookie);
  expect((await signinPost(h.host, { action: "finish", key: hexKey(phone), state: forged.state })).status).toBe(403);
  expect(await discordReturn(h.host, "code=x&state=nothing")).toBe("/?signin=nothing");
});

test("parallel returns exchange one code and a pending finish can be retried", async () => {
  const fake = new FakeDiscord();
  const pending = Promise.withResolvers<void>();
  fake.waitForCode = pending.promise;
  const h = discordWorld(fake);
  const key = testKey("ada");
  const { state, cookie } = await startSignIn(h.host, key);
  const query = `code=${fake.code(ADA, "Ada")}&state=${state}`;
  const first = discordReturn(h.host, query, cookie);
  await discordReturn(h.host, query, cookie);
  expect((await signinPost(h.host, { action: "finish", key: hexKey(key), state })).status).toBe(409);
  pending.resolve();
  await first;
  expect((await signinPost(h.host, { action: "finish", key: hexKey(key), state })).body.signed).toBe(true);
  expect(fake.calls.filter((c) => c.endsWith("/oauth2/token"))).toHaveLength(1);
});

test("one who is not in the Discord server, or lacks its role, is told why and kept out until that changes", async () => {
  const fake = new FakeDiscord();
  const clock = { ms: 1_700_000_000_000 };
  const h = discordWorld(fake, { DiscordRoles: `${SURVIVOR}, ${HELPER}` }, clock);
  const key = testKey("ada-laptop");
  expect((await signInAs(h.host, fake, key, ADA)).body).toMatchObject({ signed: true, ok: false, why: NOT_MEMBER });
  expect(await joined(h, "Ada", key)).toEqual(["closed", REJECT_SIGNIN]);
  expect((await roster(h, key)).status).toBe(403);

  fake.members.set(ADA, []);
  clock.ms += 11_000;
  expect((await signinPost(h.host, { action: "status", key: hexKey(key) })).body).toMatchObject({ ok: false, why: NO_ROLE });
  expect(await joined(h, "Ada", key)).toEqual(["closed", REJECT_SIGNIN]);

  fake.members.set(ADA, [HELPER]);
  clock.ms += 11_000;
  expect((await signinPost(h.host, { action: "status", key: hexKey(key) })).body).toMatchObject({ ok: true, why: "" });
  expect(await joined(h, "Ada", key)).toEqual(["active", 0]);
});

test("a role taken away keeps the next session out before it can act", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, [SURVIVOR]);
  const clock = { ms: 1_700_000_000_000 };
  const h = discordWorld(fake, { DiscordRoles: SURVIVOR }, clock);
  const key = testKey("ada-laptop");
  await signInAs(h.host, fake, key, ADA);
  fake.members.set(ADA, []);
  clock.ms += 11_000;
  const s = h.join("Ada", {}, { key });
  h.run(300);
  expect(s.state).not.toBe("active");
  expect(h.host.survivorRecord("Ada")).toBeUndefined();
  await settle();
  h.run(300);
  expect([s.state, s.closeReason]).toEqual(["closed", REJECT_SIGNIN]);
  const before = fake.calls.length;
  const again = h.join("Ada", {}, { key });
  h.run(300);
  expect([again.state, again.closeReason, fake.calls.length]).toEqual(["closed", REJECT_SIGNIN, before]);
});

test("a browser that leaves during a role check gets no session", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const clock = { ms: 1_700_000_000_000 };
  const h = discordWorld(fake, {}, clock);
  const key = testKey("ada");
  await signInAs(h.host, fake, key, ADA);
  clock.ms += 11_000;
  const pending = Promise.withResolvers<void>();
  fake.waitForMember = pending.promise;
  const session = h.join("Ada", {}, { key });
  h.run(300);
  expect(h.host.game.playerCount).toBe(0);
  session.close();
  h.run(300);
  pending.resolve();
  await settle();
  h.run(300);
  expect(h.host.game.playerCount).toBe(0);
  expect(h.host.survivorRecord("Ada")).toBeUndefined();
});

test("while Discord cannot be reached its last answer stands, and one it never answered about is not kept", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const clock = { ms: 1_700_000_000_000 };
  const h = discordWorld(fake, {}, clock);
  const [ada, ben] = [testKey("ada-laptop"), testKey("ben-laptop")];
  await signInAs(h.host, fake, ada, ADA);
  fake.down = true;
  clock.ms += 11_000;
  expect(await joined(h, "Ada", ada)).toEqual(["active", 0]);

  // Ben is signed in on a browser this world never asked Discord about, as one arriving from another address is.
  h.host.signin.method.carry(hashKey(ben), `discord:${BEN}`);
  expect(await joined(h, "Ben", ben)).toEqual(["closed", REJECT_SIGNIN]);
  expect((await signinPost(h.host, { action: "status", key: hexKey(ben) })).body).toMatchObject({ signed: true, ok: false, why: UNREACHABLE });

  const { state, cookie } = await startSignIn(h.host, testKey("cy-laptop"));
  await discordReturn(h.host, `code=${fake.code("4400000000000000003", "Cy")}&state=${state}`, cookie);
  expect(await signinPost(h.host, { action: "finish", key: hexKey(testKey("cy-laptop")), state })).toEqual({ status: 403, body: { error: UNREACHABLE } });
});

test("a returning Discord survivor keeps their face and wardrobe on a new device", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const h = discordWorld(fake);
  try {
    const laptop = testKey("wardrobe-laptop"), phone = testKey("wardrobe-phone");
    const look = defaultLook();
    setFace(look, 3, 0.65);
    await signInAs(h.host, fake, laptop, ADA);
    const first = h.join("Ada", {}, { key: laptop, look });
    h.run(600);
    expect(first.ownLook).toEqual(look);
    const ada = h.host.survivorRecord("Ada")!;
    const tee = h.reg.index.get("core:tee")!;
    const slot = h.host.items.inv(ada).wardrobe;
    expect(h.host.items.mintAt(ada, slot, tee, 1)).toBe(1);

    await signInAs(h.host, fake, phone, ADA);
    const back = h.join("Ada", {}, { key: phone });
    h.run(600);
    expect(back.ownLook).toEqual(look);
    expect(back.inventory!.item[back.inventory!.wardrobe]).toBe(tee);
  } finally {
    h.host.shutdown();
  }
});

test("an account's survivors follow it to another browser, and a signed-out browser is kept out", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []).set(BEN, []);
  const h = discordWorld(fake);
  const [laptop, phone] = [testKey("laptop"), testKey("phone")];
  await signInAs(h.host, fake, laptop, ADA);
  expect(await joined(h, "Ada", laptop)).toEqual(["active", 0]);
  await signInAs(h.host, fake, phone, ADA);
  expect((await roster(h, phone)).names).toEqual(["Ada"]);
  expect(await joined(h, "Ada", phone)).toEqual(["active", 0]);
  // Lending and recovering a survivor are the browser key's ways, and are not offered here.
  const pair = new Request(`${PAGE}/survivors`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pair", key: hexKey(phone) }) });
  expect((await new SurvivorAccess(h.host).answer(pair, "203.0.113.5")).status).toBe(400);

  // Ben signs in on Ada's laptop: her survivor is not his, though the laptop played it.
  await signInAs(h.host, fake, laptop, BEN, "Ben");
  expect((await roster(h, laptop)).names).toEqual([]);
  expect(await joined(h, "Ada", laptop)).toEqual(["closed", REJECT_DENIED]);

  expect((await signinPost(h.host, { action: "out", key: hexKey(phone) })).body).toMatchObject({ signed: false });
  expect(await joined(h, "Ada", phone)).toEqual(["closed", REJECT_SIGNIN]);
});

test("a survivor made before the server asked for Discord is taken by the account that signs in on its browser", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const h = discordWorld(fake, { SignIn: "key" });
  const key = testKey("ada-laptop");
  expect(await joined(h, "Ada", key)).toEqual(["active", 0]);
  expect(ownerOf(h.host.survivorRecord("Ada")!)).toBe("");
  expect(h.host.setSetting("SignIn", "discord")).toBe("");
  await signInAs(h.host, fake, key, ADA);
  expect((await roster(h, key)).names).toEqual(["Ada"]);
  expect(await joined(h, "Ada", key)).toEqual(["active", 0]);
  expect(ownerOf(h.host.survivorRecord("Ada")!)).toBe(`discord:${ADA}`);
  // Back on the browser key, the browsers that played it still own it.
  expect(h.host.setSetting("SignIn", "key")).toBe("");
  expect(await joined(h, "Ada", key)).toEqual(["active", 0]);
});

test("a server whose Discord settings are not whole lets nobody in, and says what is missing", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, [SURVIVOR]);
  const h = discordWorld(fake, { DiscordClientId: "" });
  const key = testKey("ada-laptop");
  expect(h.host.signin.method.admits(hashKey(key))).toBe(NOT_SET_UP);
  expect((await signinPost(h.host, { action: "start", key: hexKey(key) })).status).toBe(503);
  const lists = "discord: the application's redirects must list <the address players open>/signin/discord/callback";
  expect(await h.host.discord.report()).toEqual(["discord: DiscordClientId is not set to the application's id", lists]);
  expect(h.host.setSetting("DiscordClientId", fake.clientId)).toBe("");
  expect(h.host.signin.method.admits(hashKey(key))).toBe(SIGN_IN);
  expect(h.host.setSetting("DiscordRoles", `${SURVIVOR} 3300000000000000009`)).toBe("");
  expect(await h.host.discord.report()).toEqual([
    "discord: the bot Reef Gate is in Reef Club; asks for Survivor or 3300000000000000009, which is not a role there",
    `  ${SURVIVOR}  Survivor`,
    `  ${HELPER}  Helper`,
    lists,
  ]);
  expect(h.host.setSetting("DiscordGuild", "2200000000000000009")).toBe("");
  expect(await h.host.discord.report()).toEqual(["discord: DiscordGuild names no Discord server the bot can see", lists]);
  // A server told its own address names the redirect whole; one told only its path names the rest.
  for (const [page, redirect] of [["https://play.example/miami/", "https://play.example/miami/signin/discord/callback"], ["/miami", "<the address players open>/miami/signin/discord/callback"]] as const)
    expect(new Harness({}, 1, 60, { discord: { page } }).host.discord.redirect()).toBe(redirect);
  // A bot that cannot ask leaves one already signed in unanswered, so they are not let in.
  expect((await signInAs(h.host, fake, key, ADA)).body).toMatchObject({ signed: true, ok: false, why: NOT_SET_UP });
});

test("a role policy change discards previous grants while Discord is offline", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const h = discordWorld(fake);
  const key = testKey("ada");
  await signInAs(h.host, fake, key, ADA);
  fake.down = true;
  h.host.setSetting("DiscordRoles", SURVIVOR);
  expect(await joined(h, "Ada", key)).toEqual(["closed", REJECT_SIGNIN]);
  expect((await roster(h, key)).status).toBe(403);
  h.host.setSetting("DiscordRoles", "wrong-id");
  expect(h.host.signin.method.admits(hashKey(key))).toBe(NOT_SET_UP);
  expect(h.host.discord.fault()).toContain("DiscordRoles");
});

test("a browser's sign-in runs out after DiscordSignInDays", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const clock = { ms: 1_700_000_000_000 };
  const h = discordWorld(fake, { DiscordSignInDays: "2" }, clock);
  const key = testKey("ada-laptop");
  await signInAs(h.host, fake, key, ADA);
  clock.ms += 47 * 3_600_000;
  expect(await joined(h, "Ada", key)).toEqual(["active", 0]);
  clock.ms += 2 * 3_600_000;
  expect((await signinPost(h.host, { action: "status", key: hexKey(key) })).body).toMatchObject({ signed: false, ok: false });
  expect(await joined(h, "Ada", key)).toEqual(["closed", REJECT_SIGNIN]);
});

test("DiscordClientSecret and DiscordBotToken are read from the host's files, and nothing changes them while the server runs", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const { rules } = loadConfig({ gus: `[SnarkSettings]\nSignIn=discord\nDiscordClientId=${fake.clientId}\nDiscordGuild=${fake.guildId}\nDiscordClientSecret=${fake.secret}\nDiscordBotToken=${fake.botToken}\n` });
  const h = new Harness({}, 1, 60, { config: rules, discord: { fetch: fake.fetch } });
  for (const name of ["DiscordClientSecret", "DiscordBotToken"]) expect(h.host.setSetting(name, "other")).not.toBe("");
  const key = testKey("ada-laptop");
  expect((await signInAs(h.host, fake, key, ADA)).body).toMatchObject({ signed: true, ok: true });
  expect(await joined(h, "Ada", key)).toEqual(["active", 0]);
});

const cluster = new TestCluster();
afterAll(() => cluster.cleanup());

test("a survivor travelling to a world at another address is signed in there as its account", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []);
  const clock = { ms: 1_700_000_000_000 };
  const discord = { secret: fake.secret, botToken: fake.botToken, fetch: fake.fetch, now: () => clock.ms };
  const [a, b] = [cluster.server("Miami", "signin", clock, { host: { discord } }), cluster.server("Tampa", "signin", clock, { host: { discord } })];
  for (const s of [a, b]) for (const [name, words] of [["SignIn", "discord"], ["DiscordClientId", fake.clientId], ["DiscordGuild", fake.guildId]] as const) expect(s.h.host.setSetting(name, words)).toBe("");
  await signInAs(a.h.host, fake, keyAt("Ada", a.world), ADA);
  const { session } = cluster.survivor(a, "Ada");
  const ticket = travel(a, session, b.world) as Uint8Array;
  expect(ticket).toBeInstanceOf(Uint8Array);
  // The browser has another key at Tampa's address, which nobody signed in with.
  const there = keyAt("Ada", b.world);
  expect(b.h.host.signin.method.subject(hashKey(there))).toBe("");
  b.h.host.setSetting("DiscordRoles", SURVIVOR);
  const refused = b.h.join("Ada", {}, { key: there, ticket });
  b.h.run(300);
  await settle();
  b.h.run(300);
  expect(refused.closeReason).toBe(REJECT_SIGNIN);
  expect(rec(b, "Ada")).toBeUndefined();
  expect(b.h.host.signin.method.subject(hashKey(there))).toBe("");
  fake.members.set(ADA, [SURVIVOR]);
  clock.ms += 11_000;
  const arrived = b.h.join("Ada", {}, { key: there, ticket });
  b.h.run(400);
  await settle();
  b.h.run(300);
  expect(arrived.state).toBe("active");
  expect(b.h.host.signin.method.subject(hashKey(there))).toBe(`discord:${ADA}`);
  expect(ownerOf(rec(b, "Ada")!)).toBe(`discord:${ADA}`);
});

test("a world using browser keys leaves account verification to the destination", async () => {
  const fake = new FakeDiscord();
  fake.members.set(ADA, []).set(BEN, []);
  const clock = { ms: 1_700_000_000_000 };
  const discord = { secret: fake.secret, botToken: fake.botToken, fetch: fake.fetch, now: () => clock.ms };
  const a = cluster.server("Miami", "key-source", clock, { host: { discord } });
  const b = cluster.server("Tampa", "key-source", clock, { host: { discord } });
  for (const s of [a, b]) {
    s.h.host.setSetting("SignIn", "discord");
    s.h.host.setSetting("DiscordClientId", fake.clientId);
    s.h.host.setSetting("DiscordGuild", fake.guildId);
  }
  await signInAs(a.h.host, fake, keyAt("Ada", a.world), ADA);
  const { session } = cluster.survivor(a, "Ada");
  a.h.host.setSetting("SignIn", "key");
  const ticket = travel(a, session, b.world) as Uint8Array;
  const key = keyAt("Ada", b.world);
  const enter = async () => {
    const attempt = b.h.join("Ada", {}, { key, ticket });
    b.h.run(300);
    await settle();
    b.h.run(300);
    return attempt.state;
  };
  expect(await enter()).toBe("closed");
  expect(b.h.host.signin.method.subject(hashKey(key))).toBe("");
  await signInAs(b.h.host, fake, key, BEN);
  expect(await enter()).toBe("closed");
  expect(rec(b, "Ada")).toBeUndefined();
  await signInAs(b.h.host, fake, key, ADA);
  expect(await enter()).toBe("active");
});
