// The version a client and a server must share: a hash of the source that lays out what crosses the wire.
// Layouts are written in all three of WIRE_FOLDERS: a writer in server/ and its reader in client/core count as much as shared/.
// Nobody writes it. A build gives it to the page (tools/build-client.ts); a server and an agent read their own source.

import { hashString } from "../hash.ts";

/**
 * `names` are the files under the wire folders at any depth, as paths from the checkout's top, and `read` gives the text of one. Only .ts files
 * count. A line ending or a path's separator changes nothing, so a checkout on Windows agrees with one on Linux.
 */
/** The folders whose source decides the wire. A change in any of them is a new version. */
export const WIRE_FOLDERS = ["shared", "server", "client/core"] as const;

export function wireOf(names: readonly string[], read: (name: string) => string): number {
  let hash = hashString("wire");
  for (const name of names.map((n) => n.replaceAll("\\", "/")).filter((n) => n.endsWith(".ts")).sort()) {
    hash = hashString(read(name).replaceAll("\r", ""), hashString(name, hash));
  }
  // 0 is a process that was never told its version (PROTOCOL_VERSION).
  return hash === 0 ? 1 : hash;
}
