// What the browser says of the game's saved files is kept: whether it keeps them, its answer when asked to, and the
// room it gives the site. It is asked to keep them once a visit, however many times the player asks to keep files.
import { expect, test } from "bun:test";
import { Residency } from "../../client/core/assets/residency.ts";
import { StorageInfo, type StorageAsker } from "../../client/core/assets/storage.ts";
import { SplitPort } from "../../client/core/sound/split.ts";
import { MANIFEST_VERSION, type Manifest } from "../../shared/pack/manifest.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { FakeNet } from "../fixtures/assetnet.ts";

/** A browser's storage manager that answers as told, and counts what it is asked. */
function browser(persisted: boolean, grants: boolean): StorageAsker & { asked: Record<string, number>; usage: number } {
  const asked: Record<string, number> = { persisted: 0, persist: 0, estimate: 0 };
  const b = {
    asked,
    usage: 812e6,
    persisted: async () => (asked.persisted!++, persisted),
    persist: async () => (asked.persist!++, grants),
    estimate: async () => (asked.estimate!++, { usage: b.usage, quota: 9.8e9 }),
  };
  return b;
}

test("whether the browser keeps the files is asked once at the start and kept; asked to keep them, it is asked once a visit and its answer is kept", async () => {
  const b = browser(false, true);
  const info = new StorageInfo(b);
  expect([info.persisted, info.asked, info.granted]).toEqual([null, false, null]);
  await Promise.resolve();
  expect([info.persisted, b.asked.persisted]).toEqual([false, 1]);
  // Each press of "keep all" and each page that comes while it is on asks to keep files: the browser is asked once.
  for (let k = 0; k < 5; k++) info.keep();
  await Promise.resolve();
  expect([b.asked.persist, info.asked, info.granted, info.persisted]).toEqual([1, true, true, true]);
  // A browser that says no is believed, and asked no more.
  const no = browser(false, false), refused = new StorageInfo(no);
  refused.keep();
  refused.keep();
  await Promise.resolve();
  expect([no.asked.persist, refused.granted, refused.persisted]).toEqual([1, false, false]);
});

test("a browser that cannot say leaves every answer unknown, and one that fails is taken as having refused", async () => {
  const none = new StorageInfo(undefined);
  none.keep();
  none.refresh(10);
  await Promise.resolve();
  expect([none.persisted, none.asked, none.granted, none.usage, none.quota, none.at]).toEqual([null, false, null, null, null, null]);
  const failing = new StorageInfo({ persist: () => Promise.reject(new Error("no")) });
  failing.keep();
  await Promise.resolve();
  await Promise.resolve();
  expect([failing.asked, failing.granted, failing.persisted]).toEqual([true, false, null]);
});

test("the room the browser gives is asked only when wanted, one question at a time, and each answer says when it was asked", async () => {
  const b = browser(true, true);
  const info = new StorageInfo(b);
  await Promise.resolve();
  expect([b.asked.estimate, info.usage, info.quota, info.at]).toEqual([0, null, null, null]);
  info.refresh(1000);
  info.refresh(1016);
  await Promise.resolve();
  expect([b.asked.estimate, info.usage, info.quota, info.at]).toEqual([1, 812e6, 9.8e9, 1000]);
  b.usage = 900e6;
  info.refresh(5000);
  await Promise.resolve();
  expect([b.asked.estimate, info.usage, info.at]).toEqual([2, 900e6, 5000]);
});

test("the asset library reads what the browser says through the port it shares with the sounds", () => {
  const net = new FakeNet([]);
  const info = new StorageInfo(browser(true, true));
  const port = Object.assign(net, { storage: info });
  const split = new SplitPort(port);
  const manifest: Manifest = { version: MANIFEST_VERSION, files: [], boot: 0, clipHash: 0, meshes: [] };
  const pack = { blobAt: 0, blob: new Uint8Array(0) } as unknown as Pack;
  expect([new Residency(manifest, pack, split.assets).storage, new Residency(manifest, pack, new FakeNet([])).storage, new Residency(manifest, pack, null).storage]).toEqual([info, null, null]);
});
