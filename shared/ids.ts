// Four kinds of id, never interchangeable:
//   Handle      u32, at run time and on the wire only. 20-bit slot index + 12-bit generation, so a stale handle fails to
//               resolve instead of naming the slot's new entity.
//   Pid         persistent id, a safe integer < 2^53. 13-bit world id of origin + 40-bit sequence. Survives saves, restarts
//               and transfers.
//   Content id  stable string such as "core:wall". Saves store the string, never the dense index it compiles to.
//   Survivor ID 17-digit decimal string shaped like a SteamID64 and unrelated to Steam, for admins to type: its base plus a
//               32-bit number, 12-bit world id of origin + 20-bit count of that world's survivors. A record keeps the number.

export const HANDLE_INDEX_BITS = 20;
export const HANDLE_INDEX_MASK = 0xfffff;
export const HANDLE_GEN_MASK = 0xfff;
export const NULL_HANDLE = 0;

export function makeHandle(index: number, gen: number): number {
  return ((gen << HANDLE_INDEX_BITS) | index) >>> 0;
}

export function handleIndex(handle: number): number {
  return handle & HANDLE_INDEX_MASK;
}

export function handleGen(handle: number): number {
  return handle >>> HANDLE_INDEX_BITS;
}

const PID_SEQ_RANGE = 1099511627776; // 2^40
export const MAX_WORLD_ID = 8191;

export function makePid(worldId: number, seq: number): number {
  return worldId * PID_SEQ_RANGE + seq;
}

export function pidWorld(pid: number): number {
  return Math.floor(pid / PID_SEQ_RANGE);
}

export function pidSeq(pid: number): number {
  return pid % PID_SEQ_RANGE;
}

/** The lowest SteamID64 of an individual account. A survivor's ID is this plus its 32-bit number. */
const ID_BASE = 76561197960265728n;
/** Survivors each world can number. */
export const ID_COUNT_RANGE = 1048576; // 2^20
export const MAX_ID_WORLD = 4095;

/** The ID of world `world`'s `n`th survivor. */
export function idOf(world: number, n: number): string {
  if (!Number.isInteger(world) || world < 1 || world > MAX_ID_WORLD || !Number.isInteger(n) || n < 1 || n >= ID_COUNT_RANGE) throw new Error(`no ID is world ${world}'s survivor ${n}`);
  return (ID_BASE + BigInt(world * ID_COUNT_RANGE + n)).toString();
}

/** The world and count an ID was made from, or null for what is not one. */
export function idParts(id: string): { world: number; n: number } | null {
  if (!/^[0-9]{17}$/.test(id)) return null;
  const v = BigInt(id) - ID_BASE;
  if (v < 0n || v >= 1n << 32n) return null;
  const world = Math.floor(Number(v) / ID_COUNT_RANGE);
  const n = Number(v) % ID_COUNT_RANGE;
  return world >= 1 && n >= 1 ? { world, n } : null;
}
