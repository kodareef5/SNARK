// Identity. Three different things, never interchangeable:
//
//   Handle      u32, runtime only. 20-bit slot index + 12-bit generation. Names a
//               live entity in one process and on the wire; a stale handle fails
//               to resolve instead of naming whatever reused the slot.
//   Pid         persistent id, a safe integer < 2^53: 13-bit world id of origin +
//               40-bit sequence. Survives saves, restarts and transfers.
//   Content id  stable string such as "core:wall". Compiled to a dense index per
//               content build; saves store the string, never the index.

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
