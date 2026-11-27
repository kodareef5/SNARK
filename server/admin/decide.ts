// The Decider page (client/admin/decide.ts): what the decider is doing, as JSON, and what an admin may do to it.
//
//   GET  /admin/decide.json        each point's policy and counts, the caps and the queue, the log, the three settings,
//                                  every profile with its hand rule and its trained scorer, the decide part's time, the
//                                  recent answers, and the lab's scoreboard and status where this checkout has them.
//                                  The board comes without its row for every layout played, which no page shows.
//                                  ?look=1 keeps answers for the next ten seconds, so they are kept only while a page looks
//   POST /admin/decide             {"op":"policy","point":"nav.ring","policy":"rule"}   one point's policy, or `*`'s; "" lets `*` decide it
//                                  {"op":"set","name":"DecideSample","value":"64"}     one of the three Decide settings
//                                  {"op":"reload"}                                    reads the trained weights again
//                                  {"op":"clone"}                                     copies the settings to every world of the cluster
//
// Every file here is read off the tick's thread: the handlers share it.

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { DECIDE_SETTINGS, POLICY_NAMES, STAR, withPolicy, type DecideJson, type ProfileJson } from "../../shared/admin-decide.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { Model } from "../../shared/decide/forward.ts";
import type { Profile } from "../../shared/decide/profile.ts";
import { PROFILES } from "../../shared/decide/profiles.ts";
import type { LabStatus, Scoreboard } from "../../shared/decide/scoreboard.ts";
import { PAGE_ACTOR, type Actor } from "../acts.ts";
import { settingsOf } from "../decide/shared.ts";
import type { Host } from "../host.ts";
import { originAllowed } from "../origin.ts";
import { rowOf } from "../settings/catalog.ts";
import { actorOf, onlyRead, stillHolds } from "./gate.ts";
import { PART } from "./parts.ts";

/** Ticks a look keeps answers for. */
export const LOOK_TICKS = 10 * TICK_RATE;
/** Wall ms a read of the lab's files stands. */
const FILES_MS = 5000;
const LAB = join(import.meta.dir, "../../.cache/decide");
const JSON_HEADERS = { "cache-control": "no-store", "content-type": "application/json" };

export interface DecideAdminOptions {
  /** The lab's folder: .cache/decide in this checkout where not given. */
  lab?: string;
  /** Wall ms. */
  now?: () => number;
}

/** A value read off the thread at most once in five seconds. */
class Lately<T> {
  private at = -Infinity;
  private value: Promise<T> | null = null;
  private readonly make: () => Promise<T>;
  constructor(make: () => Promise<T>) {
    this.make = make;
  }
  get(now: number): Promise<T> {
    if (this.value === null || now - this.at >= FILES_MS) {
      this.value = this.make();
      this.at = now;
    }
    return this.value;
  }
}

async function jsonOf<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** The lab's board as the page shows it: each episode's rows for every layout, most of the file, are left out. */
async function boardOf(path: string): Promise<Scoreboard | null> {
  const b = await jsonOf<Scoreboard>(path);
  try {
    for (const p of b?.points ?? []) for (const e of [...p.episodes, ...(p.fresh ?? [])]) delete e.layouts;
    return b;
  } catch {
    return null;
  }
}

/** What each of a scorer's inputs reads, in its order (shared/decide/forward.ts inputsAt). */
export function inputNames(p: Profile): string[] {
  const side = (at: string) => p.columns.map((c) => `${at} ${c}`);
  return [...p.state, ...p.columns, ...(p.ring ? [...side("left"), ...side("right")] : []), ...p.crosses.map(([a, b]) => `${a}*${b}`)];
}

function ruleOf(p: Profile, m: Model | undefined): ProfileJson["rule"] {
  if (!m || m.hidden !== 0) return null;
  const names = inputNames(p), round = (v: number) => Math.round(v * 1000) / 1000;
  return { weights: names.flatMap((n, i) => (m.w1[i] !== 0 ? [[n, round(m.w1[i]!)] as [string, number]] : [])), constant: round(m.b2) };
}

export class DecideAdmin {
  private readonly host: Host;
  private readonly now: () => number;
  private readonly lab: Lately<DecideJson["lab"]>;

  constructor(host: Host, o: DecideAdminOptions = {}) {
    this.host = host;
    this.now = o.now ?? Date.now;
    const lab = o.lab ?? LAB;
    // A board is a megabyte with its layouts, so it is read again only once its file has changed.
    let stamp = "", board: Scoreboard | null = null;
    this.lab = new Lately(async () => {
      const file = join(lab, "scoreboard.json");
      const [now, status] = await Promise.all([stat(file).then((f) => `${f.mtimeMs} ${f.size}`, () => ""), jsonOf<LabStatus>(join(lab, "status.json"))]);
      if (now !== stamp) [stamp, board] = [now, now === "" ? null : await boardOf(file)];
      return { scoreboard: board, status };
    });
  }

