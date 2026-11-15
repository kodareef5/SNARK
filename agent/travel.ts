// The agent's travel between the servers of a cluster, as a page does it (client/core/travel.ts): it asks its server which
// servers there are, asks to leave for one, and says hello at the other with the ticket it is handed.

import type { ClusterList, ClusterServer } from "../client/core/travel.ts";
import type { ToolDef } from "./mcp.ts";

export const TRAVEL_DEFS: ToolDef[] = [
  { name: "servers", description: "The servers of this one's cluster: where you are, and each other server with its map, its players and whether you may go there now.", inputSchema: { type: "object", properties: {} } },
  {
    name: "travel",
    description: "Leave for another server of the cluster with all you carry. Your base and your tames stay behind. It answers once you stand on the other server, where every tool then acts; status says where you are.",
    inputSchema: { type: "object", properties: { to: { type: "string", description: "The server's name or its map's, as servers lists it." } }, required: ["to"] },
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
