// A bounded public projection of an already running host; this module opens no save, socket or timer.

import type { Host } from "../host.ts";
import { rowOf } from "../settings/catalog.ts";
import type { Rules } from "../settings/rules.ts";
import { PUBLIC_SETTINGS, validatePublicSnapshot, type PublicServerSnapshot, type PublicSetting } from "../../shared/pages/validate.ts";

export interface PublicCaptureSource {
  world: Pick<Host["world"], "mapId">;
  game: {
    clients: readonly ({ pid: number; active: boolean; closed: boolean } | null)[];
    opts: Pick<Host["game"]["opts"], "maxClients">;
  };
  records: { byPid: { get(pid: number): { name: string } | undefined } };
  rules: Pick<Rules, "text" | "valueOf">;
}
export interface PublicCaptureOptions { id: string; label?: string; sampledAt: string }

/** Call at a safe tick boundary, then hand the returned small record to a worker for serialization. */
export function capturePublicServer(host: PublicCaptureSource, options: PublicCaptureOptions): PublicServerSnapshot {
  if (host.game.clients.length > 10000) throw new Error("public snapshot active-client collection is too large");
  const players: string[] = [];
  for (const c of host.game.clients) {
    if (!c?.active || c.closed) continue;
    const rec = host.records.byPid.get(c.pid);
    if (rec) players.push(rec.name);
  }
  const settings: Partial<Record<PublicSetting, number | boolean>> = {};
  for (const key of PUBLIC_SETTINGS) {
    const row = rowOf(key);
    if (!row || row.status !== "live") continue;
    const value = host.rules.valueOf(row);
    if (typeof value === "number" || typeof value === "boolean") settings[key] = value;
  }
  return validatePublicSnapshot({ version: 1, servers: [{
    id: options.id,
    label: options.label ?? (host.rules.text("SessionName") || options.id),
    mapId: host.world.mapId,
    sampledAt: options.sampledAt,
    players,
    capacity: host.game.opts.maxClients,
    settings,
    stats: {},
  }] }).servers[0]!;
}
