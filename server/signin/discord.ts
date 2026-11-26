// Signing in with Discord. A browser is sent to Discord with a state this server made for its key, comes back with a code,
// and finishes with the same key: only then is the key signed in as that Discord account. Whether the account may join (in
// the host's Discord server, holding one of its roles) is asked of Discord with the bot's token, at sign-in and at each join.

import { randomBytes } from "node:crypto";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import { hashKey } from "../records.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { AUTHORIZE_URL, DiscordFault, ISSUER, snowflake, type DiscordApi, type DiscordUser } from "./discord-api.ts";
import type { SignInCall, SignInMethod } from "./method.ts";
import type { Link, SignInStore, Verdict } from "./store.ts";

export const DISCORD = "discord";
const PREFIX = `${DISCORD}:`;
/** A browser has this long to come back from Discord, and then this long to finish. */
const STATE_MS = 600_000;
const FINISH_MS = 120_000;
const STATES_MOST = 2048;
/** An answer from Discord is taken as still true for this long. */
const FRESH_MS = 10_000;
const ASKS_A_MINUTE = 30;
const DAY_MS = 86_400_000;
/** The most DiscordSignInDays may be. */
const DAYS_MOST = 365;

export const SIGN_IN = "Sign in with Discord to join this server.";
export const NOT_MEMBER = "Your Discord account is not in this server's Discord.";
export const NO_ROLE = "Your Discord account does not have the role this server asks for.";
export const NOT_SET_UP = "Discord sign-in is not set up on this server yet.";
export const UNREACHABLE = "Discord could not be reached. Try again in a moment.";

export interface DiscordConfig {
  readonly clientId: string;
  readonly secret: string;
  readonly botToken: string;
  /** The Discord server whose members may join, or "" for any Discord account. */
  readonly guild: string;
  /** Any one of these roles is enough. None asks only for membership. */
  readonly roles: readonly string[];
  /** Days a browser stays signed in. */
  readonly days: number;
}

/** A setting's words as a list of Discord ids, and the words that are not ids. */
export function idsOf(words: string): { ids: string[]; bad: string[] } {
  const ids: string[] = [];
  const bad: string[] = [];
  for (const w of words.split(/[\s,]+/).filter(Boolean)) (snowflake(w) ? ids : bad).push(w);
  return { ids, bad };
}

export interface DiscordContext {
  readonly store: SignInStore;
  /** This world's number: each world keeps its own answers. */
  readonly world: number;
  /** Read at each use, so settings change it while the server runs. */
  readonly config: () => DiscordConfig;
  readonly api: DiscordApi;
  readonly say: (line: string) => void;
  readonly now?: () => number;
}

/** A sign-in on its way: begun by a key, back from Discord or not, and not yet finished. */
interface Pending {
  /** The key hash that began it, in hex. */
  readonly key: string;
  readonly redirect: string;
  /** What the state is for. A later flow (a tribe's log to a channel) is another purpose. */
  readonly purpose: "signin";
  until: number;
  user: DiscordUser | null;
  why: string;
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const keyOf = (s: unknown): Uint8Array | null => (typeof s === "string" && new RegExp(`^[0-9a-f]{${KEY_BYTES * 2}}$`, "i").test(s) ? Uint8Array.from(Buffer.from(s, "hex")) : null);

export class DiscordSignIn implements SignInMethod {
  readonly id = DISCORD;
  private readonly ctx: DiscordContext;
  private readonly now: () => number;
  private readonly pending = new Map<string, Pending>();
  private readonly asking = new Map<string, Promise<Verdict>>();
  private readonly asks = new Map<string, { until: number; n: number }>();
  private complained = 0;

  constructor(ctx: DiscordContext) {
    this.ctx = ctx;
    this.now = ctx.now ?? Date.now;
  }

  /** What is missing from the host's settings, or "". */
  fault(): string {
    const c = this.ctx.config();
    if (!snowflake(c.clientId)) return "DiscordClientId is not set to the application's id";
    if (c.secret === "") return "DiscordClientSecret is not set";
    if (c.guild !== "" && !snowflake(c.guild)) return "DiscordGuild is not a Discord server's id";
    if (c.guild !== "" && c.botToken === "") return "DiscordBotToken is not set, and DiscordGuild needs it";
    if (c.guild === "" && c.roles.length > 0) return "DiscordRoles needs DiscordGuild, the Discord server the roles are in";
    return "";
  }

  private linked(key: string): Link | null {
    const link = this.ctx.store.link(key);
    return link && link.subject.startsWith(PREFIX) && this.now() - link.at <= this.ctx.config().days * DAY_MS ? link : null;
  }

