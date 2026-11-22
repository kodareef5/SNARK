// The version a client and a server must share: a hash of the source under shared/, where the wire's layouts are.
// Nobody writes it. A build gives it to the page (tools/build-client.ts); a server and an agent read their own source.

import { hashString } from "../hash.ts";

/**
 * `names` are the files under shared/ at any depth, as paths from it, and `read` gives the text of one. Only .ts files
 * count. A line ending or a path's separator changes nothing, so a checkout on Windows agrees with one on Linux.
 */
export function wireOf(names: readonly string[], read: (name: string) => string): number {
  let hash = hashString("wire");
  for (const name of names.map((n) => n.replaceAll("\\", "/")).filter((n) => n.endsWith(".ts")).sort()) {
    hash = hashString(read(name).replaceAll("\r", ""), hashString(name, hash));
  }
  // 0 is a process that was never told its version (PROTOCOL_VERSION).
  return hash === 0 ? 1 : hash;
}
