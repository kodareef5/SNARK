// Write-ahead logging shares memory between connections through a file beside the save, which a network file system
// cannot do safely. A save there can be corrupted, so it is refused unless the operator insists.

import { statfsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Linux file system type numbers (statfs f_type) of the network and pass-through kinds. */
const NETWORK: Record<number, string> = { 0x6969: "NFS", 0xff534d42: "CIFS", 0xfe534d42: "SMB", 0x01021997: "9p", 0x65735546: "FUSE" };

/** The kind of network file system `type` is, or null for a local one. */
export function networkDisk(type: number): string | null {
  return NETWORK[type >>> 0] ?? null;
}

/** Throws if the folder of `path` is on a network file system. Only Linux reports the type in a form this can read. */
export function refuseNetworkDisk(path: string, platform: string = process.platform, typeOf: (folder: string) => number = (folder) => Number(statfsSync(folder).type)): void {
  if (platform !== "linux") return;
  let type: number;
  try {
    type = typeOf(dirname(resolve(path)));
  } catch {
    return;
  }
  const kind = networkDisk(type);
  if (kind) throw new Error(`${path} is on a ${kind} disk, where a save can be corrupted: put it on a local disk, or start with -AllowNetworkSave`);
}