  admits(keyHash: Uint8Array): string {
    if (this.fault() !== "") return NOT_SET_UP;
    const link = this.linked(hex(keyHash));
    if (!link) return SIGN_IN;
    if (this.ctx.config().guild === "") return "";
    // One never asked about here comes in, and `joined` asks: a survivor travelling in has no page to ask from.
    const v = this.ctx.store.verdict(this.ctx.world, link.subject);
    return v && !v.ok ? v.why : "";
  }

  subject(keyHash: Uint8Array): string {
    return this.linked(hex(keyHash))?.subject ?? "";
  }

  carry(keyHash: Uint8Array, subject: string): void {
    if (subject.startsWith(PREFIX)) this.ctx.store.bind(hex(keyHash), subject, this.ctx.store.nameOf(subject), this.now());
  }

  joined(keyHash: Uint8Array, refuse: () => void): void {
    const link = this.linked(hex(keyHash));
    if (!link) return refuse();
    void this.check(link.subject).then((v) => void (v.ok || refuse()));
  }

  private complain(e: DiscordFault): void {
    if (this.now() - this.complained < 60_000) return;
    this.complained = this.now();
    this.ctx.say(`discord: ${e.message}${e.setup ? ": nobody new can be checked until it is mended" : ""}`);
  }

  /** May `subject` join this world? Asked of Discord unless it answered a moment ago. Where it cannot answer, its last answer stands. */
  check(subject: string): Promise<Verdict> {
    const c = this.ctx.config();
    const at = this.now();
    if (c.guild === "") return Promise.resolve({ ok: true, why: "", at });
    const last = this.ctx.store.verdict(this.ctx.world, subject);
    if (last && at - last.at < FRESH_MS) return Promise.resolve(last);
    let asking = this.asking.get(subject);
    if (!asking) {
      asking = this.ask(c, subject, last).finally(() => this.asking.delete(subject));
      this.asking.set(subject, asking);
    }
    return asking;
  }

  private async ask(c: DiscordConfig, subject: string, last: Verdict | null): Promise<Verdict> {
    try {
      const roles = await this.ctx.api.member(c.botToken, c.guild, subject.slice(PREFIX.length));
      const why = roles === null ? NOT_MEMBER : c.roles.length > 0 && !c.roles.some((r) => roles.includes(r)) ? NO_ROLE : "";
      const v = { ok: why === "", why, at: this.now() };
      this.ctx.store.judge(this.ctx.world, subject, v);
      return v;
    } catch (e) {
      if (!(e instanceof DiscordFault)) throw e;
      this.complain(e);
      return last ?? { ok: false, why: e.setup ? NOT_SET_UP : UNREACHABLE, at: this.now() };
    }
  }

  /** What the entry page is told of a key: signed in or not, as whom, and whether it may join. */
  private async status(key: string): Promise<Response> {
    const link = this.linked(key);
    if (!link) return entryReply({ method: DISCORD, signed: false, ok: false, why: this.fault() === "" ? "" : NOT_SET_UP });
    const v = this.fault() === "" ? await this.check(link.subject) : { ok: false, why: NOT_SET_UP };
    return entryReply({ method: DISCORD, signed: true, name: link.name, ok: v.ok, why: v.why });
  }

  answer(call: SignInCall): Promise<Response> | Response | null {
    if (call.path === "/signin/discord/callback") return call.req.method === "GET" ? this.callback(call) : entryReply({ error: "Use GET" }, 405);
    if (call.path !== "/signin") return null;
    return call.req.method === "POST" ? this.post(call) : entryReply({ error: "Use POST" }, 405);
  }

