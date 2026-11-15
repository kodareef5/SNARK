// The agent's travel between the servers of a cluster, as a player does it: it walks to an obelisk's terminal, asks there to
// leave for a server its own lists, says hello at the other with the ticket it is handed, and chooses where to rise there.

import type { ClusterList, ClusterServer } from "../client/core/travel.ts";
import type { StructureStore } from "../shared/world/structures.ts";
import { TRAVEL_TERMINAL } from "../shared/world/obelisks.ts";
import type { Registry } from "../shared/content/registry.ts";
import { TAU, detCos, detSin } from "../shared/math/scalar.ts";
import type { ToolDef } from "./mcp.ts";

export const TRAVEL_DEFS: ToolDef[] = [
  { name: "servers", description: "The servers of this one's cluster: where you are, and each other server with its map, its players and whether you may go there now.", inputSchema: { type: "object", properties: {} } },
  {
    name: "travel",
    description: "Walk to the nearest obelisk's terminal in sight and leave there for another server of the cluster with all you carry. Your base and your tames stay behind. On the other server you rise where you choose, at a spawn point or a bed of your tribe's, and it answers once you stand there, where every tool then acts; status says where you are.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "The server's name or its map's, as servers lists it." },
        rise_at: { type: "string", description: "Where to rise there: a spawn point's or a bed's name. Left out: the first of your tribe's beds that is ready, else the first spawn point." },
      },
      required: ["to"],
    },
  },
];

/** The server of `list` that `to` names: its name, its map or its world's number, whatever the case. */
export function serverNamed(list: ClusterList, to: string): ClusterServer | undefined {
  const want = to.trim().toLowerCase();
  return list.servers.find((s) => s.name.toLowerCase() === want || s.map.toLowerCase() === want || String(s.world) === want);
}

/**
 * The socket of server `to`, for an agent whose own server's socket is `url`. One that came by its server's public address
 * goes by the other's, if it has one; any other goes to the other's port on the host it came by (serverAddress's rule).
 */
export function socketOf(url: string, list: ClusterList, to: ClusterServer): string {
  const at = new URL(url);
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
    other.pathname = at.pathname;
    return other.href;
  }
  at.port = String(to.port);
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
 * Which of the spawn screen's places to rise at: the one named `want`, or the first of the tribe's beds that is ready, else the
 * first place. `spawns` names the map's spawn points, which come first; the places after them are beds. -1 for a name not there.
 */
export function riseAt(places: readonly { name: string; wait: number }[], spawns: number, want = ""): number {
  if (want !== "") return places.findIndex((p) => p.name.toLowerCase() === want.trim().toLowerCase());
  const bed = places.findIndex((p, i) => i >= spawns && p.wait === 0);
  return bed >= 0 ? bed : 0;
}
