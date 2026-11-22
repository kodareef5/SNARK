import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAR_MESH } from "../../client/core/render/far.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePack } from "../../tools/snap/files.ts";

test("an explicitly selected review source keeps the native far-city mesh just like the client build", () => {
  const source = mkdtempSync(join(tmpdir(), "snark-snap-source-"));
  try {
    const pack = parsePack(corePack(source));
    const far = pack.header.meshes.find(mesh => mesh.id === FAR_MESH);
    expect(far).toBeDefined(); expect(far!.half[1]).toBe(512); expect(far!.lods).toHaveLength(1);
  } finally { rmSync(source, { recursive: true, force: true }); }
});
