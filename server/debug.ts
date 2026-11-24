// The debug bar's route, `__debug` (client/core/debug/), and the server's state, which a bug report's server.json holds
// too. GET gives anyone the protocol's codes by name. POST gives an admin's session the server's log lines since a cursor
// and the server's state. The bar asks once a second while its drawer is open, over HTTP rather than the game's socket,
// so that it adds nothing to the stream it measures.

import { TICK_RATE } from "../shared/coords.ts";
import { codeNames, type DebugAnswer, type ServerState } from "../shared/debug.ts";
import * as P from "../shared/net/protocol.ts";
import type { Connection } from "../shared/net/transport.ts";
import type { TickMeter } from "./admin/meter.ts";
import { PARTS, measure, partsText } from "./admin/parts.ts";
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

/** The server's state as the session `c` asks for it: the connection and the survivor are its own. */
export function serverState(host: Host, meter: TickMeter, c: Client, now = Date.now()): ServerState {
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
  };
}

/** What the route asks of the running server. */
export interface DebugServer {
  readonly log: ServerLog;
  /** The session whose voice token is `token` at speaker slot `slot` (server/voice.ts sessionOf), or null. */
  sender(slot: number, token: Uint8Array): Client | null;
  state(sender: Client): ServerState;
}

/**
 * The route `__debug`. A POST is a form, multipart or URL-encoded, of `token`, the session's voice token as "slot:hex",
 * and `since`, the number of the last line the asker holds (0 or left out for none). An admin's session is answered a
 * DebugAnswer (shared/debug.ts); any other is refused.
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
  const answer: DebugAnswer = { lines: log.since(since > log.last ? 0 : since), next: log.last, server: server.state(sender) };
  return Response.json(answer, { headers: { "cache-control": "no-store" } });
}

const text = (status: number, why: string): Response => new Response(why, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
