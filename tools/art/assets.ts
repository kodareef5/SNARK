// Finds the asset folders under a source tree and loads what each says of itself.

import { basename, dirname, join, relative, sep } from "node:path";
import { SOURCE, filesUnder } from "./source.ts";
import type { AssetSpec } from "./spec.ts";

export interface Asset {
  /** "<pack>:<name>": the first folder under the source tree, and the asset's own folder. */
  id: string;
  name: string;
  dir: string;
  /** The pack it is converted to: <dir>/<name>.snpk. */
  file: string;
  spec: AssetSpec;
}

/** Every folder under `source` that holds an asset.ts, in path order. */
export async function findAssets(source: string = SOURCE): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const file of filesUnder(source, "asset.ts")) {
    if (basename(file) !== "asset.ts") continue;
    const dir = dirname(file);
    const name = basename(dir);
    const id = `${relative(source, dir).split(sep)[0]}:${name}`;
    const spec = ((await import(file)) as { default?: AssetSpec }).default;
    if (!spec || typeof spec.kind !== "string") throw new Error(`${file}: the default export is not an asset`);
    const twin = out.find((a) => a.id === id);
    if (twin) throw new Error(`${id} is both ${twin.dir} and ${dir}`);
    out.push({ id, name, dir, file: join(dir, `${name}.snpk`), spec });
  }
  return out;
}
