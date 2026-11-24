// Every address a page of the wiki names must be there: another page, a file of the build, or a page the site around the
// worlds answers itself.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { BASE, SOURCE } from "./html.ts";

const ADDRESS = /\s(?:href|src|data-src|data-file|data-search|data-view|data-model-file|action)="(\/[^"]*)"/g;
/** The start screen, or a server's own game at the root of its host, and the page the source link goes to (server/main.ts). */
const SITE = new Set(["/", SOURCE]);

/** Throws, naming each, if a page names an address that is neither a page of `pages`, a file under `dist`, nor the site's. */
export function checkLinks(pages: ReadonlyMap<string, string>, dist: string): void {
  const missing = new Set<string>();
  for (const [path, html] of pages) {
    const paths = [...html.matchAll(ADDRESS)].map((match) => match[1]!);
    for (const match of html.matchAll(/\ssrcset="([^"]+)"/g)) {
      for (const candidate of match[1]!.split(",")) paths.push(candidate.trim().split(/\s+/)[0]!);
    }
    for (const url of paths) {
      const address = decodeURIComponent(url.split(/[?#]/)[0]!.replaceAll("&amp;", "&"));
      if (address.split("/").some((p) => p === "..")) missing.add(`${path}: ${address}`);
      else if (SITE.has(address)) continue;
      else if (address.endsWith("/") ? !address.startsWith(BASE) || !pages.has(address.slice(BASE.length)) : !existsSync(join(dist, address))) missing.add(`/${path} names ${address}`);
    }
  }
  if (missing.size > 0) throw new Error(`the wiki names what it does not have:\n${[...missing].slice(0, 20).join("\n")}`);
}
