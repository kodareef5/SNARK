// Travel between the servers of a cluster, as a page does it. The server hands the page a ticket (S_TRAVEL); the page goes to
// the other server's address with it, which only the page can work out, since only it knows how it reached this one; the page
// there reads the ticket back and says hello with it. The ticket rides in the address's fragment, which no server is sent.

import { TICKET_BYTES } from "../../shared/net/protocol.ts";

/** Another server of the cluster as /cluster.json lists it. `why` says why a survivor cannot go there now, "" if it can. */
export interface ClusterServer {
  world: number;
  name: string;
  map: string;
  port: number;
  url: string;
  players: number;
  max: number;
  why: string;
}

/** What /cluster.json answers: this server's world, name and public address, and the others running. World 0 for none. */
export interface ClusterList {
  world: number;
  name: string;
  url: string;
  port: number;
  servers: ClusterServer[];
}

/** What the shell gives the app of the page. */
export interface Page {
  /** location.origin, location.protocol and location.hostname. */
  origin: string;
  protocol: string;
  hostname: string;
  /** Goes to another address, leaving this page. */
  go(url: string): void;
  /** Takes the ticket out of the address once the survivor has arrived, so a reload joins as anyone does. */
  arrived(): void;
  /** Asks this page's server for the cluster. */
  cluster(): Promise<ClusterList>;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The address of server `to`. A page that came by this server's public address goes by the other's, if it has one; any other
 * goes to the other's port on the host it came by, which is right on this machine and on its network.
 */
export function serverAddress(list: ClusterList, to: ClusterServer, page: Pick<Page, "origin" | "protocol" | "hostname">): string {
  const origin = /^[a-z]+:\/\/[^/?#]+/i.exec(list.url)?.[0].toLowerCase() ?? "";
  if (origin !== "" && origin === page.origin.toLowerCase() && to.url !== "") return to.url;
  const host = page.hostname.includes(":") ? `[${page.hostname}]` : page.hostname;
  return `${page.protocol}//${host}:${to.port}`;
}

/** The page at `address` that a survivor named `name` arrives at with its ticket. */
export function arrivalAddress(address: string, name: string, ticket: Uint8Array): string {
  return `${address}/#travel=${hex(ticket)}&name=${encodeURIComponent(name)}`;
}

/** The page at `address` that joins as `name` with no ticket: one that went back, or goes to where its survivor is. */
export function joinAddress(address: string, name: string): string {
  return `${address}/?name=${encodeURIComponent(name)}`;
}

/** The ticket and name an arriving page's fragment carries (arrivalAddress), or null. */
export function arrivalOf(fragment: string): { ticket: Uint8Array; name: string } | null {
  const p = new Map<string, string>();
  for (const part of fragment.replace(/^#/, "").split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    try {
      p.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
    } catch {
      // A part that does not decode is not ours.
    }
  }
  const text = p.get("travel") ?? "";
  const name = p.get("name") ?? "";
  if (!new RegExp(`^[0-9a-f]{${TICKET_BYTES * 2}}$`, "i").test(text) || name === "") return null;
  const ticket = new Uint8Array(TICKET_BYTES);
  for (let i = 0; i < TICKET_BYTES; i++) ticket[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return { ticket, name };
}
