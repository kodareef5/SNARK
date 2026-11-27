// A transfer's file is packed and still opens as files sealed before did, and a world with nothing owed lists no folder:
// it looks for each ticket's own sealed file by its name, and lists once when that has gone.

import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TICKET_SECONDS } from "../../server/cluster/cluster.ts";
import { openParcel, parcelRecords, sha256 } from "../../server/cluster/parcel.ts";
import { TestCluster, beat, commit, keyAt, places, rec, rise, travel, type Server } from "../fixtures/cluster.ts";

const t = new TestCluster();
afterAll(() => t.cleanup());

/** A transfer's file as it was sealed before files were packed: the seal of the JSON, a newline, the JSON. */
function plain(bytes: Uint8Array): Uint8Array {
  const text = JSON.stringify(openParcel(bytes).body);
  return new TextEncoder().encode(`${sha256(text)}\n${text}`);
}

/** How often `s` listed the transfer folder, and read a file of it, while `run` ran. */
function looks(s: Server, run: () => void): { listed: number; read: number } {
  const folder = s.h.host.cluster!.folder;
  const list = folder.places.bind(folder);
  const read = folder.read.bind(folder);
  const seen = { listed: 0, read: 0 };
  folder.places = () => (seen.listed++, list());
  folder.read = (place) => (seen.read++, read(place));
  try {
    run();
  } finally {
    folder.places = list;
    folder.read = read;
  }
  return seen;
}

