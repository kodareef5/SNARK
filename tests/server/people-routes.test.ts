// The people store's admin API (server/admin/people-routes.ts) on two worlds of one cluster, through the real gate: each
// change answers, is logged as its actor's and refuses a stale page; a print is checked by its frame; the second world,
// its clients and its wearers see the same editions, a retired one too, across a restart.
import { afterAll, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { peopleAdmin } from "../../server/admin/people-routes.ts";
import { refused, type AdminGate } from "../../server/admin/gate.ts";
import { Guesses } from "../../server/guesses.ts";
import { PRINT_BYTES_MAX, printName } from "../../shared/people/doc.ts";
import { encodePng } from "../../tools/snap/png.ts";
import { TestCluster, keyAt, rec, type Server } from "../fixtures/cluster.ts";

const cluster = new TestCluster();
afterAll(() => cluster.cleanup());
const clock = { ms: Date.now() };
const PASSWORD = "kiwi-7731";
let folders = 0;

/** Two worlds over a cluster folder of their own. */
function worlds(): { a: Server; b: Server; folder: string } {
  const folder = `people${++folders}`, host = { host: { adminPassword: PASSWORD } };
  return { a: cluster.server("Island", folder, clock, host), b: cluster.server("Miami", folder, clock, host), folder };
}

/** A request to `s`'s people API, signed in with its admin password. */
function call(s: Server, path: string, init: RequestInit = {}): Promise<Response> {
  const host = s.h.host;
  const gate: AdminGate = { dev: false, password: host.adminPassword, guesses: new Guesses(), tick: () => 0, world: s.world };
  const req = new Request(`http://snark.test${path}`, { ...init, headers: { authorization: `Basic ${btoa(`kody:${PASSWORD}`)}`, ...(init.headers as Record<string, string>) } } as RequestInit);
  return Promise.resolve(refused(req, "1.2.3.4", gate) ?? peopleAdmin(req, path, host.people, () => host.world.reg, host.acts, host)!);
}
const post = (s: Server, path: string, body: unknown): Promise<Response> => call(s, path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const upload = (s: Server, bytes: Uint8Array, headers: Record<string, string> = { "content-length": String(bytes.length) }): Promise<Response> =>
  call(s, "/admin/people/print", { method: "POST", body: bytes, headers: { "content-type": "image/png", ...headers } });
const state = async (s: Server) => (await (await call(s, "/admin/people/state")).json()) as { revision: number; manifest: { id: string } | null; garments: { id: string }[]; editions: { id: number; name: string; retired: boolean; by: string }[] };
/** What the admin log holds of the people store, each as its actor's name and words. */
const acts = (s: Server): string[][] => s.h.host.acts.recent(0, 1e9).filter((a) => /edition|print/.test(a.what)).map((a) => [a.name, a.what]);

const picture = (w: number, h: number): Uint8Array => encodePng(w, h, Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 37) & 0xff)));
const PLACE = { u: 0.25, v: 0.3, w: 0.5, h: 0.25, scale: 1.5, turn: -0.2 };

