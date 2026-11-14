// Three kinds of id, never interchangeable:
//   Handle      u32, at run time and on the wire only. 20-bit slot index + 12-bit generation, so a stale handle fails to
//               resolve instead of naming the slot's new entity.
//   Pid         persistent id, a safe integer < 2^53. 13-bit world id of origin + 40-bit sequence. Survives saves, restarts
//               and transfers.
//   Content id  stable string such as "core:wall". Saves store the string, never the dense index it compiles to.

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