  /** The answer to `at`, or null where it is not this page's. */
  answer(req: Request, at: string, url: URL): Promise<Response> | null {
    if (at === "/admin/decide.json") {
      onlyRead(req);
      return this.json(url.searchParams.get("look") === "1").then((text) => new Response(text, { headers: JSON_HEADERS }));
    }
    if (at !== "/admin/decide" || req.method !== "POST") return null;
    const answer = (why: string, status = why === "" ? 200 : 400) => new Response(JSON.stringify({ ok: why === "", why }), { status, headers: JSON_HEADERS });
    // A change is taken only from a page this server served, as Cast's are.
    if (!originAllowed(req.headers.get("origin"), req.headers.get("host"), "")) return Promise.resolve(answer("open the admin page on this server", 403));
    const by = actorOf(req);
    return req.json().then(async (body: unknown) => {
      const lost = stillHolds(req, this.host);
      if (lost) return lost;
      const why = await this.act(body, by);
      // Every change writes its act, so a request that wrote none changed nothing.
      if (!this.host.acts.wroteFor(by)) onlyRead(req);
      return answer(why);
    }, () => answer("not JSON"));
  }

  /** The page's JSON. `look` keeps the answers of the next ten seconds; without a look they are let go once it ends. */
  async json(look: boolean): Promise<string> {
    const host = this.host, d = host.decide, tick = host.world.tick, now = this.now();
    if (look) d.look(tick, LOOK_TICKS);
    const lab = await this.lab.get(now);
    const r = d.report(), parts = host.game.parts, rules = host.rules;
    const profiles: ProfileJson[] = PROFILES.map((p) => {
      const m = d.trained.get(p.name);
      return {
        name: p.name, kind: p.kind, ring: p.ring, state: [...p.state], columns: [...p.columns], rule: ruleOf(p, d.rules.get(p.name)),
        trained: m ? { hidden: m.hidden, temperature: m.temperature, about: d.abouts.get(p.name) ?? null } : null,
      };
    });
    const json: DecideJson = {
      tick, rate: TICK_RATE, size: { x: host.world.hf.sizeX, z: host.world.hf.sizeZ },
      points: r.points, caps: [...r.caps], overflow: r.overflow, most: r.most, backMost: r.backMost, refused: r.refused, log: r.log,
      settings: { DecidePolicy: rules.text("DecidePolicy"), DecideSample: rules.num("DecideSample"), DecideLogMegabytes: rules.num("DecideLogMegabytes") },
      profiles,
      part: { all: Math.round(parts.all[PART.decide]! * 1000) / 1000, ticks: parts.ticks, worst: Math.round(parts.worst[PART.decide]! * 1000) / 1000 },
      recent: d.recent,
      lab,
      world: host.cluster?.world ?? 0,
      copied: host.decideCopy?.rev ?? 0,
    };
    return JSON.stringify(json);
  }

  /** Carries out an admin's action, writing an act as `by` for what it changed; "" when done, else why not. */
  async act(body: unknown, by: Actor = PAGE_ACTOR): Promise<string> {
    const host = this.host, d = host.decide;
    const b = (body ?? {}) as { op?: unknown; point?: unknown; policy?: unknown; name?: unknown; value?: unknown };
    if (b.op === "policy") {
      const point = typeof b.point === "string" ? b.point : "", policy = typeof b.policy === "string" ? b.policy.toLowerCase() : "";
      if (point !== STAR && !d.points.some((p) => p.name === point)) return `there is no decision point called ${point}`;
      if (policy !== "" && !(POLICY_NAMES as readonly string[]).includes(policy)) return `a policy is ${POLICY_NAMES.join(", ")}, or nothing to follow ${STAR}`;
      const was = host.rules.text("DecidePolicy"), text = withPolicy(was, point, policy);
      return text === was ? "" : host.pageSetting("DecidePolicy", text, by).why;
    }
    if (b.op === "set") {
      // A setting is named in any case, so it is known by its row, not by the spelling.
      const row = typeof b.name === "string" ? rowOf(b.name) : undefined;
      if (!row || !(DECIDE_SETTINGS as readonly string[]).includes(row.name)) return `only the Decide settings: ${DECIDE_SETTINGS.join(", ")}`;
      const words = String(b.value ?? "").trim();
      return words === settingsOf(host.rules)[row.name as (typeof DECIDE_SETTINGS)[number]] ? "" : host.pageSetting(row.name, words, by).why;
    }
    if (b.op === "reload") {
      d.reload();
      host.acts.write(by, `read the decider's weights again: ${d.trained.size} loaded, ${d.refused.length} refused`);
      return "";
    }
    if (b.op === "clone") {
      const copy = host.decideCopy;
      if (!copy) return "this world is in no cluster, so there is no other world to copy to";
      const { why, rev } = await copy.clone();
      if (why === "") host.acts.write(by, `copied the Decide settings to every world of the cluster (copy ${rev})`);
      return why;
    }
    return "unknown op";
  }
}
