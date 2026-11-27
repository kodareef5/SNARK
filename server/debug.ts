// The debug bar's route, `__debug` (client/core/debug/), and the server's state, which a bug report's server.json holds
// too. GET gives anyone the protocol's codes by name. POST gives an admin's session the server's log lines since a cursor
// and the server's state. The bar asks once a second while its drawer is open, over HTTP rather than the game's socket,
// so that it adds nothing to the stream it measures.

import { TICK_RATE } from "../shared/coords.ts";
import { codeNames, type DebugAnswer, type DecideState, type ServerState } from "../shared/debug.ts";
import * as P from "../shared/net/protocol.ts";
import { F_ALIVE, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import type { Connection } from "../shared/net/transport.ts";
import type { TickMeter } from "./admin/meter.ts";
import { PART, PARTS, measure, partsText } from "./admin/parts.ts";
import { bodiesOf } from "./admin/stats.ts";
import { mapLabel } from "./cluster/cluster.ts";
import type { Client } from "./game.ts";
import type { Host } from "./host.ts";
import type { ServerLog } from "./log.ts";
import { tokenSender } from "./reports.ts";

/** What GET answers, made once. */
const NAMES = JSON.stringify({ names: codeNames(P) });

/** Bytes a POST may be: a form of a token and a number. */
export const DEBUG_ASK_BYTES = 4096;

/** The long ticks given: those of the last two minutes, the latest 64 at most. */
const LONG_MS = 120_000, LONG_MOST = 64;

/** Metres about a survivor in which a mover may be the one it looks at, and how far off its facing it may be, in radians. */
const MOVER_METRES = 40, LOOKED_AT = 0.2;
/** Movers asked of the decider at most, the likeliest first. */
const MOVERS_ASKED = 8;

/** The mover nearest the survivor `e` faces, else the nearest to it, of those the decider says something of. */
function moverNear(host: Host, e: number, describe: (m: number) => Record<string, unknown> | null): DecideState["mover"] {
  const ents = host.world.ents;
  if (e < 0) return null;
  const x = ents.x[e]!, z = ents.z[e]!, yaw = (ents.yaw[e]! * 2 * Math.PI) / 65536, fx = Math.sin(yaw), fz = Math.cos(yaw);
  // One the survivor faces comes before any it does not, then the nearer.
  const near: { m: number; key: number; metres: number }[] = [];
  for (let m = 0; m < ents.cap; m++) {
    if (m === e || (ents.flags[m]! & F_ALIVE) === 0 || (ents.flags[m]! & (F_PLAYER | F_PROP)) !== 0) continue;
    const dx = ents.x[m]! - x, dz = ents.z[m]! - z, metres = Math.hypot(dx, dz);
    if (metres > MOVER_METRES) continue;
    const off = metres > 0.01 ? Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / metres))) : 0;
    near.push({ m, key: (off <= LOOKED_AT ? 0 : MOVER_METRES) + metres, metres });
  }
  const best = near.sort((a, b) => a.key - b.key).slice(0, MOVERS_ASKED);
  for (const b of best) {
    const about = describe(b.m);
    if (about) return { e: b.m, metres: Math.round(b.metres * 10) / 10, about };
  }
  return null;
}

/** The decider for the bar's Decide tab, and what it knows of the mover the survivor `e` is by. */
export function decideState(host: Host, e: number): DecideState {
  const d = host.decide, r = d.report();
  return {
    points: r.points.map((p) => ({ name: p.name, policy: p.policy, put: p.counts.put, answered: p.counts.answered, cut: p.counts.cut, backPut: p.counts.backPut, backCut: p.counts.backCut })),
    caps: [...r.caps], overflow: r.overflow, most: r.most, backMost: r.backMost,
    worst: Math.round(host.game.parts.worst[PART.decide]! * 100) / 100,
    mover: d.describe ? moverNear(host, e, d.describe) : null,
  };
}

