// The shell supplies storage and cryptographic randomness; survivor selection is testable without a browser.

import { KEY_BYTES } from "../../shared/net/protocol.ts";

export interface IdentityStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Existing device keys keep ownership of named survivors. An explicit URL name does not replace the default. */
export function loadIdentity(store: IdentityStore, random: (bytes: Uint8Array<ArrayBuffer>) => void, requested: string | null = null): { name: string; key: Uint8Array } {
  const read = (name: string): string | null => {
    try { return store.getItem(name); } catch { return null; }
  };
  const write = (name: string, value: string): void => {
    try { store.setItem(name, value); } catch {}
  };
  const saved = read("snark.key");
  const key = new Uint8Array(KEY_BYTES);
  const haveKey = saved !== null && saved.length === KEY_BYTES * 2 && /^[0-9a-f]+$/i.test(saved);
  if (haveKey) {
    for (let i = 0; i < KEY_BYTES; i++) key[i] = parseInt(saved.slice(i * 2, i * 2 + 2), 16);
  } else {
    random(key);
    write("snark.key", hex(key));
  }
  if (requested !== null) return { name: requested, key };
  // A name saved under a lost or corrupt key is no longer owned by this identity.
  const name = haveKey ? read("snark.name") : null;
  if (name !== null && /^[A-Za-z0-9 _-]{1,24}$/.test(name)) return { name, key };
  // A name uses its own randomness, never bytes from the secret device key.
  const suffix = new Uint8Array(8);
  random(suffix);
  const made = `survivor${hex(suffix)}`;
  write("snark.name", made);
  return { name: made, key };
}