test("a print, an edition and a retirement each answer and are logged once; a stale page gets 409 and the state", async () => {
  const { a, b } = worlds();
  try {
    const fresh = await state(a);
    expect([fresh.revision, fresh.manifest, fresh.editions]).toEqual([0, null, []]);
    expect(fresh.garments.map((g) => g.id)).toContain("core:plain_tee");

    const print = picture(256, 128);
    const sent = await upload(a, print);
    const up = (await sent.json()) as { hash: string; width: number; height: number; known: boolean; path: string };
    expect([sent.status, up.width, up.height, up.known]).toEqual([200, 256, 128, false]);
    expect(existsSync(join(a.h.host.people.media, printName(up.hash)))).toBe(true);
    expect(((await (await upload(a, print)).json()) as { known: boolean }).known).toBe(true);

    const edition = { revision: 0, garment: "core:plain_tee", colours: [12, 40, 3], name: "Vegas tee", print: { hash: up.hash, place: PLACE } };
    const made = await post(a, "/admin/people/publish", edition);
    expect([made.status, ((await made.json()) as { id: number }).id]).toEqual([200, 1]);
    // A second page that read the same revision is told to reload, and shown what is there now.
    const stale = await post(b, "/admin/people/publish", { ...edition, name: "Lost tee" });
    const said = (await stale.json()) as { error: string; editions: { name: string }[] };
    expect([stale.status, said.error, said.editions.map((e) => e.name)]).toEqual([409, "The editions changed in another page. Reload to see them.", ["Vegas tee"]]);

    expect((await post(a, "/admin/people/retire", { revision: 1, id: 1, retired: true })).status).toBe(200);
    expect((await post(a, "/admin/people/retire", { revision: 2, id: 1, retired: true })).status).toBe(200);
    const after = await state(b);
    expect(after.editions.map((e) => [e.id, e.name, e.retired, e.by])).toEqual([[1, "Vegas tee", true, "(kody)"]]);
    expect([...acts(a), ...acts(b)]).toEqual([
      ["(kody)", `uploaded the print ${printName(up.hash)} (256×128, ${Math.round(print.length / 1024)} KB)`],
      ["(kody)", `published the edition 1 "Vegas tee" of core:plain_tee (colours 12, 40, 3; print ${printName(up.hash)})`],
      ["(kody)", `retired the edition 1 "Vegas tee"`],
    ]);
  } finally {
    a.h.host.shutdown();
    b.h.host.shutdown();
  }
});

test("an edition the content or the sheet cannot hold is refused with its reason and logs nothing", async () => {
  const { a, b } = worlds();
  try {
    const good = { revision: 0, garment: "core:plain_tee", colours: [0, 0, 0], name: "Plain" };
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ ...good, garment: "core:stone" }, /core:stone is not a garment/],
      [{ ...good, garment: "nope" }, /content id/],
      [{ ...good, colours: [1, 2] }, /three colours/],
      [{ ...good, colours: [1, 2, 256] }, /three colours/],
      [{ ...good, name: "x".repeat(41) }, /1 to 40 letters/],
      [{ ...good, print: { hash: "0123456789abcdef", place: PLACE } }, /Upload the print/],
      [{ ...good, print: { hash: "0123456789abcdef", place: { ...PLACE, u: 0.8 } } }, /within the sheet/],
      [{ ...good, print: { hash: "0123456789abcdef", place: { ...PLACE, scale: 0 } } }, /scale/],
      [{ ...good, print: { hash: "../../etc", place: PLACE } }, /by its hash/],
      [{ ...good, revision: "0" }, /revision/],
    ];
    for (const [body, why] of bad) {
      const res = await post(a, "/admin/people/publish", body);
      expect([res.status, why.test(((await res.json()) as { error: string }).error)]).toEqual([400, true]);
    }
    expect((await post(a, "/admin/people/retire", { revision: 0, id: 5, retired: true })).status).toBe(404);
    expect([(await state(a)).revision, acts(a)]).toEqual([0, []]);
  } finally {
    a.h.host.shutdown();
    b.h.host.shutdown();
  }
});

test("a malformed print is refused with its reason, one over the cap unread, and none leaves a file", async () => {
  const { a, b } = worlds();
  try {
    const good = picture(64, 64);
    const crc = good.slice();
    crc[50] = crc[50]! ^ 0xff;
    const tall = picture(32, 64);
    for (const [bytes, why] of [[crc, /fails its CRC/], [tall, /square or twice as wide/], [new TextEncoder().encode("<svg/>"), /not a PNG/]] as const) {
      const res = await upload(a, bytes);
      expect([res.status, why.test(((await res.json()) as { error: string }).error)]).toEqual([422, true]);
    }
    // A length over the cap is answered before a byte of the body is read.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({ pull: (c) => void (pulled++, c.enqueue(new Uint8Array(65536))) }, { highWaterMark: 0 });
    const big = await call(a, "/admin/people/print", { method: "POST", body: endless, duplex: "half", headers: { "content-length": String(PRINT_BYTES_MAX + 1) } } as RequestInit);
    expect([big.status, pulled]).toEqual([413, 0]);
    expect((await upload(a, good, {})).status).toBe(411);
    expect((await upload(a, good, { "content-length": String(good.length + 10) })).status).toBe(400);
    const left = ["media", "tmp"].flatMap((f) => (existsSync(join(a.h.host.people.media, "..", f)) ? readdirSync(join(a.h.host.people.media, "..", f)) : [])).filter((f) => /^print/.test(f));
    expect([left, acts(a)]).toEqual([[], []]);
  } finally {
    a.h.host.shutdown();
    b.h.host.shutdown();
  }
});

