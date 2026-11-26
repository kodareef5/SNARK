// Discord as this server's calls see it: an application, its bot, one Discord server with roles and members, and the
// codes a sign-in comes back with. A test changes its fields and hands `fetch` to a host.

import type { Fetch } from "../../server/signin/discord-api.ts";
import type { Host } from "../../server/host.ts";
import { Harness } from "./net.ts";

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export class FakeDiscord {
  readonly clientId = "1100000000000000001";
  readonly secret = "app-secret";
  readonly botToken = "bot-token";
  readonly guildId = "2200000000000000002";
  guildName = "Reef Club";
  roles = [{ id: this.guildId, name: "@everyone" }, { id: "3300000000000000003", name: "Survivor" }, { id: "3300000000000000004", name: "Helper" }];
  /** Sign-in codes, each good once, and who they are for. */
  readonly codes = new Map<string, { id: string; username: string; global_name: string | null }>();
  /** Members of the server by id, with the roles they hold. One absent is not a member. */
  readonly members = new Map<string, string[]>();
  /** Every call fails as an unreachable Discord does. */
  down = false;
  waitForMember?: Promise<void>;
  waitForCode?: Promise<void>;
  /** The address of each call made, in order. */
  readonly calls: string[] = [];
  private readonly tokens = new Map<string, { id: string; username: string; global_name: string | null }>();

  /** A code that signs `id` in, named `name`. */
  code(id: string, name: string): string {
    const code = `code-${this.codes.size + this.tokens.size}-${id}`;
    this.codes.set(code, { id, username: name.toLowerCase(), global_name: name });
    return code;
  }

  readonly fetch: Fetch = async (url, init) => {
    this.calls.push(`${init.method} ${url}`);
    if (this.down) throw new Error("unreachable");
    const u = new URL(url);
    const auth = (init.headers as Record<string, string>).authorization ?? "";
    if (u.pathname === "/api/oauth2/token") {
      await this.waitForCode;
      const form = new URLSearchParams(String(init.body));
      if (form.get("client_id") !== this.clientId || form.get("client_secret") !== this.secret) return json({ error: "invalid_client" }, 401);
      const user = this.codes.get(form.get("code") ?? "");
      if (!user || form.get("grant_type") !== "authorization_code" || !form.get("redirect_uri")?.endsWith("/signin/discord/callback")) return json({ error: "invalid_grant" }, 400);
      this.codes.delete(form.get("code")!);
      const token = `token-${this.tokens.size}`;
      this.tokens.set(token, user);
      return json({ access_token: token, token_type: "Bearer", expires_in: 604800, refresh_token: "r", scope: "identify" });
    }
    if (u.pathname === "/api/oauth2/token/revoke") {
      this.tokens.delete(new URLSearchParams(String(init.body)).get("token") ?? "");
      return json({});
    }
    if (u.pathname === "/api/v10/users/@me") {
      const user = this.tokens.get(auth.replace(/^Bearer /, ""));
      return user ? json(user) : json({ message: "401: Unauthorized", code: 0 }, 401);
    }
    if (auth !== `Bot ${this.botToken}`) return json({ message: "401: Unauthorized", code: 0 }, 401);
    if (u.pathname === "/api/v10/oauth2/applications/@me") return json({ id: this.clientId, name: "Reef Gate" });
    const at = /^\/api\/v10\/guilds\/(\d+)(?:\/members\/(\d+))?$/.exec(u.pathname);
    if (!at) return json({ message: "404: Not Found", code: 0 }, 404);
    if (at[1] !== this.guildId) return json({ message: "Unknown Guild", code: 10004 }, 404);
    if (at[2] === undefined) return json({ id: this.guildId, name: this.guildName, roles: this.roles });
    await this.waitForMember;
    const roles = this.members.get(at[2]);
    return roles ? json({ roles, user: { id: at[2] } }) : json({ message: "Unknown Member", code: 10007 }, 404);
  };
}

export const hexKey = (key: Uint8Array): string => Buffer.from(key).toString("hex");

/** The clock a test's Discord sign-in reads. */
export interface SignInClock {
  ms: number;
}

/** A server that signs in with `fake`, asking for membership of its Discord server, with `set` over that. */
export function discordWorld(fake: FakeDiscord, set: Record<string, string> = {}, clock: SignInClock = { ms: 1_700_000_000_000 }): Harness {
  const h = new Harness({}, 1, 60, { discord: { secret: fake.secret, botToken: fake.botToken, fetch: fake.fetch, now: () => clock.ms } });
  for (const [name, words] of Object.entries({ SignIn: "discord", DiscordClientId: fake.clientId, DiscordGuild: fake.guildId, ...set })) {
    const why = h.host.setSetting(name, words);
    if (why !== "") throw new Error(why);
  }
  return h;
}

export const PAGE = "https://play.example";

/** A POST to /signin from the world's own page. */
export async function signinPost(host: Host, body: object, who = "203.0.113.5"): Promise<{ status: number; body: Record<string, unknown>; cookie?: string }> {
  const req = new Request(`${PAGE}/signin`, { method: "POST", headers: { "content-type": "application/json", origin: PAGE }, body: JSON.stringify(body) });
  const res = (await host.signin.method.answer({ req, url: new URL(req.url), path: "/signin", base: "", who }))!;
  const cookie = res.headers.get("set-cookie");
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, ...(cookie ? { cookie } : {}) };
}

/** The browser coming back from Discord with `query`. Returns where it is sent on to. */
export async function discordReturn(host: Host, query: string, cookie = ""): Promise<string> {
  const req = new Request(`${PAGE}/signin/discord/callback?${query}`, { headers: { cookie: cookie.split(";")[0]! } });
  const res = (await host.signin.method.answer({ req, url: new URL(req.url), path: "/signin/discord/callback", base: "", who: "203.0.113.5" }))!;
  if (res.status !== 302) throw new Error(`the callback answered ${res.status}`);
  return res.headers.get("location")!;
}

/** Begins a sign-in for `key`, and keeps its state and return cookie. */
export async function startSignIn(host: Host, key: Uint8Array): Promise<{ state: string; cookie: string }> {
  const { body, cookie } = await signinPost(host, { action: "start", key: hexKey(key) });
  if (!cookie) throw new Error("missing return cookie");
  return { state: new URL(String(body.url)).searchParams.get("state")!, cookie };
}

/** The whole sign-in of `key` as Discord account `id`: begun, back from Discord, finished. Returns what finishing said. */
export async function signInAs(host: Host, fake: FakeDiscord, key: Uint8Array, id: string, name = "Ada"): Promise<{ status: number; body: Record<string, unknown> }> {
  const { state, cookie } = await startSignIn(host, key);
  await discordReturn(host, `code=${fake.code(id, name)}&state=${state}&iss=${encodeURIComponent("https://discord.com")}`, cookie);
  return signinPost(host, { action: "finish", key: hexKey(key), state });
}
