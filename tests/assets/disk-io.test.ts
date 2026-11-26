import { expect, test } from "bun:test";
import { DiskWrites, writePart } from "../../client/core/assets/disk-io.ts";

test("disk writes share a pending hash and the counter drains on failure", async () => {
  const seen: number[] = [], began: string[] = [];
  const queue = new DiskWrites(() => seen.push(queue.pending));
  let fail!: (why: Error) => void;
  const first = queue.save("a", () => {
    began.push("a");
    return new Promise((_resolve, reject) => { fail = reject; });
  });
  const duplicate = queue.save("a", async () => { throw new Error("duplicate writer"); });
  const second = queue.save("b", async () => { began.push("b"); return true; });
  expect(duplicate).toBe(first);
  expect(queue.pending).toBe(2);
  await Promise.resolve();
  expect(began).toEqual(["a"]);
  fail(new Error("quota"));
  expect(await Promise.all([first, duplicate, second])).toEqual([false, false, true]);
  expect(began).toEqual(["a", "b"]);
  expect(seen).toEqual([1, 2, 1, 0]);
  expect(await queue.save("a", async () => true)).toBe(true);
});

test("clearing or dropping parts orders later saves behind the deletion", async () => {
  const queue = new DiskWrites(() => {});
  const files = new Map<string, number>();
  const save = (hash: string, value: number): Promise<boolean> =>
    queue.save(hash, async () => { files.set(hash, value); return true; });
  const first = save("a", 1);
  const other = save("b", 2);
  const clear = queue.remove(async () => { files.clear(); });
  const saved = save("a", 3);
  const drop = queue.remove(async () => { files.delete("a"); }, "a");
  const kept = save("a", 4);
  expect(first).not.toBe(saved);
  expect(saved).not.toBe(kept);
  await Promise.all([first, other, clear, saved, drop, kept]);
  expect([...files]).toEqual([["a", 4]]);
  expect(queue.pending).toBe(0);
});

test("a failed async write or commit aborts its writable stream", async () => {
  for (const failure of ["write", "close", "none"]) {
    const ran: string[] = [];
    const file = {
      async createWritable() {
        return {
          async write() {
            ran.push("write");
            if (failure === "write") throw new Error("quota");
          },
          async close() {
            ran.push("close");
            if (failure === "close") throw new Error("quota");
          },
          async abort() { ran.push("abort"); },
        };
      },
      async createSyncAccessHandle() { throw new Error("sync fallback called"); },
    };
    const written = writePart(file, new Uint8Array([7, 3]));
    if (failure === "none") await written;
    else await expect(written).rejects.toThrow("quota");
    expect(ran).toEqual(failure === "write" ? ["write", "abort"] : failure === "close" ? ["write", "close", "abort"] : ["write", "close"]);
  }
});

test("the fallback writer closes its handle after a full or short write", async () => {
  for (const length of [2, 1]) {
    const ran: string[] = [];
    const file = {
      async createSyncAccessHandle() {
        return {
          write(data: Uint8Array, at: { at: number }) {
            expect([Array.from(data), at.at]).toEqual([[7, 3], 0]);
            ran.push("write");
            return length;
          },
          flush() { ran.push("flush"); },
          close() { ran.push("close"); },
        };
      },
    };
    const written = writePart(file, new Uint8Array([7, 3]));
    if (length === 2) await written;
    else await expect(written).rejects.toThrow("short disk write");
    expect(ran).toEqual(length === 2 ? ["write", "flush", "close"] : ["write", "close"]);
  }
});
