// Every Chrome a tool launches is muted. Headless Chrome plays through the machine's speakers like any other, and the
// game's page starts its music by itself.
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

test("a tool that starts a headless Chrome starts it muted", () => {
  const loud: string[] = [];
  let launches = 0;
  for (const file of [...sources("tools"), ...sources("agent")]) {
    readFileSync(join(ROOT, file), "utf8").split("\n").forEach((line, i) => {
      if (!line.includes('"--headless=new"')) return;
      launches++;
      if (!line.includes('"--mute-audio"')) loud.push(`${file}:${i + 1}`);
    });
  }
  expect(launches).toBeGreaterThan(5);
  expect(loud).toEqual([]);
});
