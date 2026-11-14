// One server per save, a clean stop on a signal, and a file that is not trusted until it has been checked.
import { afterAll, expect, test } from "bun:test";
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { networkDisk, refuseNetworkDisk } from "../../server/persist/disk.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { Rules } from "../../server/settings/rules.ts";
import { stopOnSignals } from "../../server/signals.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-process-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const reg = coreRegistry();

interface Stood {
  x: number;
  z: number;
  pid: number;
  tick: number;
}

/** Starts the child and waits until it says where its survivor stands. */
async function child(db: string, mode: "hold" | "stop") {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../fixtures/hold-child.ts"), db, mode], { stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk);
    if (text.includes("\n")) break;
  }
  if (!text.startsWith("ready ")) throw new Error(`the child said "${text}"`);
  return { proc, stood: JSON.parse(text.slice(6)) as Stood };
}

test("a save held by one server cannot be opened by another, and is free again however the first one dies", async () => {
  const db = join(dir, "held.db");
  const { proc } = await child(db, "hold");
  expect(() => new WorldStore(db, reg)).toThrow("is in use by another server");
  expect(() => new Harness({}, 1, 60, { dbPath: db })).toThrow("is in use by another server");
  proc.kill(9);
  await proc.exited;
  const store = new WorldStore(db, reg);
  // Nor twice in one process.
  expect(() => new WorldStore(db, reg)).toThrow("is in use by another server");
  store.close();
  new WorldStore(db, reg).close();
});

test("a server told to stop saves every body where it stands and leaves no log behind", async () => {
  const db = join(dir, "stopped.db");
  const { proc, stood } = await child(db, "stop");
  proc.kill("SIGTERM");
  expect(await proc.exited).toBe(0);
  expect(!existsSync(`${db}-wal`) || statSync(`${db}-wal`).size === 0).toBe(true);
  const h = new Harness({}, 1, 60, { dbPath: db });
  const rec = h.host.records.byPid.get(stood.pid)!;
  expect(h.world.tick).toBe(stood.tick);
  expect([rec.x, rec.z]).toEqual([stood.x, stood.z]);
  // It walked for two and a half seconds, so a position from before the stop would be metres away.
  expect(rec.z).toBeGreaterThan(248);
  h.host.shutdown();
});

test("a stop that fails exits with 1, and each stop signal is heard", () => {
  const heard = new Map<string, () => void>();
  const exits: number[] = [];
  let stops = 0;
  const proc = { on: (signal: string, fn: () => void) => void heard.set(signal, fn), exit: (code: number) => void exits.push(code) };
  stopOnSignals(() => void stops++, proc);
  expect([...heard.keys()].sort()).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
  heard.get("SIGTERM")!();
  expect([stops, exits]).toEqual([1, [0]]);
  const said = console.error;
  console.error = () => {};
  stopOnSignals(() => {
    throw new Error("disk full");
  }, proc);
  heard.get("SIGHUP")!();
  console.error = said;
  expect(exits).toEqual([0, 1]);
});

test("a save must be a file on a local disk", () => {
  expect(() => new WorldStore(":memory:", reg)).toThrow("a save needs a file");
  expect(() => new WorldStore("", reg)).toThrow("a save needs a file");
  expect([0x6969, 0xff534d42, 0xfe534d42, 0x01021997, 0x65735546].map(networkDisk)).toEqual(["NFS", "CIFS", "SMB", "9p", "FUSE"]);
  // ext4, xfs, btrfs, tmpfs and overlay are local.
  expect([0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x794c7630].map(networkDisk)).toEqual([null, null, null, null, null]);
  // CIFS as a signed 32-bit number, as some systems report it.
  expect(networkDisk(0xff534d42 | 0)).toBe("CIFS");
  // Only Linux reports a type this can read. Elsewhere nothing is refused.
  expect(() => refuseNetworkDisk(join(dir, "x.db"), "darwin", () => 0x6969)).not.toThrow();
  expect(() => refuseNetworkDisk(join(dir, "x.db"), "linux", () => 0xef53)).not.toThrow();
  expect(() => refuseNetworkDisk(join(dir, "x.db"), "linux", () => 0x6969)).toThrow("is on a NFS disk");
  // The operator may insist, and the flag is ours.
  const { rules, report } = loadConfig({}, ["-AllowNetworkSave"]);
  expect([rules.flag("AllowNetworkSave"), new Rules().flag("AllowNetworkSave"), report.unknown.length]).toEqual([true, false, 0]);
  const h = new Harness({}, 1, 60, { dbPath: join(dir, "insisted.db"), config: rules });
  h.host.shutdown();
});

test("a damaged save is refused at the door, and the save beside it is let go", () => {
  const db = join(dir, "damaged.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  h.join("ada");
  h.run(1000);
  h.host.shutdown();
  // Garbage over the middle of the file, past the header page.
  const size = statSync(db).size;
  const fd = openSync(db, "r+");
  const junk = new Uint8Array(8192).fill(0xa5);
  for (let at = 4096; at + junk.length < size; at += 16384) writeSync(fd, junk, 0, junk.length, at);
  closeSync(fd);
  expect(() => new WorldStore(db, reg)).toThrow("is damaged");
  // The lock was released, so the refusal is the same the second time and not "in use".
  expect(() => new Harness({}, 1, 60, { dbPath: db })).toThrow("is damaged");
});
