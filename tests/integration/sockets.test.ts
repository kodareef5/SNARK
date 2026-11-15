// The real server on real sockets: who may open one.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { originAllowed, startServer } from "../../server/main.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { splitPack } from "../../tools/pack/split.ts";

test("a page on another site may not open a socket, the server's own page and a program that is no browser may, and an operator lists the rest", async () => {
  // A client folder with what the server reads of it: the manifest and the boot pack.
  const dir = mkdtempSync(join(tmpdir(), "snark-sockets-"));
  mkdirSync(join(dir, "assets"));
  const { files, manifest } = splitPack(corePackBytes(), "core");
  writeFileSync(join(dir, "assets", manifest.files[manifest.boot]!.name), files[manifest.boot]!.bytes);
  writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
  const log = console.log;
  const said: string[] = [];
  console.log = (line: string) => void said.push(line);
  const server = startServer({ port: 0, clientDir: dir });
  /** Opens a socket as a page at `origin` would, or with no origin as the agent does. */
  const open = (path: string, origin?: string): Promise<boolean> =>
    new Promise((done) => {
      const ws = new WebSocket(`ws://localhost:${server.port}${path}`, origin === undefined ? {} : { headers: { Origin: origin } });
      ws.onopen = () => (ws.close(), done(true));
      ws.onerror = () => done(false);
    });
  try {
    const own = `http://localhost:${server.port}`;
    const other = "https://elsewhere.example";
    expect([await open("/ws"), await open("/voice"), await open("/ws", own), await open("/voice", own)]).toEqual([true, true, true, true]);
    expect([await open("/ws", other), await open("/voice", other), await open("/ws", "null")]).toEqual([false, false, false]);
    // Each site turned away is logged once, with the setting that lets it in.
    expect(said.filter((line) => line.includes(other))).toEqual([`refused a socket to a page of ${other}: AllowedOrigins in [SnarkSettings] names the sites whose pages may connect`]);
    expect(server.host.setSetting("AllowedOrigins", `https://play.example, ${other}`)).toBe("");
    expect([await open("/ws", other), await open("/voice", "https://play.example"), await open("/ws", "https://third.example")]).toEqual([true, true, false]);
    expect(server.host.setSetting("AllowedOrigins", "*")).toBe("");
    expect(await open("/ws", "https://third.example")).toBe(true);
  } finally {
    console.log = log;
    server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  // A proxy that passes the Host on needs no listing. Case and a closing slash do not matter.
  expect([originAllowed("https://Play.Example", "play.example", ""), originAllowed("https://play.example", "10.0.0.5:8787", ""), originAllowed("https://play.example", "10.0.0.5:8787", "HTTPS://PLAY.EXAMPLE/")]).toEqual([true, false, true]);
});
