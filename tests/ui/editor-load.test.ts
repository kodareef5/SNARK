import { expect, test } from "bun:test";
import { join } from "node:path";

async function freshPage(scenario: string): Promise<void> {
  const page = join(import.meta.dir, "../fixtures/editor-page.ts");
  const child = Bun.spawn([process.execPath, page, scenario], { stdout: "ignore", stderr: "pipe" });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code, error).toBe(0);
}

test("a fresh page queues plan messages and replays them in order", () => freshPage("plans"));

test("the first hotbar piece loads the editor and keeps a pending click", () => freshPage("placement"));
