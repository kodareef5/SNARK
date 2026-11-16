// Travel between the servers of a cluster, as a page does it. The server hands the page a ticket (S_TRAVEL); the page goes to
// the other server's address with it, which only the page can work out, since only it knows how it reached this one; the page
// there reads the ticket back and says hello with it. The ticket rides in the address's fragment, which no server is sent.
// Beside it, the other addresses only the page can work out: its own server's sockets, and the links its menu shows.

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
  /** location.origin, location.protocol, location.hostname, location.host and location.pathname. */
  origin: string;
  protocol: string;
  hostname: string;
  host: string;
  pathname: string;
  /** Goes to another address, leaving this page. */
  go(url: string): void;
  /** Opens an address beside this page, which stays as it is: a link of the settings (SiteLink). */
  open?(url: string): void;
  /** Reconnects this page with its current address and browser identity. */
  reload?(): void;
  /** Takes the ticket out of the address once the survivor has arrived, so a reload joins as anyone does. */
  arrived(): void;
  /** A file of this page's server, beside the page: cluster.json, links.json. */
  json(name: string): Promise<unknown>;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The address of the socket `name` ("ws" or "voice") of the page's own server: beside the page, so under the path the server
 * is reached at when it is reached at one (server/site.ts placeOf).
 */
export function socketAddress(page: Pick<Page, "protocol" | "host" | "pathname">, name: string): string {
  return `${page.protocol === "https:" ? "wss" : "ws"}://${page.host}${page.pathname.slice(0, page.pathname.lastIndexOf("/") + 1)}${name}`;
}

/**
 * Whether a page at `host` and `pathname` came by the path `base` through what sends each path to its world (server/front.ts,
 * a tunnel's rules), and not straight to `port`, the port of the server reached at that path, which answers no other world.
 */
export function byPath(protocol: string, host: string, pathname: string, base: string, port: number): boolean {
  const at = Number(/:(\d+)$/.exec(host)?.[1] ?? (protocol === "https:" || protocol === "wss:" ? 443 : 80));
  return base.startsWith("/") && at !== port && (pathname === base || pathname.startsWith(`${base}/`));
}

/**
 * The address of server `to`. Servers reached at paths of one host (a public address that is a path, as /miami) list each
 * other by their paths: a page that came by this one's on the host in front of them goes by the other's there. A page that
 * came by this server's public address goes by the other's, if it has one. Any other goes to the other's port on the host it
 * came by, which is right on this machine and on its network.
 */
export function serverAddress(list: ClusterList, to: ClusterServer, page: Pick<Page, "origin" | "protocol" | "hostname" | "host" | "pathname">): string {
  if (to.url.startsWith("/") && byPath(page.protocol, page.host, page.pathname, list.url, list.port)) return `${page.origin}${to.url}`;
  const origin = /^[a-z]+:\/\/[^/?#]+/i.exec(list.url)?.[0].toLowerCase() ?? "";
  if (origin !== "" && origin === page.origin.toLowerCase() && to.url !== "") return to.url;
  const host = page.hostname.includes(":") ? `[${page.hostname}]` : page.hostname;
  // A server reached at a path answers its world only under it, at its port as anywhere.
  return `${page.protocol}//${host}:${to.port}${to.url.startsWith("/") ? to.url : ""}`;
}

/** A link the menu shows: what it is, and where it goes, as links.json gives it (WikiUrl, RepositoryUrl). */
export interface SiteLink {
  label: string;
  url: string;
}

/** The links of what links.json answers (server/site.ts linkOf), in the order the menu shows them, without those the operator hid. */
export function siteLinks(answer: unknown): SiteLink[] {
  const a = (answer ?? {}) as Record<string, unknown>;
  return ([["Wiki", a.wiki], ["Source code", a.repository]] as const).flatMap(([label, url]) => (typeof url === "string" && url !== "" ? [{ label, url }] : []));
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
