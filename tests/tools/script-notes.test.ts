// No comment text reaches a player (tools/script-notes.ts): a script's shader text loses its comments, trailing spaces
// and empty lines and keeps its indentation and its words, with the source map kept to match; other template text,
// strings and regular expressions are left as they were; the page loses its comments; and what is left is counted.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeMappings, encodeMappings, meaningChanged, pageNoteBytes, pageWithoutNotes, scriptNoteBytes, scriptText, squeezed } from "../../tools/script-notes.ts";

const SHADER = [
  "var s=`#version 300 es",
  "precision highp float;",
  "uniform vec3 uSun; // where the sun is",
  "",
  "/* a note */ float lit(vec3 n) {",
  "  // a whole line of note",
  "  return max(0.0, dot(n, uSun));   ",
  "  x = ${a}; // stays: a line holding an interpolation is left",
  "}",
  "`,t=`plain text // not a comment",
  "",
  "kept as it was`,r=/`\\/\\//g;",
  "",
  "let u=1;",
  "",
].join("\n");

test("shader text loses its notes and empty lines, keeping its indentation, its words and its source map's lines", () => {
  // A map that places every line at its start, as the minifier places template text.
  const map = encodeMappings(SHADER.split("\n").map((_, n) => [[0, 0, n, 0]]));
  const out = squeezed(SHADER, map);
  expect(out.js).toBe([
    "var s=`#version 300 es",
    "precision highp float;",
    "uniform vec3 uSun;",
    " float lit(vec3 n) {",
    "  return max(0.0, dot(n, uSun));",
    "  x = ${a}; // stays: a line holding an interpolation is left",
    "}",
    "`,t=`plain text // not a comment",
    "",
    "kept as it was`,r=/`\\/\\//g;",
    "let u=1;",
    "",
  ].join("\n"));
  expect(meaningChanged(SHADER, out.js)).toBeNull();
  // Each line kept still maps to the source line it came from.
  const before = SHADER.split("\n"), after = out.js.split("\n"), segs = decodeMappings(out.mappings);
  after.forEach((line, k) => {
    if (line.trim() !== "" && before.indexOf(line) >= 0) expect(segs[k]![0]![2]).toBe(before.indexOf(line));
  });
  expect(segs[2]![0]![2]).toBe(2);
  // The count: the notes and empty lines before; after, the note left on the line that holds an interpolation, which
  // the count still sees.
  expect(scriptNoteBytes(SHADER)).toBeGreaterThan(80);
  expect(scriptNoteBytes(out.js)).toBe(" // stays: a line holding an interpolation is left".length);
});

test("the reading of a script tells template text from strings, regular expressions and code", () => {
  const { templates, comments } = scriptText('a="`",b=/`[/]`/,c=`x${d({e:"}"})}y${`z`}`;/* c */');
  expect(templates.map((t) => t.pieces.length)).toEqual([3, 1]);
  expect(comments).toHaveLength(1);
  expect(meaningChanged("x=`a`", "x=`b`")).toContain("template 0 changed");
});

test("the page is sent without its comments, and is the page", () => {
  const page = readFileSync(join(import.meta.dir, "../../client/index.html"), "utf8")
    .replace("<!-- MODULES -->", '<link rel="modulepreload" href="main.js">')
    .replace("<!-- HUD_FONT_PRELOAD -->", "")
    .replace("/* HUD_FONT_FACES */", '@font-face { font-family: Hud; src: url("f.woff2") format("woff2"); }')
    .replace("FETCHED", JSON.stringify(["map.json", "assets/manifest.json"]));
  const sent = pageWithoutNotes(page);
  expect(sent).not.toContain("<!--");
  expect(/<style>[\s\S]*\/\*[\s\S]*<\/style>/.test(sent)).toBe(false);
  expect(/^\s*\/\//m.test(sent)).toBe(false);
  for (const kept of ['<link rel="modulepreload" href="main.js">', 'for (const href of ["map.json","assets/manifest.json"])', "@font-face", "#ui > button:focus-visible", '<script type="module" src="main.js"></script>']) expect(sent).toContain(kept);
  expect(pageNoteBytes(page)).toBeGreaterThan(300);
  expect(pageNoteBytes(sent)).toBe(0);
});
