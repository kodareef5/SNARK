// The address a server listens on. A development server gives cheats without a password, so it answers this machine only
// unless it is asked to answer others.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type ServerOptions } from "../../server/main.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { splitPack } from "../../tools/pack/split.ts";

// A built client, as far as a server needs one: the manifest and the boot and clip files it names.
const dir = mkdtempSync(join(tmpdir(), "snark-listen-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const { files, manifest } = splitPack(corePackBytes(), "core");
mkdirSync(join(dir, "assets"));
for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));

/** This machine's address on a network, if it is on one. */
const outside = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === "IPv4" && !a.internal)?.address;

/** Whether a server started with `opts` answers at each address. */
async function answers(opts: ServerOptions, addresses: readonly string[]): Promise<boolean[]> {
  const server = startServer({ port: 0, clientDir: dir, probeScene: true, ...opts });
  try {
    const out: boolean[] = [];
    for (const address of addresses) {
      out.push(
        await fetch(`http://${address}:${server.port}/map.json`, { signal: AbortSignal.timeout(2000) }).then(
          (r) => r.ok,
          () => false,
        ),
      );
    }
    return out;
  } finally {
    server.stop();
  }
}

test("a development server answers this machine and no other, unless it is given an address to listen on", async () => {
  const from = outside ? ["127.0.0.1", outside] : ["127.0.0.1"];
  const yes = from.map(() => true);
  expect(await answers({ dev: true }, from)).toEqual(outside ? [true, false] : [true]);
  expect(await answers({ dev: true, hostname: "0.0.0.0" }, from)).toEqual(yes);
  // A server that is not for development has a password on its cheats or none at all, and answers everyone as before.
  expect(await answers({}, from)).toEqual(yes);
  expect(await answers({ hostname: "127.0.0.1" }, from)).toEqual(outside ? [true, false] : [true]);
});