  private async post(call: SignInCall): Promise<Response> {
    let data: Record<string, unknown>;
    try {
      data = await readEntryJson(call.req);
    } catch {
      return entryReply({ error: "Invalid request" }, 400);
    }
    const raw = keyOf(data.key);
    if (!raw) return entryReply({ error: "Browser identity unavailable" }, 400);
    const key = hex(hashKey(raw));
    const now = this.now();
    for (const [state, p] of this.pending) if (p.until <= now) this.pending.delete(state);
    for (const [who, a] of this.asks) if (a.until <= now) this.asks.delete(who);
    const asks = this.asks.get(call.who) ?? { until: now + 60_000, n: 0 };
    if ((!this.asks.has(call.who) && this.asks.size >= 4096) || ++asks.n > ASKS_A_MINUTE) return entryReply({ error: "Try again in a minute" }, 429);
    this.asks.set(call.who, asks);

    if (data.action === "status") return this.status(key);
    if (data.action === "out") {
      this.ctx.store.unbind(key);
      return entryReply({ method: DISCORD, signed: false, ok: false, why: "" });
    }
    if (data.action === "start") {
      if (this.fault() !== "") return entryReply({ error: NOT_SET_UP }, 503);
      // The page's own address is where Discord sends it back. Discord refuses one the application does not list.
      let origin: URL;
      try {
        origin = new URL(call.req.headers.get("origin") ?? "");
      } catch {
        return entryReply({ error: "Open this world's page in a browser to sign in" }, 400);
      }
      if (origin.protocol !== "https:" && origin.protocol !== "http:") return entryReply({ error: "Open this world's page in a browser to sign in" }, 400);
      if (this.pending.size >= STATES_MOST) return entryReply({ error: "Try again shortly" }, 429);
      // The store is the cluster's, and another world may keep a sign-in for longer than this one: only what none keeps goes.
      this.ctx.store.expire(now - DAYS_MOST * DAY_MS);
      const state = randomBytes(16).toString("hex");
      const redirect = `${origin.origin}${call.base}/signin/discord/callback`;
      this.pending.set(state, { key, redirect, purpose: "signin", until: now + STATE_MS, user: null, why: "" });
      const ask = new URLSearchParams({ response_type: "code", client_id: this.ctx.config().clientId, scope: "identify", state, redirect_uri: redirect, prompt: "none" });
      return entryReply({ url: `${AUTHORIZE_URL}?${ask}` });
    }
    if (data.action === "finish") {
      const state = typeof data.state === "string" ? data.state : "";
      const p = this.pending.get(state);
      // Only the key that began a sign-in ends it: a link sent to someone else signs nobody in as them.
      if (!p || p.key !== key) return entryReply({ error: "That sign-in ran out. Start it again." }, 410);
      if (!p.user && p.why === "") return entryReply({ error: "Discord has not answered yet." }, 409);
      this.pending.delete(state);
      if (!p.user) return entryReply({ error: p.why }, 403);
      this.ctx.store.bind(key, PREFIX + p.user.id, p.user.name, now);
      return this.status(key);
    }
    return entryReply({ error: "Unknown action" }, 400);
  }

  /** Discord sends the browser here. It is sent on to the entry page, which finishes with its key. */
  private async callback(call: SignInCall): Promise<Response> {
    const q = call.url.searchParams;
    const state = q.get("state") ?? "";
    const back = new Response(null, { status: 302, headers: { location: `${call.base}/?signin=${encodeURIComponent(state.slice(0, 64))}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    const p = this.pending.get(state);
    if (!p || p.until <= this.now() || p.user || p.why !== "") return back;
    const code = q.get("code");
    const iss = q.get("iss");
    if (iss !== null && iss !== ISSUER) p.why = "That sign-in did not come from Discord.";
    else if (!code) p.why = q.get("error") === "access_denied" ? "Discord sign-in was cancelled." : "Discord did not sign you in.";
    else {
      // Kept from a second use while Discord is asked.
      p.why = UNREACHABLE;
      const c = this.ctx.config();
      try {
        p.user = await this.ctx.api.exchange(c.clientId, c.secret, code.slice(0, 512), p.redirect);
        p.why = "";
      } catch (e) {
        if (!(e instanceof DiscordFault)) throw e;
        this.complain(e);
        if (e.setup) p.why = NOT_SET_UP;
      }
    }
    p.until = this.now() + FINISH_MS;
    return back;
  }

  /** The setup as Discord sees it, a line each, for the host to read. */
  async report(): Promise<string[]> {
    const c = this.ctx.config();
    const fault = this.fault();
    if (fault !== "") return [`discord: ${fault}`];
    if (c.guild === "") return ["discord: any Discord account may join (DiscordGuild is not set)"];
    try {
      const bot = await this.ctx.api.bot(c.botToken);
      const guild = await this.ctx.api.guild(c.botToken, c.guild);
      const named = new Map(guild.roles.map((r) => [r.id, r.name]));
      const asked = c.roles.length === 0 ? "any member may join" : `asks for ${c.roles.map((r) => (named.has(r) ? named.get(r) : `${r}, which is not a role there`)).join(" or ")}`;
      return [`discord: the bot ${bot} is in ${guild.name}; ${asked}`, ...guild.roles.filter((r) => r.id !== c.guild).map((r) => `  ${r.id}  ${r.name}`)];
    } catch (e) {
      if (!(e instanceof DiscordFault)) throw e;
      return [`discord: ${e.message}`];
    }
  }
}
