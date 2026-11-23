// The picture tools drive the game's page by sending it script as text (DevTools' Runtime.evaluate, Playwright's
// evaluate), which the type check never reads. A field that moved off App broke them without a word: the film's clock
// threw on every view, and the lamp tool's turn did nothing. So every field of the page's App such a script names must
// be one App has.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { App } from "../../client/core/app.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const ROOT = join(import.meta.dir, "../..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
/** The string literals of a source file, roughly: enough to find a page script in. */
const STRINGS = /`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
const fieldOf = (name: string): RegExp => new RegExp(`(?<![\\w./])${name}\\??\\.(\\w+)`, "g");

/**
 * The App's fields named by the page scripts in the tools, and the files that name each: `snarkTrip.app.field`, a name
 * a script gives the app (`const a = snarkTrip.app;`), in that script, or in every script of the file where the one that
 * names it runs others' text (`const app = snarkTrip.app; ${js}`), and `${app}.field` where the tool keeps the app's path.
 */
function appFields(dir: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of walk(dir).filter((f) => /\.(ts|py)$/.test(f))) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("snarkTrip")) continue;
    const add = (field: string): void => void (found.get(field) ?? found.set(field, new Set()).get(field)!).add(relative(ROOT, file));
    const strings = [...text.matchAll(STRINGS)].map((m) => m[0]);
    const wide = new Set<string>();
    for (const s of strings) {
      for (const m of s.matchAll(/snarkTrip\??\.app\??\.(\w+)/g)) add(m[1]!);
      for (const m of s.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:window\.|globalThis\.)?snarkTrip\??\.app\s*[,;)](\s*\$\{\s*\w+\s*\})?/g)) {
        if (m[2]) wide.add(m[1]!);
        for (const u of s.matchAll(fieldOf(m[1]!))) add(u[1]!);
      }
    }
    for (const s of strings) for (const name of wide) for (const u of s.matchAll(fieldOf(name))) add(u[1]!);
    for (const m of text.matchAll(/const\s+(\w+)\s*=\s*"(?:window\.|globalThis\.)?snarkTrip\??\.app"/g)) {
      for (const u of text.matchAll(new RegExp(`\\$\\{${m[1]}\\}\\??\\.(\\w+)`, "g"))) add(u[1]!);
    }
  }
  return found;
}

test("every field of the app a tool's page script names is one the app has", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("owner", { latencyMs: 20 }, { manual: true }), h.reg, parsePack(corePackBytes()));
  const named = appFields(join(ROOT, "tools"));
  // The scan finds the scripts it is for: the film's clock, the lamp tool's turn, the report trip's bar, the map trip's scene.
  expect([...named.keys()]).toEqual(expect.arrayContaining(["holdEye", "eyeHeld", "holdLook", "ui", "scene", "session"]));
  const missing = [...named].filter(([field]) => !(field in app)).map(([field, files]) => `${field} in ${[...files].join(", ")}`);
  expect(missing).toEqual([]);
});
