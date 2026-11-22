// A server directory: worlds announce themselves, the directory reads what each says of itself, players search.

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ONLINE_MS, ServerDirectory, listingAddress, plain, privateAddress, type ReadWorld } from "../../server/directory.ts";
import { discordOf, listing, tagsOf } from "../../shared/listing.ts";
import { listingsOf, mergeListings } from "../../client/core/directories.ts";

const post = (d: object) =>
  new Request("https://directory.example/directory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
const search = async (s: ServerDirectory) => (await (await s.answer(new Request("https://directory.example/directory"), "player")).json()) as Record<string, unknown>[];

/** Worlds as a directory finds them at their addresses, each what its entry-world.json says; the reads it made. */
function worlds(said: Record<string, Record<string, unknown>>) {
  const reads: string[] = [];
  const read: ReadWorld = async (address) => (reads.push(address), said[address] ? listing(said[address]) : null);
  return { read, reads };
}

test("a world that announces itself is listed with what it says of itself, and nothing an announcement says", async () => {
  const folder = mkdtempSync(join(tmpdir(), "snark-directory-")),
    file = join(folder, "directory.sqlite"),
    miami = "https://play.example.org/miami/";
  const { read, reads } = worlds({
    [miami]: { name: "Reef", map: "Miami", password: true, players: 2, max: 10, pve: true, about: "Tames‮ kept\n safe.", discord: "https://discord.gg/reef", tags: { rates: "3x", region: "eu", slots: 40 } },
  });
  let directory = new ServerDirectory(file, read);
  try {
    // A search finds nothing and makes no file; nor does an announcement it refuses.
    expect(await search(directory)).toEqual([]);
    for (const address of ["http://play.example.org/", "https://play.example.org:8787/", "https://10.0.0.5/", "https://localhost/"])
      expect((await directory.answer(post({ action: "announce", address }), "host")).status).toBe(400);
    expect((await directory.answer(post({ action: "update", address: miami, name: "Stolen" }), "host")).status).toBe(400);
    expect(existsSync(file)).toBe(false);
    // Only the address is taken from the announcement: the name, map and count are the world's.
    const res = await directory.answer(post({ action: "announce", address: "https://play.example.org/miami", name: "Not this", players: 99 }), "host");
    expect([res.status, await res.json()]).toEqual([200, { ok: true, listed: true }]);
    expect(await search(directory)).toEqual([
      {
        address: miami,
        name: "Reef",
        map: "Miami",
        mapId: "",
        password: true,
        players: 2,
        max: 10,
        pve: true,
        about: "Tames kept safe.",
        discord: "https://discord.gg/reef",
        tags: { rates: "3x", region: "eu", slots: 40 },
        seen: expect.any(Number),
        online: true,
      },
    ]);
    // Announced again soon after, by it or anyone, it is not read again.
    expect((await directory.answer(post({ action: "announce", address: miami }), "someone else")).status).toBe(202);
    expect(reads).toEqual([miami]);
    // An address where no world asks to be listed is not listed.
    const nowhere = await directory.answer(post({ action: "announce", address: "https://nothing.example.org/" }), "host");
    expect(nowhere.status).toBe(422);
    expect(directory.worlds()).toHaveLength(1);
    directory.close();
    directory = new ServerDirectory(file, read);
    expect(await search(directory)).toHaveLength(1);
    // Unheard for three minutes it is offline; after a week it is gone.
    const later = Date.now() + ONLINE_MS + 1;
    expect(directory.search(later)).toMatchObject([{ address: miami, online: false }]);
    expect(directory.search(Date.now() + 8 * 86_400_000)).toEqual([]);
  } finally {
    directory.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the operator hides a world for good or forgets it, and a requester announcing too often is turned away", async () => {
  const miami = "https://play.example.org/miami/",
    tampa = "https://play.example.org/tampa/";
  const { read } = worlds({
    [miami]: { name: "Reef", map: "Miami", password: false, players: 0, max: 10 },
    [tampa]: { name: "Bay", map: "Tampa", password: false, players: 0, max: 10 },
  });
  const directory = new ServerDirectory(":memory:", read);
  const now = Date.now();
  await directory.announce(miami, "a", now);
  await directory.announce(tampa, "a", now);
  expect([directory.hide(miami), directory.hide("https://other.example.org/")]).toEqual([true, false]);
  expect(directory.search(now).map((w) => w.address)).toEqual([tampa]);
  // Hidden stays hidden however it announces, and cannot be forgotten into coming back.
  expect((await directory.announce(miami, "a", now + 60_000)).status).toBe(200);
  expect([directory.remove(miami), directory.search(now + 60_000).map((w) => w.address)]).toEqual([false, [tampa]]);
  directory.hide(miami, false);
  expect(directory.search(now + 60_000)).toHaveLength(2);
  expect(directory.remove(tampa)).toBe(true);
  expect(directory.worlds().map((w) => w.address)).toEqual([miami]);
  for (let i = 0; i < 30; i++) await directory.announce(miami, "noisy", now + 120_000);
  expect((await directory.announce(miami, "noisy", now + 120_000)).status).toBe(429);
  expect((await directory.announce(miami, "quiet", now + 120_000)).status).toBe(202);
  directory.close();
});

test("a listed name loses control and formatting characters, and a directory reads from no private address", () => {
  expect(plain("  Reef‮  ​Bay\n\tMiami  ")).toBe("Reef Bay Miami");
  expect(plain(undefined)).toBe("");
  expect(listingAddress("https://Play.Example.org/miami").href).toBe("https://play.example.org/miami/");
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "nonsense"])
    expect([ip, privateAddress(ip)]).toEqual([ip, true]);
  for (const ip of ["93.184.216.34", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34"]) expect([ip, privateAddress(ip)]).toEqual([ip, false]);
});

test("the title keeps what can be joined from every directory its world names, each world once, and goes on when one is down", () => {
  const row = (address: string, online: boolean) => ({ address, name: "Reef", map: "Miami", mapId: "", players: 1, max: 10, password: false, online });
  const one = listingsOf([
    row("https://a.example.org/", false),
    row("http://insecure.example.org/", true),
    row("https://port.example.org:8443/", true),
    row("https://10.0.0.5/", true),
    { ...row("https://c.example.org/", true), players: "lots" },
    "nonsense",
  ]);
  expect(one.map((w) => w.address)).toEqual(["https://a.example.org/"]);
  const two = listingsOf([row("https://a.example.org/", true), row("https://b.example.org/world/", true)]);
  expect(mergeListings([one, two, null])!.map((w) => [w.address, w.online])).toEqual([
    ["https://a.example.org/", true],
    ["https://b.example.org/world/", true],
  ]);
  expect([listingsOf({}), mergeListings([null, null]), mergeListings([])]).toEqual([[], null, []]);
});

test("what a world says of itself is kept to what a server list can show: a short blurb, a Discord invite, short tags", () => {
  expect(tagsOf("rates=3x, Region = eu ,slots=40, rates=10x, bad name=1, noequals, long=" + "x".repeat(41) + ", ratio=1.5, neg=-2")).toEqual({ rates: "3x", region: "eu", slots: 40, ratio: 1.5, neg: -2 });
  expect(Object.keys(tagsOf(Array.from({ length: 20 }, (_, i) => `t${i}=${i}`).join(",")))).toHaveLength(12);
  expect([tagsOf({ toString: "x", "0bad": 1, nested: { a: 1 }, fine: "yes", n: 3 }), tagsOf(["a=b"]), tagsOf(null)]).toEqual([{ fine: "yes", n: 3 }, {}, {}]);
  for (const ok of ["https://discord.gg/reef", "https://discord.com/invite/Reef-42"]) expect(discordOf(ok)).toBe(ok);
  for (const no of ["http://discord.gg/reef", "https://discord.gg.evil.example/reef", "https://evil.example/?discord.gg/x", "javascript:alert(1)", "https://discord.gg/", 42])
    expect([no, discordOf(no)]).toEqual([no, ""]);
  const said = listing({ name: "Reef", map: "Miami", players: 1, max: 10, about: "y".repeat(400) })!;
  expect([said.about.length, said.pve, said.discord, said.tags, said.password]).toEqual([300, false, "", {}, false]);
  expect([listing({ name: "", map: "Miami", players: 1, max: 10 }), listing({ name: "Reef", map: "Miami", players: 11, max: 10 })]).toEqual([null, null]);
});
