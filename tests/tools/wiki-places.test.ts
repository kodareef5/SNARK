import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FRAME_MIDDLE } from "../../shared/coords.ts";
import { img } from "../../tools/wiki/html.ts";
import { buildPlaceShots, projectCityCamera } from "../../tools/wiki/places-shots.ts";

test("the atlas ships responsive city photos and one smaller cover", () => {
  const temp = mkdtempSync(join(tmpdir(), "snark-wiki-places-"));
  const source = join(temp, "tampa");
  const media = join(temp, "media");
  try {
    mkdirSync(source);
    mkdirSync(media);
    const webp = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQtiY1qv+BiOh/AAA=", "base64");
    for (const name of ["downtown", "ybor-city", "sextant", "lantern", "tide-eye"]) {
      writeFileSync(join(source, `${name}.webp`), webp);
      writeFileSync(join(source, `${name}.small.webp`), webp);
    }
    writeFileSync(join(source, "cover.webp"), webp);
    const shots = buildPlaceShots(new Map([["tampa", source], ["new-city", join(temp, "unbuilt")]]), media, "/wiki/media/");
    expect([...shots.keys()]).toEqual(["tampa"]);
    const tampa = shots.get("tampa")!;
    expect(tampa.map((photo) => photo.kind)).toEqual(["city", "city", "obelisk", "obelisk", "obelisk"]);
    expect(tampa.map((photo) => photo.name)).toEqual(["downtown", "ybor-city", "sextant", "lantern", "tide-eye"]);
    const lead = tampa[0]!;
    expect(img(lead, lead.alt)).toContain(`srcset="${lead.small!.file} 640w, ${lead.file} 1440w"`);
    const cover = lead.card!;
    expect([cover.width, cover.height]).toEqual([384, 216]);
    for (const photo of tampa) {
      expect([photo.width, photo.height]).toEqual([1440, 810]);
      expect([photo.small?.width, photo.small?.height]).toEqual([640, 360]);
    }
    const photos = [...tampa.flatMap((photo) => [photo, photo.small!]), cover];
    expect(readdirSync(media).sort()).toEqual(photos.map((photo) => photo.file.split("/").at(-1)!).sort());
    for (const { file } of photos) {
      expect(file).toMatch(/^\/wiki\/media\/place-tampa-[a-z-]+(?:\.small)?\.[0-9a-f]{16}\.webp$/);
      expect(readFileSync(join(media, file.split("/").at(-1)!)).toString("ascii", 8, 12)).toBe("WEBP");
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});


test("a city camera uses the frame of the packed map", () => {
  const centre = [-82.469, 27.9445] as const;
  const dims = { chunksX: 255, chunksZ: 255, frameX: 1984, frameZ: 2025, originX: FRAME_MIDDLE, originZ: FRAME_MIDDLE };
  const point = [...centre, 15] as const;
  const [x, z, up] = projectCityCamera(centre, dims)(point);
  expect([x, z, up]).toEqual([8160, 5536, 15]);
  const wider = { ...dims, frameX: dims.frameX - 1, frameZ: dims.frameZ - 2 };
  expect(projectCityCamera(centre, wider)(point)).toEqual([x + 64, z + 128, up]);
});
