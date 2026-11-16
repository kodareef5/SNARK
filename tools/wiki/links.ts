// Every address a page of the wiki names must be there: another page, or a file of the build.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { BASE } from "./html.ts";

const ADDRESS = /\s(?:href|src|data-src|data-file|data-search)="(\/[^"]*)"/g;

/** Throws, naming each, if a page names an address that is neither a page of `pages` nor a file under `dist`. */
export function checkLinks(pages: ReadonlyMap<string, string>, dist: string): void {
  const missing = new Set<string>();
  for (const [path, html] of pages) {
    for (const m of html.matchAll(ADDRESS)) {
      const address = decodeURIComponent(m[1]!.split(/[?#]/)[0]!.replaceAll("&amp;", "&"));
      if (address.split("/").some((p) => p === "..")) missing.add(`${path}: ${address}`);
      else if (address.endsWith("/") ? !pages.has(address.slice(BASE.length)) : !existsSync(join(dist, address))) missing.add(`/${path} names ${address}`);
    }
  }
  if (missing.size > 0) throw new Error(`the wiki names what it does not have:\n${[...missing].slice(0, 20).join("\n")}`);
}
