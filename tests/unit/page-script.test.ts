// The shape the page's script is held to (tools/page-script.ts, D1106): the first frame waits for main.js and page.js
// alone, and every late file takes what it shares with them from page.js's exports. The check's "script" step builds the
// script and asks these questions of it; here they are asked of small folders made to pass and to fail.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageScriptProblems, preloaded } from "../../tools/page-script.ts";

/** A folder of the given files, each page.js given a map that names its sources. */
function folder(files: Record<string, string>, pageSources = ["../core/app.ts"]): string {
  const dir = mkdtempSync(join(tmpdir(), "snark-page-script-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  writeFileSync(join(dir, "page.js.map"), JSON.stringify({ version: 3, sources: pageSources, mappings: "" }));
  return dir;
}

const MAIN = 'import{$a as x,$b as y}from"./page.js";import{$c as z}from"./page.js";x(y,z);import("./late.js");';
const PAGE = 'var a=1;function b(){return import("./other.js")}let c=`import{q}from"./nowhere.js"`;export{a as $a,b as $b,c as $c};';

test("a script as the build writes it passes", () => {
  const dir = folder({ "main.js": MAIN, "page.js": PAGE, "late.js": 'import{$a as q}from"./page.js";import{w}from"./chunk-x.js";q(w);', "chunk-x.js": "export const w=2;" });
  try {
    expect(preloaded(dir)).toEqual(["page.js"]);
    expect(pageScriptProblems(dir)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a split first frame, a page.js that imports or holds the entry, and a name page.js does not export each fail", () => {
  const dir = folder({ "main.js": `import{s}from"./chunk-s.js";${MAIN}`, "chunk-s.js": "export const s=1;", "page.js": `import{s}from"./chunk-s.js";${PAGE}`, "late.js": 'import{$d as q}from"./page.js";q();' }, ["../client/core/app.ts", "../client/shell/main.ts"]);
  try {
    const problems = pageScriptProblems(dir);
    expect(problems).toContain("the first frame waits for main.js and chunk-s.js, page.js, not main.js and page.js alone");
    expect(problems).toContain("page.js imports another file before it runs");
    expect(problems.some((p) => p.includes("shell's entry"))).toBe(true);
    expect(problems).toContain("late.js takes $d from page.js, which does not export it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