test("a transfer's file is packed to a fraction, and one sealed plain before still opens, recovers and balances", () => {
  const clock = { ms: Date.now() };
  let a = t.server("Island", "packed", clock);
  const b = t.server("Miami", "packed", clock);
  const folder = a.h.host.cluster!.folder;
  const { session, me } = t.survivor(a, "ada");
  commit(a, b);
  const before = t.backup(a, "packed-a-before.db");
  beat(a, b);
  const ticket = travel(a, session, b.world) as Uint8Array;
  const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket });
  b.h.run(400);
  rise(b, there);
  commit(a, b);

  const place = folder.places()[0]!;
  const file = join(folder.root, "parcels", place.file);
  const packed = readFileSync(file);
  const old = plain(packed);
  // The content table is most of a transfer: plain it is some 200 KB, and packed a tenth of that.
  expect(packed.length * 4).toBeLessThan(old.length);
  expect(parcelRecords(t.reg, openParcel(old)).map((r) => r.pid)).toEqual(parcelRecords(t.reg, openParcel(packed)).map((r) => r.pid));
  expect(openParcel(old).head).toEqual(openParcel(packed).head);

  // The folder holds the plain form, as one sealed by a build before this. A save restored from before it gives it up again.
  writeFileSync(file, old);
  a = t.restore(a, before, clock);
  expect(a.log.filter((l) => l.includes("which this save did not know"))).toEqual([expect.stringContaining("ada left for Miami by transfer")]);
  expect(places(me.pid, folder, a, b)).toEqual(["world 2"]);
  expect(t.audit(a, b)).toEqual([]);

  // A seal that is right over what is no transfer is refused for what it is, packed or not.
  for (const junk of [new TextEncoder().encode("not a transfer"), Bun.gzipSync(new TextEncoder().encode("{")), new Uint8Array([0x1f, 0x8b, 1, 2, 3])]) {
    const sealed = new Uint8Array(65 + junk.length);
    sealed.set(new TextEncoder().encode(`${sha256(junk)}\n`));
    sealed.set(junk, 65);
    expect(() => openParcel(sealed)).toThrow("it is sealed, and what it holds is no transfer");
  }
  expect(() => openParcel(packed.subarray(0, packed.length - 9))).toThrow("its seal does not match what it holds");
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("a world with nothing owed lists no folder, and one with a ticket out looks only for that ticket's file", () => {
  const clock = { ms: Date.now() };
  const a = t.server("Island", "quiet", clock);
  const b = t.server("Miami", "quiet", clock);
  const { session } = t.survivor(a, "ada");
  commit(a, b);
  expect(looks(a, () => beat(a, a, a))).toEqual({ listed: 0, read: 0 });

  // The ticket is out: nothing is listed, and its file is not read while its ten minutes run.
  const ticket = travel(a, session, b.world) as Uint8Array;
  commit(a, b);
  expect(looks(a, () => beat(a, a, a))).toEqual({ listed: 0, read: 0 });
  expect(a.h.host.exec("cluster")).toContain(", not yet taken");

  // Taken there: the next look lists once to learn it, and none after lists again.
  const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket });
  b.h.run(400);
  rise(b, there);
  commit(a, b);
  expect(looks(a, () => beat(a))).toEqual({ listed: 1, read: 0 });
  expect(looks(a, () => beat(a, a, a))).toEqual({ listed: 0, read: 0 });
  expect(a.h.host.exec("cluster")).not.toContain(", not yet taken");
  expect(t.audit(a, b)).toEqual([]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("a ticket never used still brings its survivor back when it ends, and after a restart its end is read once", () => {
  const clock = { ms: Date.now() };
  let a = t.server("Island", "ends", clock);
  const b = t.server("Miami", "ends", clock);
  const { session, me } = t.survivor(a, "ada");
  commit(a, b);
  travel(a, session, b.world);
  commit(a, b);
  const during = t.backup(a, "ends-a-during.db");
  // Started again while the survivor is away: the first look reads its file for when the ticket ends, and no later one does.
  a = t.restore(a, during, clock);
  expect(looks(a, () => beat(a, a, a))).toEqual({ listed: 0, read: 0 });
  clock.ms += TICKET_SECONDS * 1000 - 1000;
  expect(looks(a, () => beat(a))).toEqual({ listed: 0, read: 0 });
  expect(rec(a, "ada")).toBeUndefined();
  clock.ms += 2000;
  beat(a);
  expect(rec(a, "ada")?.pid).toBe(me.pid);
  expect(a.log.some((l) => l.includes("ran out unused, so ada is back here"))).toBe(true);
  expect(t.audit(a, b)).toEqual([]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("a ticket whose file has gone from the folder, or cannot be read, is settled and said once", () => {
  const clock = { ms: Date.now() };
  const a = t.server("Island", "gone", clock);
  const b = t.server("Miami", "gone", clock);
  const folder = a.h.host.cluster!.folder;
  const ada = t.survivor(a, "ada");
  const bo = t.survivor(a, "bo");
  commit(a, b);
  travel(a, ada.session, b.world);
  travel(a, bo.session, b.world);
  commit(a, b);
  const files = folder.places();
  expect(files.length).toBe(2);
  const fileOf = (name: string): string => join(folder.root, "parcels", files.find((p) => openParcel(folder.read(p)!).head.name === name)!.file);
  // Ada's file is taken out by hand. Bo's is cut short, and is read when its ticket ends.
  rmSync(fileOf("ada"));
  const whole = readFileSync(fileOf("bo"));
  writeFileSync(fileOf("bo"), whole.subarray(0, whole.length - 9));
  expect(looks(a, () => beat(a))).toEqual({ listed: 1, read: 0 });
  clock.ms += TICKET_SECONDS * 1000 + 1000;
  expect(looks(a, () => beat(a))).toEqual({ listed: 0, read: 1 });
  expect(looks(a, () => beat(a, a, a))).toEqual({ listed: 0, read: 0 });
  expect(a.log.filter((l) => l.includes("the cluster's folder has no file of it")).length).toBe(1);
  expect(a.log.filter((l) => l.includes("cannot be read")).length).toBe(1);
  const said = a.h.host.exec("cluster").split("\n");
  expect(said.some((l) => l.includes("ada left for Miami") && l.endsWith(", whose file is not in the folder"))).toBe(true);
  expect(said.some((l) => l.includes("bo left for Miami") && l.endsWith(", whose file cannot be read"))).toBe(true);
  a.h.host.shutdown();
  b.h.host.shutdown();
});
