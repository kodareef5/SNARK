// The calls this server makes to Discord: the code a sign-in came back with traded for who signed in, and a bot token's
// questions about a Discord server and its members. Plain web requests: no bot is kept connected.

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const API = "https://discord.com/api/v10";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
export const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const ISSUER = "https://discord.com";
const TIMEOUT_MS = 8000;
/** The longest a call waits out Discord's rate limit before it gives up. */
const WAIT_MOST_MS = 3000;
const UNKNOWN_GUILD = 10004;

/** A Discord id: digits only, at most the 20 a 64-bit number takes. */
export const snowflake = (s: unknown): s is string => typeof s === "string" && /^\d{5,20}$/.test(s);

/**
 * A call that did not give an answer. `setup` is the host's to mend (a wrong secret or token, a bot not in the server);
 * otherwise Discord could not be reached or asked for patience, and the same call may work later.
 */
export class DiscordFault extends Error {
  readonly setup: boolean;
  constructor(message: string, setup: boolean) {
    super(message);
    this.setup = setup;
  }
}

export interface DiscordUser {
  readonly id: string;
  /** The display name, or the username where none is set. */
  readonly name: string;
}

export interface DiscordGuild {
  readonly name: string;
  readonly roles: readonly { id: string; name: string }[];
}

export class DiscordApi {
  private readonly fetch: Fetch;
  private readonly agent: string;
  /** Discord asked every call to wait until then. */
  private pausedUntil = 0;

  /** `site` goes in the User-Agent Discord asks of every client: the address this server is reached at. */
  constructor(fetch: Fetch = (url, init) => globalThis.fetch(url, init), site = "http://localhost") {
    this.fetch = fetch;
    this.agent = `DiscordBot (${site}, 1)`;
  }

  private async call(url: string, init: RequestInit, again = true): Promise<Response> {
    const wait = this.pausedUntil - Date.now();
    if (wait > WAIT_MOST_MS) throw new DiscordFault("Discord asked this server to wait", false);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    let res: Response;
    try {
      res = await this.fetch(url, { ...init, headers: { "user-agent": this.agent, ...(init.headers as Record<string, string>) }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new DiscordFault("Discord did not answer", false);
    }
    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as { retry_after?: unknown } | null;
      const seconds = typeof body?.retry_after === "number" ? body.retry_after : Number(res.headers.get("retry-after") ?? 1);
      this.pausedUntil = Date.now() + Math.min(60_000, Math.max(0, seconds * 1000 || 1000));
      if (again && this.pausedUntil - Date.now() <= WAIT_MOST_MS) return this.call(url, init, false);
      throw new DiscordFault("Discord asked this server to wait", false);
    }
    if (res.status >= 500) throw new DiscordFault(`Discord answered ${res.status}`, false);
    return res;
  }

  private asBot(token: string, path: string): Promise<Response> {
    return this.call(`${API}${path}`, { method: "GET", headers: { authorization: `Bot ${token}` } });
  }

  /** What a bot's call may not go on from: a token Discord does not know, or a server the bot is not in. */
  private async botFault(res: Response): Promise<DiscordFault | null> {
    if (res.status === 401) return new DiscordFault("Discord does not know DiscordBotToken", true);
    if (res.status === 403) return new DiscordFault("the bot is not in the Discord server DiscordGuild names", true);
    if (res.status === 404 && ((await res.clone().json().catch(() => null)) as { code?: unknown } | null)?.code === UNKNOWN_GUILD) return new DiscordFault("DiscordGuild names no Discord server the bot can see", true);
    return null;
  }

  /** Who signed in, for the code their browser came back with. The token Discord gives is used once and handed back. */
  async exchange(clientId: string, secret: string, code: string, redirect: string): Promise<DiscordUser> {
    const form = (fields: Record<string, string>): RequestInit => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: secret, ...fields }).toString() });
    const res = await this.call(TOKEN_URL, form({ grant_type: "authorization_code", code, redirect_uri: redirect }));
    if (res.status === 401) throw new DiscordFault("Discord does not know DiscordClientId with DiscordClientSecret", true);
    const grant = (res.ok ? await res.json().catch(() => null) : null) as { access_token?: unknown } | null;
    if (typeof grant?.access_token !== "string") throw new DiscordFault("Discord did not take the sign-in code", false);
    try {
      const me = await this.call(`${API}/users/@me`, { method: "GET", headers: { authorization: `Bearer ${grant.access_token}` } });
      const user = (me.ok ? await me.json().catch(() => null) : null) as { id?: unknown; username?: unknown; global_name?: unknown } | null;
      if (!snowflake(user?.id)) throw new DiscordFault("Discord did not say who signed in", false);
      const name = typeof user.global_name === "string" && user.global_name !== "" ? user.global_name : typeof user.username === "string" ? user.username : user.id;
      return { id: user.id, name: name.slice(0, 64) };
    } finally {
      void this.call(`${TOKEN_URL}/revoke`, form({ token: grant.access_token })).catch(() => {});
    }
  }

  /** The roles `user` holds in `guild`, or null for one who is not a member. */
  async member(token: string, guild: string, user: string): Promise<readonly string[] | null> {
    const res = await this.asBot(token, `/guilds/${guild}/members/${user}`);
    const fault = await this.botFault(res);
    if (fault) throw fault;
    if (res.status === 404) return null;
    const m = (res.ok ? await res.json().catch(() => null) : null) as { roles?: unknown } | null;
    if (!Array.isArray(m?.roles)) throw new DiscordFault(`Discord answered ${res.status} for a member`, false);
    return m.roles.filter(snowflake);
  }

  async guild(token: string, guild: string): Promise<DiscordGuild> {
    const res = await this.asBot(token, `/guilds/${guild}`);
    const fault = await this.botFault(res);
    if (fault) throw fault;
    const g = (res.ok ? await res.json().catch(() => null) : null) as { name?: unknown; roles?: unknown } | null;
    if (typeof g?.name !== "string") throw new DiscordFault(`Discord answered ${res.status} for the server`, false);
    const roles = Array.isArray(g.roles) ? (g.roles as { id?: unknown; name?: unknown }[]).filter((r) => snowflake(r?.id) && typeof r.name === "string").map((r) => ({ id: r.id as string, name: r.name as string })) : [];
    return { name: g.name, roles };
  }

  /** The name of the application a bot token belongs to. */
  async bot(token: string): Promise<string> {
    const res = await this.asBot(token, "/oauth2/applications/@me");
    if (res.status === 401) throw new DiscordFault("Discord does not know DiscordBotToken", true);
    const a = (res.ok ? await res.json().catch(() => null) : null) as { name?: unknown } | null;
    if (typeof a?.name !== "string") throw new DiscordFault(`Discord answered ${res.status} for the bot`, false);
    return a.name;
  }
}
