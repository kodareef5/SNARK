// A first-layout look (28 bytes) is padded wherever it arrives: in a save, in a hello, in a record's codec. The
// survivor then wears the same first bytes, and its owner and watchers are told the 72-byte look.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { RecordCodec, idMap } from "../../server/persist/codec.ts";
import { EntityRecord } from "../../server/records.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { readLaunch } from "../../client/core/entry-state.ts";
import { LAYOUT_VERSION, LOOK_BYTES, LOOK_LAYOUT, LOOK_V1_BYTES, randomLook, upgradeLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { SESSION_ALIVE } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-look-upgrade-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const oldLook = (seed: number): Uint8Array => randomLook(new Rng(seed)).slice(0, LOOK_V1_BYTES);

test("a record saved with a 28-byte look reads back with the padded look", () => {
  const reg = compileContent(CORE_CONTENT).registry!;
  const codec = new RecordCodec(Uint16Array.from(reg.ids, (_, i) => i), idMap(reg, reg.ids.map((name, i) => [name, i]), reg.ids.length), false);
  const rec = new EntityRecord(5, reg.index.get("core:survivor")!);
  rec.look = oldLook(1);
  const back = codec.decode({ pid: 5, kind: rec.kind, x: 0, y: 0, z: 0, yaw: 0, data: codec.encode(rec).slice() })!;
  expect([...back.look!]).toEqual([...upgradeLook(rec.look)]);
  expect(back.extra.size).toBe(0);
});

test("a hello's 28-byte look makes a survivor that wears it padded", () => {
  const h = new Harness();
  const old = oldLook(2);
  const ada = h.join("ada", {}, { look: old });
  const bo = h.join("bo");
  h.run(500);
  expect(ada.sessionState).toBe(SESSION_ALIVE);
  const want = [...upgradeLook(old)];
  expect([...h.world.ents.looks.get(h.ent(ada))!]).toEqual(want);
  expect([...ada.ownLook!]).toEqual(want);
  // A watcher reads the 72-byte look from her create.
  const seen = new RemoteSample();
  bo.sampleRemote(seen);
  const at = [...Array(seen.count).keys()].find((i) => seen.id[i] === h.ent(ada))!;
  expect([...seen.look.subarray(at * LOOK_BYTES, (at + 1) * LOOK_BYTES)]).toEqual(want);
  h.host.shutdown();
});

test("a survivor saved with a 28-byte look returns wearing it padded, and its owner is told so", () => {
  const db = join(dir, "old-look.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  const ada = h.join("ada", {}, { look: randomLook(new Rng(3)) });
  h.run(500);
  const pid = h.world.ents.pid[h.ent(ada)]!;
  // As a save written before the second layout holds it.
  const old = oldLook(4);
  h.host.records.byPid.get(pid)!.look = old;
  h.host.records.dirty.add(pid);
  ada.close();
  h.run(200);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db });
  const want = [...upgradeLook(old)];
  expect([...h2.host.records.byPid.get(pid)!.look!]).toEqual(want);
  const again = h2.join("ada", {}, { look: null });
  h2.run(600);
  expect(again.sessionState).toBe(SESSION_ALIVE);
  expect(again.ownLook!.length).toBe(LOOK_BYTES);
  expect(again.ownLook![LOOK_LAYOUT]).toBe(LAYOUT_VERSION);
  expect([...again.ownLook!]).toEqual(want);
  h2.host.shutdown();
});

test("a launch the browser kept with a 28-byte look opens the creator with it padded", () => {
  const old = oldLook(6);
  const launch = readLaunch(JSON.stringify({ intent: "create", name: "Ada", password: "", look: [...old], spawn: 0 }));
  expect(launch?.look).toEqual([...upgradeLook(old)]);
  expect(readLaunch(JSON.stringify({ intent: "create", name: "Ada", password: "", look: [...old, 0], spawn: 0 }))).toBeNull();
});
