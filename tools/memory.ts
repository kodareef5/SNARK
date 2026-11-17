// What a process holds in memory, as the check weighs its test workers. Resident size leaves out compressed and swapped
// pages, which on a Mac under pressure are most of a worker's memory.

import { dlopen, FFIType, ptr } from "bun:ffi";
import { readFileSync } from "node:fs";

/** A process's memory in bytes, its compressed and swapped pages counted, or 0 once it has ended. */
export const footprint = ((): ((pid: number) => number) => {
  if (process.platform === "darwin") {
    const { symbols } = dlopen("/usr/lib/libSystem.B.dylib", { proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 } });
    // struct rusage_info_v4 (flavor 4) is 37 words of 64 bits; ri_phys_footprint is the tenth.
    const info = new BigUint64Array(37);
    return (pid) => (symbols.proc_pid_rusage(pid, 4, ptr(info)) === 0 ? Number(info[9]) : 0);
  }
  return (pid) => {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      return 1024 * ["VmRSS", "VmSwap"].reduce((kb, field) => kb + Number(new RegExp(`${field}:\\s+(\\d+)`).exec(status)?.[1] ?? 0), 0);
    } catch {
      return 0;
    }
  };
})();
