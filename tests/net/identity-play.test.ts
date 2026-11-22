import { expect, test } from "bun:test";
import { loadIdentity, type IdentityStore } from "../../client/core/identity.ts";
import { Rng } from "../../shared/rng.ts";
import { Harness } from "../fixtures/net.ts";

test("reloading the default browser identity returns to the same survivor and inventory beyond the new-name quota", () => {
  const h = new Harness({}, 1, 60, { startingCreatures: 0 });
  const values = new Map<string, string>();
  const store: IdentityStore = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  const rng = new Rng(29);
  const random = (bytes: Uint8Array): void => { for (let i = 0; i < bytes.length; i++) bytes[i] = rng.int(256); };
  const stone = h.reg.index.get("core:stone")!;
  let pid = 0;
  try {
    for (let i = 0; i < 10; i++) {
      const identity = loadIdentity(store, random);
      const s = h.join(identity.name, {}, { key: identity.key });
      Object.defineProperty(h.ends[i]!.peer, "address", { value: "same-browser" });
      h.run(200);
      const c = h.client(s);
      expect(c?.active).toBe(true);
      if (i === 0) {
        pid = c!.pid;
        h.host.items.mint(h.host.records.byPid.get(pid)!, stone, 7);
      }
      expect(c!.pid).toBe(pid);
      h.run(100);
      expect(s.inventory!.total(stone)).toBe(7);
      h.ends[i]!.close();
      h.run(100);
    }
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});
