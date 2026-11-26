import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIELDS, attributesOf } from "../../tools/mapworld/fetch-attributes.ts";

/** A work folder's fetched footprint pages, each feature with `fields` of its attributes. */
function pages(features: Record<string, unknown>[][]): string {
  const root = mkdtempSync(join(tmpdir(), "snark-attributes-"));
  mkdirSync(join(root, "raw", "fema"), { recursive: true });
  features.forEach((f, k) => writeFileSync(join(root, "raw", "fema", `page_${String(k).padStart(3, "0")}.json`), JSON.stringify({ features: f.map((attributes) => ({ attributes })) })));
  writeFileSync(join(root, "downloads.json"), JSON.stringify({ "fema/page_000.json": { retrieved_utc: "2026-11-25T10:00:00Z" } }));
  return root;
}
const row = (id: number) => Object.fromEntries(FIELDS.map((k) => [k, k === "OBJECTID" ? id : `${k}-${id}`]));

test("attributes come from the pages the outlines came in, in the fields' order", () => {
  const root = pages([[row(3), row(1)], [row(7)]]);
  try {
    const { rows, fetched } = attributesOf(join(root, "raw", "fema"), [1, 7]);
    expect(rows).toEqual([FIELDS.map((k) => (k === "OBJECTID" ? 1 : `${k}-1`)), FIELDS.map((k) => (k === "OBJECTID" ? 7 : `${k}-7`))]);
    expect(fetched).toBe("2026-11-25");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a footprint no page holds, or pages without the fields, stop the stage", () => {
  const root = pages([[row(1)], [{ OBJECTID: 2 }]]);
  try {
    expect(() => attributesOf(join(root, "raw", "fema"), [1, 9])).toThrow("1 of 2 footprints are in no fetched page");
    expect(() => attributesOf(join(root, "raw", "fema"), [2])).toThrow("lack HEIGHT");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
