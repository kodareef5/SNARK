// The version a client and a server share is a hash of the source that lays out the wire (shared/net/wire.ts): nobody writes it,
// a build gives it to the page, and a server run from source reads its own.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtWire, serverWire, sourceWire, wireFiles } from "../../server/wire.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { PROTOCOL_VERSION, REJECT_VERSION, S_REJECT, stampWire, writeHello } from "../../shared/net/protocol.ts";
import { CH_RELIABLE } from "../../shared/net/transport.ts";
import { wireOf } from "../../shared/net/wire.ts";
import { Harness, testKey } from "../fixtures/net.ts";

const root = join(import.meta.dir, "../..");
const names = wireFiles(root);
const read = (name: string): string => readFileSync(join(root, name), "utf8");
const dir = mkdtempSync(join(tmpdir(), "snark-wire-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the wire version changes with any source that lays out the wire", () => {
  const own = wireOf(names, read);
  expect(own).toBe(sourceWire(root)!);
  expect(own).toBe(wireOf(names.map((n) => n.replaceAll("/", "\\")).reverse(), (n) => read(n).replaceAll("\n", "\r\n")));
  // A writer in server/ and its reader in client/core lay out bytes too: a field widened in both must be a new version.
  for (const changed of ["shared/net/protocol.ts", "shared/sim/character.ts", "shared/world/mapfile.ts", "server/own.ts", "client/core/session.ts"]) {
    expect(names).toContain(changed);
    expect([changed, wireOf(names, (n) => (n === changed ? `${read(n)}\n` : read(n))) === own]).toEqual([changed, false]);
  }
  expect(wireOf([...names, "shared/net/new.ts"], (n) => (n === "shared/net/new.ts" ? "" : read(n)))).not.toBe(own);
  // What is no source is not read.
  expect(wireOf([...names, "server/notes.md"], (n) => (n === "server/notes.md" ? "words" : read(n)))).toBe(own);
});

test("a server without its source takes its client's wire version", () => {
  const own = sourceWire(root)!;
  const client = join(dir, "dist");
  mkdirSync(client);
  expect([sourceWire(dir), builtWire(client)]).toEqual([null, null]);
  expect(() => serverWire(client, dir)).toThrow("to take the wire version from");
  // A folder of client files with no word of its build, as a test's, is not called stale.
  expect(serverWire(client, root)).toEqual({ wire: own, stale: false });
  writeFileSync(join(client, "build.json"), JSON.stringify({ commit: "abc", wire: own + 1 }));
  expect(serverWire(client, root)).toEqual({ wire: own, stale: true });
  expect(serverWire(client, dir)).toEqual({ wire: own + 1, stale: false });
  writeFileSync(join(client, "build.json"), JSON.stringify({ commit: "abc", wire: own }));
  expect(serverWire(client, root)).toEqual({ wire: own, stale: false });
});

// A script that takes a built file's version, spelt apart so that the check's rule on imports reads it as text.
const SAYS = `${"imp" + "ort"} { PROTOCOL_VERSION } from "./protocol.js"; console.log(PROTOCOL_VERSION);`;

test("a build gives the page its version, and source that is not built holds none", async () => {
  const versionOf = async (define: Record<string, string>): Promise<string> => {
    const built = await Bun.build({ entrypoints: [join(root, "shared/net/protocol.ts")], target: "bun", minify: true, define });
    expect(built.success).toBe(true);
    writeFileSync(join(dir, "protocol.js"), await built.outputs[0]!.text());
    writeFileSync(join(dir, "says.js"), SAYS);
    return Bun.spawnSync([process.execPath, join(dir, "says.js")]).stdout.toString().trim();
  };
  expect([await versionOf({ __WIRE__: "123456789" }), await versionOf({})]).toEqual(["123456789", "0"]);
});

test("a page built from other source is refused as another version", () => {
  const own = wireOf(names, read);
  // A field widened in the server's writer alone, as a build of other source would have it.
  const other = wireOf(names, (n) => (n === "server/own.ts" ? `${read(n)}// a wider field\n` : read(n)));
  expect(other).not.toBe(own);
  const before = PROTOCOL_VERSION;
  // As a server started from this source is stamped (server/main.ts).
  stampWire(own);
  try {
    const h = new Harness();
    const end = h.net.connect();
    const said: number[][] = [];
    end.onMessage = (_ch, data) => said.push([...data]);
    const w = new BitWriter(128);
    writeHello(w, other, h.reg.hash, h.world.anim.set.hash, "stale", 0, testKey("stale"));
    end.send(CH_RELIABLE, w.bytes());
    h.run(100);
    expect([end.open, said, h.server.playerCount]).toEqual([false, [[S_REJECT, REJECT_VERSION]], 0]);
    const ada = h.join("ada");
    h.run(300);
    expect([ada.state, h.server.playerCount]).toEqual(["active", 1]);
    h.host.shutdown();
  } finally {
    stampWire(before);
  }
});
