import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { LANDMARKS } from "../../content/landmarks/index.ts";
import { KINDS } from "../../tools/wiki/catalogue.ts";
import { GUIDES, guidePath } from "../../tools/wiki/guides.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { BASE } from "../../tools/wiki/html.ts";
import { photoChunks, photoReady, type PhotoStatus, type SceneBrief } from "../../tools/wiki/photo-recipe.ts";
import { FOOTER_SHOT, photoName, photoPosition, WIKI_SCENE_BRIEFS } from "../../tools/wiki/photo-recipes.ts";
import { buildWikiScenes } from "../../tools/wiki/scenes.ts";

test("each wiki section has its own scene with a caption and alt text", () => {
  const expected = ["", "guides/", "reference/", "server/", "about/", "maps/", "engrams/", "levels/", "sounds/", "music/", "controls/", "commands/", "settings/", "credits/", "footer",
    ...KINDS.map((kind) => `${kind}/`), ...GUIDES.map((guide) => guidePath(guide.slug).slice(BASE.length))];
  const routes = WIKI_SCENE_BRIEFS.map((shot) => shot.route);
  expect(new Set(routes).size).toBe(routes.length);
  expect(routes).toEqual(expect.arrayContaining(expected));
  for (const shot of WIKI_SCENE_BRIEFS) {
    expect(shot.caption.trim()).not.toBe("");
    expect(shot.alt.trim()).not.toBe("");
    expect(shot.actors.length > 0 || shot.absoluteHeight).toBe(true);
  }
});

test("scene subjects reference species, structures and resources from the game", () => {
  const content = new Map(CORE_CONTENT.map((def) => [def.id, def.type]));
  for (const shot of WIKI_SCENE_BRIEFS) {
    for (const [id] of shot.actors) expect(content.get(`core:${id}`)).toBe("species");
    for (const [id] of shot.props ?? []) expect(content.get(`core:${id}`)).toBe("structure");
    for (const [id] of shot.plants ?? []) expect(content.get(`core:${id}`)).toBe("node");
    if (shot.landmark) expect(LANDMARKS.some((landmark) => landmark.name === shot.landmark)).toBe(true);
  }
});

test("the footer reuses the Red Obelisk loading set at a wider camera angle", () => {
  const shot = WIKI_SCENE_BRIEFS.find((brief) => brief.route === "footer")!;
  expect(shot.actors.some(([id]) => id === "rex")).toBe(true);
  expect(FOOTER_SHOT.set).toBe("wynwood-shore");
  expect(FOOTER_SHOT.camera.side).toBeLessThan(0);
});

test("the stage requests exact ground for the camera and nearby cast", () => {
  const shot: SceneBrief = {
    route: "test/", caption: "", alt: "", hour: 10, view: [5, 1, -5, 0, 0, 40],
    actors: [["survivor", 0, 5, 0]], props: [["storage_box", 5, 0]], plants: [["palm", 5, 5]],
  };
  expect(photoChunks({ chunksX: 2, chunksZ: 2 }, shot, [CHUNK_SIZE - 1, CHUNK_SIZE - 1, 0])).toEqual([0, 1, 2, 3]);
  expect(photoChunks({ chunksX: 2, chunksZ: 2 }, shot, [CHUNK_SIZE - 1, CHUNK_SIZE - 1, 90])).toEqual([0, 1]);
});

test("a photo waits for the ground, the city and nearby roads", () => {
  const shot = WIKI_SCENE_BRIEFS.find((brief) => brief.route === "vehicles/")!;
  const ready: PhotoStatus = { near: true, whole: true, left: 0, roads: 0, frames: 24, quiet: 6, milliseconds: 3200, city: 1, frozen: 0, errors: [] };
  expect(photoReady(shot, ready)).toBe(true);
  for (const status of [{ near: false }, { whole: false }, { left: 1 }, { roads: 1 }, { quiet: 5 }, { city: 0 }]) {
    expect(photoReady(shot, { ...ready, ...status })).toBe(false);
  }
});

test("the wiki packages the generated section, card and portrait images", () => {
  const temp = mkdtempSync(join(tmpdir(), "snark-wiki-scenes-"));
  const source = join(temp, "photos");
  const output = join(temp, "media");
  try {
    mkdirSync(source);
    const webp = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQtiY1qv+BiOh/AAA=", "base64");
    for (const { route } of WIKI_SCENE_BRIEFS) {
      const name = photoName(route);
      writeFileSync(join(source, `${name}.webp`), webp);
      if (route !== "footer") writeFileSync(join(source, `${name}.card.webp`), webp);
      if (!route) writeFileSync(join(source, "home.portrait.webp"), webp);
    }
    const scenes = buildWikiScenes(source, output, "/wiki/media/", true);
    for (const [route, scene] of scenes) {
      if (route && route !== "footer") expect(photoPosition(route).every(Number.isFinite)).toBe(true);
      const images = [scene.picture, scene.card, scene.portrait].filter((image) => image !== undefined);
      for (const image of images) {
        const bytes = readFileSync(join(output, image.file.split("/").at(-1)!));
        expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
        expect(bytes.length).toBeLessThanOrEqual((image === scene.card ? 64 : 320) * 1024);
      }
    }
    expect(scenes.get("")?.portrait?.height).toBeGreaterThan(scenes.get("")!.portrait!.width);
    expect(scenes.get("vehicles/")?.card?.file).toEndWith(".card.webp");
    expect(scenes.get("vehicles/")?.picture.small).toEqual(scenes.get("vehicles/")?.card);
    const withoutMiami = buildWikiScenes(source, join(temp, "without-miami"), "/wiki/media/", false);
    expect([...withoutMiami.keys()]).toEqual(["", "footer"]);
    writeFileSync(join(source, "home.card.webp"), Buffer.alloc(64 * 1024 + 1));
    expect(() => buildWikiScenes(source, output, "/wiki/media/", true)).toThrow("exceeds 64 KiB");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