test("the second world's wearers, clients and a restart all keep a retired edition", async () => {
  const { a, b, folder } = worlds();
  let b2: Server | null = null;
  try {
    const reg = a.h.reg, tee = reg.index.get("core:plain_tee")!, trousers = reg.index.get("core:plain_trousers")!;
    const publish = async (garment: string, name: string): Promise<number> => ((await (await post(a, "/admin/people/publish", { revision: (await state(a)).revision, garment, colours: [9, 0, 0], name })).json()) as { id: number }).id;
    const shirt = await publish("core:plain_tee", "Market tee"), legs = await publish("core:plain_trousers", "Market jeans");

    // On B, a survivor puts the tee on and wears A's edition of it; another garment's edition or none it holds is refused.
    const ada = b.h.join("ada", {}, { key: keyAt("ada", b.world) });
    b.h.run(300);
    const me = rec(b, "ada")!, items = b.h.host.items, inv = items.inv(me);
    expect(items.mintAt(me, inv.wardrobe, tee, 1)).toBe(1);
    expect([items.restyle(me, inv.wardrobe, legs, 0), items.restyle(me, inv.wardrobe, 4242, 0), items.restyle(me, inv.wardrobe, shirt, 7)]).toEqual([false, false, true]);
    expect(items.mintAt(me, inv.wardrobe + 1, trousers, 1)).toBe(1);
    expect(items.restyle(me, inv.wardrobe + 1, legs, 0)).toBe(true);

    // B's clients learn the manifest A wrote once B looks again, as its timer does every few seconds.
    b.h.host.people.poll(Date.now() + 60_000);
    b.h.run(100);
    const manifest = a.h.host.people.view().manifestId;
    expect([manifest.length, ada.peopleManifest]).toEqual([16, manifest]);

    expect((await post(a, "/admin/people/retire", { revision: (await state(a)).revision, id: shirt, retired: true })).status).toBe(200);
    b.h.run(300);
    b.h.host.shutdown();
    b2 = cluster.server("Miami", folder, clock, { host: { adminPassword: PASSWORD } });
    const back = b2.h.join("ada", {}, { key: keyAt("ada", b2.world) });
    b2.h.run(600);
    b2.h.host.people.poll();
    b2.h.run(100);
    const me2 = rec(b2, "ada")!, inv2 = b2.h.host.items.inv(me2);
    expect([inv2.editionOf(inv2.wardrobe), inv2.dyeOf(inv2.wardrobe), back.inventory!.editionOf(inv2.wardrobe)]).toEqual([shirt, 7, shirt]);
    // Retired, it still resolves: it is re-dyed in place, and handed out again by an admin's restyle.
    expect(b2.h.host.people.garmentOf(shirt)).toBe("core:plain_tee");
    expect(b2.h.host.items.restyle(me2, inv2.wardrobe, shirt, 8)).toBe(true);
    expect(b2.h.host.items.restyle(me2, inv2.wardrobe, 0, 0)).toBe(true);
    expect(b2.h.host.items.restyle(me2, inv2.wardrobe, shirt, 0)).toBe(true);
    expect([back.peopleManifest, (await state(b2)).editions.map((e) => [e.id, e.retired])]).toEqual([manifest, [[shirt, true], [legs, false]]]);
  } finally {
    a.h.host.shutdown();
    (b2 ?? b).h.host.shutdown();
  }
});
