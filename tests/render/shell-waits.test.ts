import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A query of the card waits for every command before it, which on a busy card is frames of work. The shell has no tests
// of its own (client/shell is the browser's), so this holds its text to the rule: in a frame it asks the card nothing
// but whether a fence has passed, and for an error only once one has (gl.ts `draw`).
test("the shell asks the card no question in a frame that would wait for it, but for an error once a fence has passed", () => {
  const text = readFileSync(join(import.meta.dir, "../../client/shell/gl.ts"), "utf8");
  const init = text.slice(text.indexOf("  init(): void {"), text.indexOf("\n  }\n", text.indexOf("  init(): void {")));
  const rest = text.replace(init, "");
  const count = (s: string, re: RegExp): number => s.match(re)?.length ?? 0;
  expect(count(text, /\bgetBufferParameter\(/g)).toBe(0);
  expect(count(rest, /\bgl\.getParameter\(|this\.gl\.getParameter\(/g)).toBe(0);
  expect(count(text, /\bgetError\(\)/g)).toBe(1);
  expect(text).toMatch(/const error = asked \? gl\.getError\(\) : gl\.NO_ERROR;/);
  expect(text).toMatch(/const asked = \(caught && this\.askFrame === this\.serial - 1\)/);
});