/** The server's state as the session `c` asks for it: the connection and the survivor are its own; the decider where `decide`. */
export function serverState(host: Host, meter: TickMeter, c: Client, now = Date.now(), decide = false): ServerState {
  const conn = c.conn as Connection & { bytesSent?: number; skipped?: number; buffered?: number };
  const { world, game } = host, parts = game.parts, ents = world.ents, e = c.ent;
  return {
    at: new Date(now).toISOString(),
    world: { name: host.rules.text("SessionName") || mapLabel(world.reg, world.mapId), map: world.mapId, hash: world.mapHash, tick: world.tick, dev: host.dev, startedAt: new Date(meter.startedAt).toISOString(), online: game.playerCount },
    ticks: { rate: TICK_RATE, ran: meter.ticks, dropped: meter.dropped, seconds: meter.secondColumns() },
    long: parts.recent().filter((t) => t.at >= now - LONG_MS).slice(-LONG_MOST).map((t) => ({ ...t, whose: measure(parts.limit, t).whose, text: partsText(t) })),
    parts: { names: PARTS, all: Array.from(parts.all, (ms) => Math.round(ms * 100) / 100), ticks: parts.ticks, limit: parts.limit },
    bodies: bodiesOf(host),
    memory: process.memoryUsage(),
    connection: { sent: conn.bytesSent ?? 0, skipped: conn.skipped ?? 0, waiting: conn.buffered ?? 0 },
    survivor: e >= 0 ? { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, tick: world.tick } : null,
    ...(decide ? { decide: decideState(host, e) } : {}),
  };
}

/** What the route asks of the running server. */
export interface DebugServer {
  readonly log: ServerLog;
  /** The session whose voice token is `token` at speaker slot `slot` (server/voice.ts sessionOf), or null. */
  sender(slot: number, token: Uint8Array): Client | null;
  /** `decide` asks for the decider too. */
  state(sender: Client, decide: boolean): ServerState;
}

/**
 * The route `__debug`. A POST is a form, multipart or URL-encoded, of `token`, the session's voice token as "slot:hex",
 * `since`, the number of the last line the asker holds (0 or left out for none), and `decide`, 1 where the bar's Decide tab
 * is open. An admin's session is answered a DebugAnswer (shared/debug.ts); any other is refused.
 */
export async function debugAnswer(req: Request, server: DebugServer): Promise<Response> {
  if (req.method === "GET" || req.method === "HEAD") return new Response(NAMES, { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
  if (req.method !== "POST") return new Response("GET or POST", { status: 405, headers: { allow: "GET, HEAD, POST" } });
  // The length comes first, so a body nobody may send is not read.
  const length = Number(req.headers.get("content-length") ?? Number.NaN);
  if (!(length > 0)) return text(411, "an ask says its length");
  if (length > DEBUG_ASK_BYTES) return text(413, `an ask is ${DEBUG_ASK_BYTES} bytes at most`);
  let form: Awaited<ReturnType<Request["formData"]>>;
  try {
    form = await req.formData();
  } catch {
    return text(400, "not a form");
  }
  const sender = tokenSender(String(form.get("token") ?? ""), (slot, token) => server.sender(slot, token));
  if (!sender) return text(403, "this session is not one the server knows: reload the page");
  if (!sender.admin) return text(403, "the server's log is an admin's: enablecheats first");
  const asked = String(form.get("since") ?? "0");
  if (!/^\d{1,15}$/.test(asked)) return text(400, "since is the number of the last line held, or 0");
  const log = server.log, since = Number(asked);
  // A number past the last line is from an earlier run of this server.
  const answer: DebugAnswer = { lines: log.since(since > log.last ? 0 : since), next: log.last, server: server.state(sender, form.get("decide") === "1") };
  return Response.json(answer, { headers: { "cache-control": "no-store" } });
}

const text = (status: number, why: string): Response => new Response(why, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
