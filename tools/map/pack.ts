// A map file written with its copies for the wire, once, so the server compresses nothing: Brotli, and gzip for a browser
// that takes no Brotli (on plain http). The Brotli is flushed where the ground ends, so what a client waits for before it
// draws is known to the byte, and both it and the whole are held to budgets here.

import { readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { constants, createBrotliCompress, gzipSync } from "node:zlib";
import { groundBytes, mapCopy } from "../../shared/world/mapfile.ts";

/**
 * Brotli bytes before a client can draw. There to catch a mistake, with room for a city with relief: Miami's ground is
 * 6.2 MB (2.5 s at 20 Mbit/s, the phone link the asset bench takes), a hilly city's about 11.
 */
export const GROUND_BUDGET = 16 << 20;
/** Brotli bytes of the whole map, the statics the far city draws from among them. */
export const MAP_BUDGET = 32 << 20;

export interface Packed {
  readonly br: Uint8Array;
  readonly gz: Uint8Array;
  /** Brotli bytes up to the end of the ground. */
  readonly ground: number;
}

export async function packMap(file: Uint8Array): Promise<Packed> {
  const ground = groundBytes(file);
  const params = { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: file.length };
  const brotli = createBrotliCompress({ params });
  const parts: Buffer[] = [];
  brotli.on("data", (part: Buffer) => parts.push(part));
  const ended = new Promise((done, failed) => brotli.on("end", done).on("error", failed));
  brotli.write(file.subarray(0, ground));
  await new Promise<void>((done) => brotli.flush(constants.BROTLI_OPERATION_FLUSH, () => done()));
  const head = parts.reduce((n, p) => n + p.length, 0);
  brotli.end(file.subarray(ground));
  await ended;
  return { br: Buffer.concat(parts), gz: gzipSync(file, { level: 9 }), ground: head };
}

const mb = (bytes: number): string => (bytes / 1e6).toFixed(2);

/** Writes the map at `path` and its copies, and takes away copies of any file that was there before. Throws over a budget. */
export async function writeMapFile(path: string, file: Uint8Array): Promise<Packed> {
  const packed = await packMap(file);
  if (packed.ground > GROUND_BUDGET) throw new Error(`map: a client waits for ${mb(packed.ground)} MB of it before it draws, over the ${mb(GROUND_BUDGET)} MB of tools/map/pack.ts`);
  if (packed.br.length > MAP_BUDGET) throw new Error(`map: it is ${mb(packed.br.length)} MB on the wire, over the ${mb(MAP_BUDGET)} MB of tools/map/pack.ts`);
  const hash = new DataView(file.buffer, file.byteOffset).getUint32(8, true);
  const [br, gz] = [mapCopy(path, hash, "br"), mapCopy(path, hash, "gz")];
  const stale = new RegExp(`^${basename(path).replace(/\./g, "\\.")}\\.[0-9a-f]{8}\\.(br|gz)$`);
  for (const name of readdirSync(dirname(path))) if (stale.test(name) && ![br, gz].includes(join(dirname(path), name))) rmSync(join(dirname(path), name));
  writeFileSync(br, packed.br);
  writeFileSync(gz, packed.gz);
  writeFileSync(`${path}.tmp`, file);
  renameSync(`${path}.tmp`, path);
  return packed;
}
