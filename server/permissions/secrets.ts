// A survivor's own password: 16 letters the server makes as the survivor claims it, shown once to that survivor alone and
// kept only as a hash in the permissions store. It is compared as typed loosely, in any case and with or without its spaces
// and dashes. A password replaced or cleared is remembered for a day, so a page still sending it is refused without its
// address being counted as guessing.

import { randomBytes, randomInt } from "node:crypto";
import { isSurvivorId } from "../../shared/permissions/model.ts";
import type { StaffPasswords } from "../admin/gate.ts";
import type { Host } from "../host.ts";
import { ALPHABET } from "../survivor-access.ts";
import { idText } from "../survivor-ids.ts";

export const PASSWORD_LETTERS = 16;
/** How long a retired password is remembered. */
export const RETIRED_MS = 24 * 3600 * 1000;
/** Retired passwords remembered at most; the oldest is forgotten first. */
const RETIRED_MOST = 1024;

/** A new password, written in four groups of four: ABCD-EFGH-JKLM-NPQR. */
export function makePassword(): string {
  const letters = Array.from({ length: PASSWORD_LETTERS }, () => ALPHABET[randomInt(ALPHABET.length)]!);
  return [0, 4, 8, 12].map((at) => letters.slice(at, at + 4).join("")).join("-");
}

/** A password as it is compared: upper case, without spaces or dashes. */
export function passwordText(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/g, "");
}

/** The hash a password is kept as, in hex. */
export function passwordHash(typed: string): string {
  return new Bun.CryptoHasher("sha256").update(passwordText(typed)).digest("hex");
}

/** Whether two hashes are the same, looking at every letter so the time taken does not say where they differ. */
export function sameHash(a: string, b: string): boolean {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i % Math.max(1, y.length));
  return diff === 0;
}

/** Compared where a survivor has no password, so the time taken does not say whether it has one. No typed text gives it. */
export const DUMMY_HASH = new Bun.CryptoHasher("sha256").update(randomBytes(32)).digest("hex");

/** Hashes of passwords that were replaced or cleared, each for a day. */
export class Retired {
  /** When each was retired, oldest first. */
  private readonly by = new Map<string, number>();

  add(hash: string, now: number): void {
    const key = hash.toLowerCase();
    this.by.delete(key);
    this.by.set(key, now);
    if (this.by.size > RETIRED_MOST) this.by.delete(this.by.keys().next().value!);
  }

  has(hash: string, now: number): boolean {
    for (const [key, at] of this.by) {
      if (now - at < RETIRED_MS) break;
      this.by.delete(key);
    }
    return this.by.has(hash.toLowerCase());
  }
}

/** What the admin pages' gate needs to take a survivor's own password. */
export function staffPasswords(host: Host): StaffPasswords {
  const p = host.permissions;
  return {
    any: () => p.anySecret(),
    retired: (hash) => p.retired(hash),
    find(user) {
      const byId = isSurvivorId(user);
      const rec = (byId ? host.survivorById(user) : host.survivorRecord(user)) ?? undefined;
      const id = byId ? user : rec ? idText(rec) : "";
      // Looked up for a name no survivor has too, so the work done is the same.
      const [hash, rank] = [p.secretOf(id), p.rankOf({ id, team: 0, signed: true, world: p.world })];
      return id === "" ? null : { name: rec?.name ?? id, id, pid: rec?.pid ?? 0, hash, rank };
    },
  };
}
