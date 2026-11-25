import { expect, test } from "bun:test";
import { fetchContent } from "../../client/core/fetched.ts";
import { landmarkBounds, studioStatic } from "../../client/core/studio/subject.ts";
import { BENT_SECTIONS } from "../../content/bends.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { LANDMARKS } from "../../content/landmarks/index.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import type { ManifestMesh } from "../../shared/pack/manifest.ts";
import { studioContent } from "../../tools/build-entry.ts";
import { buildCatalogue } from "../../tools/wiki/catalogue.ts";
import { wikiModels } from "../../tools/wiki/models.ts";

test("the wiki viewer resolves deployed vehicles and authored loose meshes", () => {
  const entries = buildCatalogue({ landmarks: LANDMARKS });
  const models = wikiModels(entries, CORE_CONTENT, LANDMARKS);
  const read = (id: string) => JSON.parse(models.get(id)!.data);
  expect(read("core:boat_assembly")).toMatchObject({ kind: "content", target: "core:boat", meshes: ["core:boat"] });
  expect(read("core:club")).toMatchObject({ kind: "mesh", meshes: ["core:club/dropped"] });
  expect(read("core:banyan")).toMatchObject({ kind: "mesh", meshes: ["core:banyan_1"] });
  const koru = read("koru");
  expect([koru.kind, koru.name]).toEqual(["landmark", "koru"]);
  const visible = new Set(koru.structures.map((s: { id: string }) => s.id));
  const placed = LANDMARKS.find((l) => l.name === "koru")!.pieces.filter((p) => visible.has(p.kind));
  expect(placed.length).toBeGreaterThan(0);
  expect(JSON.stringify(koru.pieces)).toBe(JSON.stringify(placed));
  expect(koru.structures.every((s: { mesh: string }) => s.mesh !== "none")).toBe(true);
  expect(models.has("core:entangled")).toBe(false);

  const model = models.get("core:raptor")!;
  expect(new URL(model.url, "https://example.com").searchParams.get("model")).toBe(model.descriptor);
  expect(model.descriptor).toBe(`/wiki/${model.file}`);
});

test("a held-only item shows its held mesh when the pack lacks its dropped mesh", () => {
  const entries = buildCatalogue({ meshes: new Set(["core:club"]) });
  const model = wikiModels(entries, CORE_CONTENT, []).get("core:club")!;
  expect(JSON.parse(model.data)).toMatchObject({ kind: "mesh", meshes: ["core:club"] });
});

test("viewer bounds enclose rotated and offset landmark meshes", () => {
  const mesh = { center: [4, 1, 2], half: [3, 2, 1] } as ManifestMesh;
  const meshes = new Map([["ship:part", mesh]]);
  const bounds = landmarkBounds([{ kind: "ship:part", at: [10, 0, 0], yaw: 16384 }], meshes)!;
  expect(bounds.x).toBeCloseTo(12);
  expect(bounds.y).toBeCloseTo(1);
  expect(bounds.z).toBeCloseTo(-4);
  expect(bounds.radius).toBeCloseTo(Math.sqrt(14));
  expect(landmarkBounds([{ kind: "ship:collision", at: [0, 0, 0], yaw: 0 }], meshes)).toBeNull();
});

test("an authored loose mesh can stand in the studio as a static", () => {
  const mesh = { id: "core:club", center: [0, 0, 0], half: [0.2, 0.1, 0.4] } as ManifestMesh;
  const base = compileContent(CORE_CONTENT).registry!;
  const d = studioStatic("studio:mesh", mesh, 3);
  const reg = withContent(base, [d]);
  expect(reg.defs[reg.index.get(d.id)!]).toEqual(d);
});

test("the studio keeps valid content and omits the city's breakable pieces", async () => {
  const defs = studioContent(CORE_CONTENT);
  expect(defs.some((def) => def.type === "structure" && def.breaks)).toBe(false);
  const compiled = compileContent([...defs, ...BENT_SECTIONS]);
  expect(compiled.errors).toEqual([]);
  expect(compiled.registry?.index.has("core:raptor")).toBe(true);
  expect(compiled.registry?.index.has("core:piece_foundation_wood")).toBe(true);
  const get = async () => Response.json(defs);
  const page = await fetchContent(get, "studio.json", "studio");
  expect(page.index.has("core:piece_foundation_wood")).toBe(true);
  expect(page.index.has("core:zruin_wall4_concrete")).toBe(false);
});
