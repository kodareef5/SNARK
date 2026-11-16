// The agent's travel between the servers of a cluster, as a player does it: it walks to an obelisk's terminal, asks there to
// leave for a server its own lists, says hello at the other with the ticket it is handed, and chooses where to rise there.

import { byPath, type ClusterList, type ClusterServer } from "../client/core/travel.ts";
import type { StructureStore } from "../shared/world/structures.ts";
import { TRAVEL_TERMINAL } from "../shared/world/obelisks.ts";
import type { Registry } from "../shared/content/registry.ts";
import { TAU, detCos, detSin } from "../shared/math/scalar.ts";
import type { ToolDef } from "./mcp.ts";

export const TRAVEL_DEFS: ToolDef[] = [
  {
    name: "travel",
    title: "Travel to another server",
    description:
      "With no `to`: the servers of this one's cluster, where you are, and each other with its map, its players and whether you may go there now. With `to`: walk to the nearest obelisk's terminal in sight and leave there for that server with all you carry; your base and your tames stay behind. There you rise where you choose, at a spawn point or a bed of your tribe's, and it answers once you stand there, where every tool then acts.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "The server's name, its map's or its world's number, as the list gives them. Left out: list the servers." },
        rise_at: { type: "string", description: "Where to rise there: a spawn point's or a bed's name. Left out: the first of your tribe's beds that is ready, else the first spawn point." },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["done", "running", "blocked", "danger", "refused"] },
        reason: { type: "string" },
        here: { type: "string", description: "This server's name, when listing." },
        servers: { type: "array", items: { type: "object" }, description: "When listing: name, world, map, players, max, and cannot_go where you may not go." },
        arrived: { type: "string", description: "The server arrived at." },
        rose_at: { type: "string" },
      },
      required: ["state"],
    },
    annotations: { title: "Travel to another server", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

/** The server of `list` that `to` names: its name, its map or its world's number, whatever the case. */
export function serverNamed(list: ClusterList, to: string): ClusterServer | undefined {
  const want = to.trim().toLowerCase();
  return list.servers.find((s) => s.name.toLowerCase() === want || s.map.toLowerCase() === want || String(s.world) === want);
}

/**
 * The socket of server `to`, for an agent whose own server's socket is `url`. Servers reached at paths of one host go by
 * their paths on it; one that came by its server's public address goes by the other's, if it has one; any other goes to the
 * other's port on the host it came by (serverAddress's rule). A server's socket is ws under the path it is reached at.
 */
export function socketOf(url: string, list: ClusterList, to: ClusterServer): string {
  const at = new URL(url);
  if (to.url.startsWith("/") && byPath(at.protocol, at.host, at.pathname, list.url, list.port)) return new URL(`${to.url}/ws`, at).href;
  const host = (address: string): string => {
    try {
      return new URL(address).host.toLowerCase();
    } catch {
      return "";
    }
  };
  if (to.url !== "" && host(list.url) !== "" && host(list.url) === at.host.toLowerCase()) {
    const other = new URL(to.url);
    other.protocol = other.protocol === "https:" ? "wss:" : "ws:";
    other.pathname = `${other.pathname.replace(/\/+$/, "")}/ws`;
    return other.href;
  }
  at.port = String(to.port);
  // A server reached at a path answers its socket only under it, at its port as anywhere.
  if (to.url.startsWith("/")) at.pathname = `${to.url}/ws`;
  return at.href;
}

/** A terminal the agent can see: its ref, and the place in front of it to stand at. */
export interface Terminal {
  ref: number;
  x: number;
  z: number;
}

/** The nearest obelisk terminal among the structures this client has been sent, from (x, z), or null. */
export function nearestTerminal(structs: StructureStore, reg: Registry, x: number, z: number): Terminal | null {
  const kind = reg.index.get(TRAVEL_TERMINAL) ?? 0;
  let best: Terminal | null = null;
  let far = Infinity;
  structs.chunks.forEach((t, chunk) => {
    for (let s = 0; t && s < t.high; s++) {
      if (kind === 0 || t.kind[s] !== kind) continue;
      // A step in front of it, along the way it faces.
      const a = (t.yaw[s]! / 65536) * TAU;
      const fx = t.x[s]! + detSin(a) * 1.5;
      const fz = t.z[s]! + detCos(a) * 1.5;
      const d = Math.hypot(fx - x, fz - z);
      if (d < far) [far, best] = [d, { ref: chunk * 65536 + s, x: fx, z: fz }];
    }
  });
  return best;
}

/**
 * Which of the spawn screen's places to rise at: the one named `want`, or the first of the tribe's beds that is ready at `tick`,
 * else the first place. A bed is a place of a kind; a spawn point is of none. -1 for a name not there.
 */
export function riseAt(places: readonly { name: string; kind: number; readyAt: number }[], tick: number, want = ""): number {
  if (want !== "") return places.findIndex((p) => p.name.toLowerCase() === want.trim().toLowerCase());
  const bed = places.findIndex((p) => p.kind !== 0 && p.readyAt <= tick);
  return bed >= 0 ? bed : 0;
}
