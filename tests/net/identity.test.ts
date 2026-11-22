import { expect, test } from "bun:test";
import { loadIdentity, type IdentityStore } from "../../client/core/identity.ts";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";

function browser() {
  const values = new Map<string, string>();
  const store: IdentityStore = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  const rng = new Rng(17);
  const random = (bytes: Uint8Array): void => { for (let i = 0; i < bytes.length; i++) bytes[i] = rng.int(256); };
  return { values, store, random, boot: (name: string | null = null) => loadIdentity(store, random, name) };
}

test("default identity survives repeated page boots, and explicit names leave that default intact", () => {
  const { boot, values } = browser();
  const first = boot();
  expect(first.name).toMatch(/^[A-Za-z0-9 _-]{1,24}$/);
  expect(first.key.length).toBe(KEY_BYTES);
  for (let i = 0; i < 12; i++) expect(boot()).toEqual(first);
  expect(boot("Scout")).toEqual({ name: "Scout", key: first.key });
  expect(boot()).toEqual(first);
  expect(values.get("snark.name")).toBe(first.name);
});

test("existing device keys are preserved, while malformed storage cannot turn into an all-zero key or an invalid default name", () => {
  const { boot, values } = browser();
  const existing = "0123456789abcdef".repeat(2);
  values.set("snark.key", existing);
  const migrated = boot();
  expect(values.get("snark.key")).toBe(existing);
  expect([...migrated.key]).toEqual([1, 35, 69, 103, 137, 171, 205, 239, 1, 35, 69, 103, 137, 171, 205, 239]);
  expect(boot()).toEqual(migrated);
  values.set("snark.name", "x".repeat(25));
  const repaired = boot();
  expect(repaired.name.length).toBeLessThanOrEqual(24);
  expect(boot()).toEqual(repaired);
  values.set("snark.key", "z".repeat(KEY_BYTES * 2));
  const replaced = boot();
  expect(replaced.key.some((b) => b !== 0)).toBe(true);
  expect(replaced.name).not.toBe(repaired.name);
  expect(boot()).toEqual(replaced);
});

test("unavailable storage still allows a session and explicit names need no name persistence", () => {
  const { random } = browser();
  const denied: IdentityStore = { getItem: () => { throw new Error("storage denied"); }, setItem: () => { throw new Error("storage denied"); } };
  expect(loadIdentity(denied, random).name).toMatch(/^survivor[0-9a-f]{16}$/);
  expect(loadIdentity(denied, random, "Scout").name).toBe("Scout");
});
