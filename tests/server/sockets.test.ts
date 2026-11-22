// The real server on real sockets: who may open one.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { originAllowed, startServer } from "../../server/main.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { splitPack } from "../../tools/pack/split.ts";

/** A client folder with what the server reads of it: the manifest, the boot pack and the clip file. */
function clientFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "snark-sockets-"));
  mkdirSync(join(dir, "assets"));
  const { files, manifest } = splitPack(corePackBytes(), "core");
  for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
  writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
  return dir;
}

test("a page on another site may not open a socket, the server's own page and a program that is no browser may, and an operator lists the rest", async () => {
  const dir = clientFolder();
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

test("a world hosts a server directory only when its operator asks, and a search of it writes nothing", async () => {
  const dir = clientFolder();
  const log = console.log;
  console.log = () => {};
  const saves = mkdtempSync(join(tmpdir(), "snark-directory-save-"));
  const plain = startServer({ port: 0, clientDir: dir, dbPath: join(saves, "plain.db"), noBackups: true });
  const hosting = startServer({ port: 0, clientDir: dir, dbPath: join(saves, "hosting.db"), noBackups: true, directory: true });
  const ask = (port: number, init?: RequestInit) => fetch(`http://localhost:${port}/directory`, init);
  const announce = (address: string) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "announce", address }) });
  const says = async (port: number) => ((await (await fetch(`http://localhost:${port}/entry-world.json`)).json()) as { listed: boolean }).listed;
  try {
    expect([(await ask(plain.port!)).status, (await ask(plain.port!, announce("https://play.example.org/"))).status]).toEqual([404, 404]);
    expect(await (await ask(hosting.port!)).json()).toEqual([]);
    expect((await ask(hosting.port!, announce("http://play.example.org/"))).status).toBe(400);
    expect([existsSync(join(saves, "plain.db.directory.sqlite")), existsSync(join(saves, "hosting.db.directory.sqlite"))]).toEqual([false, false]);
    // A world asks to be listed only when it is listed somewhere.
    expect([await says(plain.port!), await says(hosting.port!)]).toEqual([false, true]);
    const card = async () => (await fetch(`http://localhost:${hosting.port}/entry-world.json`)).json();
    expect(await card()).toMatchObject({ pve: false, about: "", discord: "", tags: {} });
    // What its listing says changes while it runs, kept to what a list may show.
    for (const [name, value] of [
      ["ServerDescription", "Tames‮ kept  safe."],
      ["DiscordUrl", "https://discord.gg/reef"],
      ["ServerTags", "rates=3x, region=eu, slots=40, Bad Name=1"],
    ])
      expect(hosting.host.setSetting(name, value)).toBe("");
    expect(await card()).toMatchObject({ about: "Tames kept safe.", discord: "https://discord.gg/reef", tags: { rates: "3x", region: "eu", slots: 40 } });
    expect(hosting.host.setSetting("DiscordUrl", "https://elsewhere.example/reef")).toBe("");
    expect(((await card()) as { discord: string }).discord).toBe("");
  } finally {
    console.log = log;
    plain.stop();
    hosting.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(saves, { recursive: true, force: true });
  }
});

test("a development server takes a socket and answers its own routes only for a browser that asked for this machine: localhost, an address, or its public address's host", async () => {
  const dir = clientFolder();
  writeFileSync(join(dir, "sounds.html"), "<p>board</p>");
  const log = console.log;
  console.log = () => {};
  const servers = [startServer({ port: 0, clientDir: dir, dev: true }), startServer({ port: 0, clientDir: dir, dev: true, publicUrl: "https://Play.Example/miami" }), startServer({ port: 0, clientDir: dir })];
  /** Opens a socket as a page of `name` would, a page that asked for `name` and was given this machine. */
  const open = (port: number, name: string, path = "/ws"): Promise<boolean> =>
    new Promise((done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { Host: `${name}:${port}`, Origin: `http://${name}:${port}` } });
      ws.onopen = () => (ws.close(), done(true));
      ws.onerror = () => done(false);
    });
  const status = (port: number, name: string, path: string, method = "GET"): Promise<number> =>
    fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { host: `${name}:${port}` }, ...(method === "POST" ? { body: "{}" } : {}) }).then((r) => r.status);
  try {
    const [dev, named, plain] = servers.map((s) => s.port) as [number, number, number];
    expect([await open(dev, "localhost"), await open(dev, "127.0.0.1"), await open(dev, "[::1]"), await open(dev, "192.168.1.20"), await open(dev, "localhost", "/voice")]).toEqual([true, true, true, true, true]);
    // A site that pointed its name at this machine gets neither a socket nor the dev server's routes.
    expect([await open(dev, "rebound.example"), await open(dev, "rebound.example", "/voice"), await open(dev, "play.example")]).toEqual([false, false, false]);
    expect([await status(dev, "rebound.example", "/__selfcheck", "POST"), await status(dev, "rebound.example", "/sounds.html"), await status(dev, "localhost", "/__selfcheck", "POST"), await status(dev, "localhost", "/sounds.html")]).toEqual([404, 404, 200, 200]);
    expect([await open(named, "play.example", "/miami/ws"), await open(named, "rebound.example", "/miami/ws")]).toEqual([true, false]);
    // A server that is not for development asks for its passwords whatever the name.
    expect(await open(plain, "rebound.example")).toBe(true);
  } finally {
    console.log = log;
    for (const s of servers) s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
