import { expect, test } from "bun:test";
import { tamingMaximum, tamingRow, tamingRows } from "../../client/core/wiki/rates.ts";
import type { ServerSaid } from "../../client/core/wiki/world.ts";
import { buildCatalogue } from "../../tools/wiki/catalogue.ts";
import { buildDirectory } from "../../tools/wiki/directories.ts";
import { GUIDES, guidePath } from "../../tools/wiki/guides.ts";

const entries = buildCatalogue();

test("every guide links to an existing wiki entry or reference", () => {
  const ids = new Set(entries.map((entry) => entry.id));
  const paths = new Set(["/wiki/maps/", "/wiki/controls/", "/wiki/controls/#build", "/wiki/controls/#flight", "/wiki/resources/", "/wiki/engrams/", ...GUIDES.map((guide) => guidePath(guide.slug))]);
  for (const guide of GUIDES) {
    expect(guide.sections.length).toBeGreaterThan(1);
    expect(new Set(guide.sections.map((section) => section.id)).size).toBe(guide.sections.length);
    for (const section of guide.sections) {
      for (const step of section.steps) {
        for (const part of step) {
          if (typeof part === "string") continue;
          if ("href" in part) expect(paths.has(part.href)).toBe(true);
          else expect(ids.has(part.id)).toBe(true);
        }
      }
    }
  }
});

test("directories expose useful facts and keep linked contents", () => {
  const creatures = buildDirectory("creatures", entries)!;
  const raptor = creatures.rows.find((row) => row.entry.id === "core:raptor")!;
  expect(raptor.filters).toMatchObject({ temper: "Aggressive", tameable: "Yes", rideable: "Yes" });
  expect(raptor.cells[creatures.columns.indexOf("Saddle")]).toEqual([{ id: "core:saddle_raptor" }]);
  expect(creatures.filters.find((filter) => filter.key === "rideable")?.values).toEqual(["No", "Yes"]);

  const items = buildDirectory("items", entries)!;
  const narcotic = items.rows.find((row) => row.entry.id === "core:narcotic")!;
  expect(narcotic.filters.recipe).toBe("Has recipe");
  expect(narcotic.cells[items.columns.indexOf("Made at")]).toEqual([{ id: "core:piece_mortar" }]);

  const resources = buildDirectory("resources", entries)!;
  const rock = resources.rows.find((row) => row.entry.id === "core:rock")!;
  expect(rock.cells[resources.columns.indexOf("Yields")]).toContainEqual({ id: "core:flint" });
  expect(rock.cells[resources.columns.indexOf("Tools")]).toContainEqual({ id: "core:pick" });

  const vehicles = buildDirectory("vehicles", entries)!;
  const compact = vehicles.rows.find((row) => row.entry.id === "core:compact")!;
  const trailer = vehicles.rows.find((row) => row.entry.id === "core:air_trailer")!;
  expect(compact.cells[vehicles.columns.indexOf("Top speed")]).toEqual(compact.entry.facts[0]!.value);
  expect(trailer.cells[vehicles.columns.indexOf("Top speed")]).toEqual([]);
});

test("exact taming estimates use the active world's speed and difficulty", () => {
  const dodo = entries.find((entry) => entry.id === "core:dodo")!;
  const tame = dodo.tables.find((table) => table.taming)!.taming!;
  const boosted: ServerSaid = { name: "A 50x server", map: "core:miami", settings: { TamingSpeedMultiplier: 50, OverrideOfficialDifficulty: 2 } };
  expect(tamingMaximum()).toBe(150);
  expect(tamingMaximum(boosted)).toBe(60);
  expect(tamingRow(tame, 42)).toEqual(["42", "104", "3 min 5 s", "18 in 2 min 24 s", "0", "0"]);
  expect(tamingRow(tame, 42, boosted)).toEqual(["42", "104", "3 min 5 s", "1 in 8 s", "0", "0"]);
  expect(tamingRows(tame, boosted).at(-1)).toEqual(tamingRow(tame, tamingMaximum(boosted), boosted));
});
