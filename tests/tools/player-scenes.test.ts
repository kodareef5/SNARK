import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TitleScenes } from "../../server/admin/title-scenes.ts";
import { compileSceneDeclarations, DEFAULT_LOADER_SHOT, readLoaderScene } from "../../shared/player-scenes.ts";
import schema from "../../shared/player-scene-declarations.schema.json" with { type: "json" };
import { CAMERA_FIELDS, OPENING_SHOT, type CameraField } from "../../shared/title-scene.ts";
import { photoName, photoPosition, WIKI_SCENE_BRIEFS } from "../../tools/wiki/photo-recipes.ts";
import { PLACE_RECIPES } from "../../tools/wiki/places-shots.ts";
import { wikiSceneCatalog, wikiSceneMedia } from "../../tools/wiki/studio-catalog.ts";

const example = [
  { id: "opening", category: "title", name: "Opening" },
  { id: "coast", category: "loaders", name: "Coastal morning", subject: "coast", camera: { hour: 8 } },
];

test("a declaration can inherit a camera and override just one field", () => {
  const scenes = compileSceneDeclarations({ scenes: example });
  expect(scenes.title[0]?.camera).toEqual(OPENING_SHOT.camera);
  expect(scenes.title[0]?.subject).toBeUndefined();
  expect(scenes.loaders[0]?.subject).toBe("coast");
  expect(scenes.loaders[0]?.camera).toEqual({ ...DEFAULT_LOADER_SHOT.camera, hour: 8 });
  for (const field of Object.keys(CAMERA_FIELDS) as CameraField[]) {
    const [, low, high] = CAMERA_FIELDS[field];
    expect(schema.properties.scenes.items.properties.camera.properties[field]).toMatchObject({ minimum: low, maximum: high });
  }
});

test("build validation rejects invalid IDs, categories and camera fields", () => {
  const other = example[1]!;
  for (const [scene, failure] of [
    [{ ...other, id: "../another" }, "lowercase slug ID"],
    [{ ...other, id: "opening" }, "duplicates the ID"],
    [{ ...other, category: "wiki" }, "category title or loaders"],
    [{ ...other, name: " " }, "name of 1 to 80 characters"],
    [{ ...other, camera: { hour: 30 } }, "camera hour between"],
    [{ ...other, camera: { altitude: 3 } }, "unknown camera field"],
    [{ ...other, subject: "unavailable" }, "subject rider, rex or coast"],
  ] as const) {
    expect(() => compileSceneDeclarations({ scenes: [example[0], scene] })).toThrow(failure);
  }
});

test("the loader descriptor uses only the cluster's own poster routes", () => {
  expect(readLoaderScene({ shot: { ...OPENING_SHOT, camera: { ...OPENING_SHOT.camera, lens: 0 } } })).toBeNull();
  expect(readLoaderScene({ shot: DEFAULT_LOADER_SHOT, landscape: "https://outside.example/track" })).toEqual({
    shot: DEFAULT_LOADER_SHOT, landscape: "/cluster/loader-poster.webp", portrait: "/cluster/loader-poster.webp?portrait",
  });
});

test("the Wiki catalogue enumerates the actual section and atlas recipes", () => {
  const catalog = new Map(wikiSceneCatalog().map((recipe) => [recipe.id, recipe]));
  for (const composition of WIKI_SCENE_BRIEFS) {
    const { route } = composition;
    const entry = catalog.get(`wiki-${photoName(route)}`);
    if (!route || route === "footer") expect(entry?.kind).toBe("shore");
    else expect(entry).toMatchObject({ kind: "section", composition, position: photoPosition(route) });
  }
  for (const [map, photos] of Object.entries(PLACE_RECIPES)) for (const photo of photos) {
    expect(catalog.get(`wiki-${map}-${photo.name}`)).toMatchObject({ map, kind: photo.kind, camera: photo.camera });
  }
});

test("Wiki recipes stay visible before opt-in photography is built", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-studio-wiki-"));
  const store = new TitleScenes(join(dir, "studio.sqlite"), dir);
  try {
    const catalogue = JSON.stringify(wikiSceneCatalog());
    const recipes: unknown = JSON.parse(catalogue);
    writeFileSync(join(dir, "scene-catalog.json"), catalogue);
    const get = () => store.admin(new Request("https://snark.example/admin/scenes/api?category=wiki"));
    expect(await (await get()).json()).toEqual({ recipes, media: {} });
    const landscape = { file: "/wiki/media/scene-home.0123456789abcdef.webp", width: 1600, height: 900 };
    const media = wikiSceneMedia(new Map([["", { picture: landscape, caption: "Rex", alt: "Rex" }]]), new Map());
    mkdirSync(join(dir, "wiki"));
    writeFileSync(join(dir, "wiki/scene-media.json"), JSON.stringify(media));
    expect(await (await get()).json()).toEqual({ recipes, media: { "wiki-home": { landscape } } });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
